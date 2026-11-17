'use strict';
// One immutable source snapshot lets each retained workspace recover its own records without moving another's files.
const fs = require('fs');
const path = require('path');
const { writeFileDurable } = require('../shared/durable-write');
const { isPathInside, safeFilename } = require('../shared/workspace');
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileDurable(file, JSON.stringify(value, null, 2)); };

function captureLegacyWorkspaceData(root, primaryWorkspaceId) {
  const dir = path.join(root, 'workspace-legacy'); fs.mkdirSync(dir, { recursive: true });
  for (const [name, source] of [['data.json', path.join(root, 'data.json')], ['content.json', path.join(root, 'content-studio', 'state.json')]]) {
    const target = path.join(dir, name); if (fs.existsSync(target)) continue;
    if (fs.existsSync(source)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); else write(target, {});
  }
  const events = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(events)) {
    const source = path.join(root, 'v5', 'events.jsonl');
    if (fs.existsSync(source)) fs.copyFileSync(source, events, fs.constants.COPYFILE_EXCL); else writeFileDurable(events, '');
  }
  const marker = path.join(dir, 'workspaces.json');
  if (!fs.existsSync(marker)) {
    let content = {}; try { content = read(path.join(dir, 'content.json')); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    write(marker, { primaryWorkspaceId, ids: (content.workspaces || []).map((row) => row.id).concat(primaryWorkspaceId) });
  }
  return dir;
}

function prepareLegacyRecipeVersions(sourceDir, targetRoot, recipeIds) {
  const marker = path.join(targetRoot, 'legacy-recipe-versions-imported.json'); if (fs.existsSync(marker)) return;
  const target = path.join(targetRoot, 'v5', 'events.jsonl');
  const original = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const parse = (line) => { try { return JSON.parse(line); } catch (_) { return null; } };
  const seen = new Set(original.split('\n').map(parse).filter(Boolean).map((event) => event.id));
  const ids = new Set(recipeIds); const adding = [];
  for (const line of fs.readFileSync(path.join(sourceDir, 'events.jsonl'), 'utf8').match(/[^\n]*\n|[^\n]+$/g) || []) {
    const event = parse(line); const recipeId = event?.payload?.recipeId || event?.payload?.version?.recipeId;
    if (event?.type !== 'recipe-version-saved' || !ids.has(recipeId) || (event.id && seen.has(event.id))) continue;
    adding.push(line); if (event.id) seen.add(event.id);
  }
  if (adding.length) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileDurable(target, original + (original && !original.endsWith('\n') ? '\n' : '') + adding.join(''));
  }
  write(marker, { version: 1 });
}

function prepareLegacyWorkspaceData({ root, workspaceId, primaryWorkspaceId }) {
  const sourceDir = captureLegacyWorkspaceData(root, primaryWorkspaceId);
  const targetRoot = workspaceId === primaryWorkspaceId ? root : path.join(root, 'workspace-data', workspaceId);
  const marker = path.join(targetRoot, 'legacy-records-imported.json');
  if (!read(path.join(sourceDir, 'workspaces.json')).ids.includes(workspaceId)) { if (!fs.existsSync(marker)) write(marker, { version: 1 }); return false; }
  if (fs.existsSync(marker)) {
    if (workspaceId !== primaryWorkspaceId) prepareLegacyRecipeVersions(sourceDir, targetRoot, (read(path.join(targetRoot, 'data.json')).recipes || []).map((row) => row.id));
    return false;
  }
  let source; let studio;
  try { source = read(path.join(sourceDir, 'data.json')); studio = read(path.join(sourceDir, 'content.json')); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; write(marker, { version: 1, damagedSource: true }); return false; }
  const arrays = Object.entries(source).filter(([, rows]) => Array.isArray(rows));
  const owners = new Map(); const ownerOfDataset = (row) => row.workspaceId || studio.datasetOwners?.[row.id] || (studio.researchRuns || []).find((run) => run.id === row.researchRunId)?.workspaceId;
  for (const [kind, rows] of arrays) for (const row of rows) if (row?.id && (row.workspaceId || kind === 'datasets')) { const owner = row.workspaceId || ownerOfDataset(row); if (owner) owners.set(row.id, owner); }
  const refs = (row) => [...['datasetId', 'analysisId', 'cardId', 'runId', 'baselineDatasetId', 'sourceDatasetId', 'currentDatasetId'].map((key) => row[key]), ...(Array.isArray(row.datasetIds) ? row.datasetIds : [])].filter(Boolean);
  for (let round = 0; round < 4; round++) for (const [, rows] of arrays) for (const row of rows) {
    if (!row?.id || owners.has(row.id)) continue;
    const ids = refs(row); const held = new Set(ids.map((id) => owners.get(id)));
    if (ids.length && held.size === 1 && !held.has(undefined)) owners.set(row.id, [...held][0]);
  }
  for (const kind of ['recipes', 'projects', 'runs']) for (const row of source[kind] || []) {
    if (owners.has(row.id)) continue;
    const related = (source.datasets || []).filter((dataset) => dataset[kind === 'recipes' ? 'recipeId' : kind === 'projects' ? 'projectId' : 'runId'] === row.id);
    const held = new Set(related.map((dataset) => owners.get(dataset.id) || primaryWorkspaceId));
    if (held.size === 1) owners.set(row.id, [...held][0]);
  }
  const belongs = (row) => (row.workspaceId || owners.get(row.id) || (refs(row).length && refs(row).every((id) => owners.get(id) === workspaceId) ? workspaceId : primaryWorkspaceId)) === workspaceId;
  const existing = read(path.join(targetRoot, 'data.json')); const next = { ...existing };
  function copyFile(sourcePath) {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !isPathInside(root, sourcePath)) return sourcePath;
    const relative = path.relative(root, sourcePath); if (!/^(?:assets|workspaces|datasets|reports|exports|sheets)[\\/]/.test(relative)) return sourcePath;
    const target = path.join(targetRoot, relative);
    if (target === sourcePath || !fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isFile()) return sourcePath;
    fs.mkdirSync(path.dirname(target), { recursive: true }); if (!fs.existsSync(target)) fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
    return target;
  }
  function copied(value, field = '') {
    if (Array.isArray(value)) return value.map((item) => copied(item, field));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copied(item, key)]));
    return typeof value === 'string' && /(?:path|dir|folder)$/i.test(field) ? copyFile(value) : value;
  }
  for (const [kind, rows] of arrays) {
    const imported = rows.filter((row) => row && typeof row === 'object' && belongs(row)).map(copied);
    if (workspaceId === primaryWorkspaceId) next[kind] = (existing[kind] || rows).filter((row) => !row || typeof row !== 'object' || belongs(row));
    else { const kept = existing[kind] || []; next[kind] = [...kept, ...imported.filter((row) => !kept.some((old) => (old.id || old.analysisId) === (row.id || row.analysisId)))]; }
  }
  if (workspaceId !== primaryWorkspaceId) for (const row of next.datasets || []) copyFile(path.join(root, 'datasets', `${safeFilename(row.id)}.json`));
  if (workspaceId !== primaryWorkspaceId && !(next.projects || []).length) delete next.projects;
  const changed = JSON.stringify(next) !== JSON.stringify(existing);
  if (changed) write(path.join(targetRoot, 'data.json'), next);
  if (workspaceId !== primaryWorkspaceId) prepareLegacyRecipeVersions(sourceDir, targetRoot, (next.recipes || []).map((row) => row.id));
  write(marker, { version: 1 }); return changed;
}

module.exports = { captureLegacyWorkspaceData, prepareLegacyWorkspaceData };
