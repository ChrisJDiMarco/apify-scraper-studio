// Research program access: which programs' work a person sees. A member's programIds (team.json, set in People & access)
// lists the research programs they were invited to; none listed (null) means every program, as before programs could be
// chosen, so nobody loses access on upgrade. Admins always see every program. Main-only CommonJS, like roles.js.
//
// Work belongs to a program through its research run: a research run carries programId; a trend's report run names its
// research run (researchRunId, or the run's reportRunIds); a channel-asset set or a Create content draft follows the
// report it was made from; a file follows its run. Work that belongs to no program (a draft from a pasted brief, a set
// made from a Google Doc, a dataset) is everyone's.
//
// scopeOf(viewer) → Set of program ids, or null for "every program"
// indexStudio({ researchRuns, contentRuns, assets, themes }) → { ofRun(id), ofAsset(id), ofTheme(id) } (program ids, '' none)
// scopeStudio(contentStudio, scope) → the same shape with other programs' work left out
// outOfScope(index, payload, scope) → true when the payload names a run, file, trend or program outside the scope
// scopeResult(result, index, scope) → a method's answer with other programs' rows left out
'use strict';

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');

function scopeOf(viewer) {
  if (!viewer || typeof viewer !== 'object') return null;
  if ((viewer.base ?? viewer.role) === 'admin') return null;
  return Array.isArray(viewer.programIds) ? new Set(viewer.programIds.filter((id) => typeof id === 'string' && id)) : null;
}

function indexStudio(studio = {}) {
  const research = new Map(list(studio.researchRuns).filter((run) => run?.id).map((run) => [run.id, run]));
  const content = new Map(list(studio.contentRuns).filter((run) => run?.id).map((run) => [run.id, run]));
  const assets = new Map(list(studio.assets).filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
  const listedBy = new Map(); // report run id → research run id
  for (const run of research.values()) for (const entry of list(run.reportRunIds)) { const id = typeof entry === 'string' ? entry : entry?.runId; if (id && !listedBy.has(id)) listedBy.set(id, run.id); }
  const themePrograms = new Map(); // theme id → Set of program ids
  for (const run of research.values()) {
    if (!run.programId) continue;
    for (const theme of [...list(run.discoveredThemes), ...list(run.themes)]) if (theme?.id) (themePrograms.get(theme.id) || themePrograms.set(theme.id, new Set()).get(theme.id)).add(run.programId);
  }
  const memo = new Map();
  function ofRun(runId, depth = 0) {
    const id = text(runId); if (!id || depth > 4) return '';
    if (research.has(id)) return research.get(id).programId || '';
    const key = `run:${id}`; if (memo.has(key)) return memo.get(key);
    const run = content.get(id); let owner = '';
    if (run) {
      const parent = run.researchRunId || listedBy.get(run.id) || '';
      if (parent) owner = ofRun(parent, depth + 1);
      else if (run.kit?.reportAssetId || run.sourceAssetId) owner = ofAsset(run.kit?.reportAssetId || run.sourceAssetId, depth + 1);
      if (!owner && (run.kit?.themeId || run.themeId)) owner = [...(themePrograms.get(run.kit?.themeId || run.themeId) || [])][0] || '';
    }
    memo.set(key, owner);
    return owner;
  }
  function ofAsset(assetId, depth = 0) {
    const asset = assets.get(text(assetId));
    return asset ? ofRun(asset.runId, depth + 1) : '';
  }
  const ofTheme = (themeId) => [...(themePrograms.get(text(themeId)) || [])];
  return { ofRun: (id) => ofRun(id), ofAsset: (id) => ofAsset(id), ofTheme };
}

// Allowed: belongs to no program, or to one in the scope.
const allowed = (scope, programId) => !programId || scope.has(programId);
const anyAllowed = (scope, programIds) => !programIds.length || programIds.some((id) => scope.has(id));

function scopeStudio(studio, scope) {
  if (!scope || !studio || typeof studio !== 'object') return studio;
  const index = indexStudio(studio);
  const researchRuns = list(studio.researchRuns).filter((run) => allowed(scope, run?.programId || ''));
  const contentRuns = list(studio.contentRuns).filter((run) => allowed(scope, index.ofRun(run?.id)));
  const assets = list(studio.assets).filter((asset) => allowed(scope, index.ofAsset(asset?.id)));
  const keptThemes = new Set([...researchRuns.flatMap((run) => [...list(run.discoveredThemes), ...list(run.themes)].map((theme) => theme?.id))].filter(Boolean));
  const themes = list(studio.themes).filter((theme) => keptThemes.has(theme?.id) || !index.ofTheme(theme?.id).length);
  return {
    ...studio,
    programs: list(studio.programs).filter((program) => scope.has(program?.id)),
    researchRuns, contentRuns, assets, themes,
    ...(Array.isArray(studio.workflows) ? { workflows: studio.workflows.filter((flow) => allowed(scope, flow?.steps?.[0]?.programId || '')) } : {}),
    // The report picker (Create content) and maps keyed by a report's or run's id: note counts, Drive links.
    ...(Array.isArray(studio.availableReports) ? { availableReports: studio.availableReports.filter((row) => allowed(scope, index.ofAsset(row?.assetId || row?.id))) } : {}),
    ...Object.fromEntries(['noteCounts', 'driveLinks'].filter((field) => studio[field] && typeof studio[field] === 'object' && !Array.isArray(studio[field]))
      .map((field) => [field, Object.fromEntries(Object.entries(studio[field]).filter(([id]) => allowed(scope, index.ofAsset(id) || index.ofRun(id))))])),
    ...(Array.isArray(studio.driveStale) ? { driveStale: studio.driveStale.filter((row) => allowed(scope, index.ofAsset(row?.assetId || row?.id || row) || index.ofRun(row?.runId || ''))) } : {}),
    ...(studio.adoptionsByTheme && typeof studio.adoptionsByTheme === 'object' ? { adoptionsByTheme: Object.fromEntries(Object.entries(studio.adoptionsByTheme).filter(([themeId]) => anyAllowed(scope, index.ofTheme(themeId)))) } : {}),
  };
}

// The programs a payload's references belong to: a program, a run (research or content, or a workbook, which is a
// research run's), a file (directly or as a source), a trend.
function ownersOf(index, payload) {
  // A method called with a bare id (a run's or a file's).
  if (typeof payload === 'string') return [index.ofRun(payload), index.ofAsset(payload)];
  const value = payload && typeof payload === 'object' ? payload : {};
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  const owners = [];
  if (text(value.programId)) owners.push(value.programId);
  for (const id of [value.runId, value.researchRunId, value.workbookId, source.runId]) if (text(id)) owners.push(index.ofRun(id));
  for (const id of [value.assetId, source.assetId, source.kind === 'report' ? source.id : '']) if (text(id)) owners.push(index.ofAsset(id));
  // A trend can be found by several programs: it's in scope when any of them is.
  if (text(value.themeId)) { const programs = index.ofTheme(value.themeId); if (programs.length) owners.push({ any: programs }); }
  return owners;
}
function outOfScope(index, payload, scope) {
  if (!scope) return false;
  return ownersOf(index, payload).some((owner) => (owner && typeof owner === 'object' ? !anyAllowed(scope, owner.any) : !allowed(scope, owner)));
}

// A method's answer: rows tagged with a program (programId, programIds) or a run (runId) outside the scope are left out,
// at the top level and in the usual list fields.
const LIST_FIELDS = ['trends', 'items', 'rows', 'results', 'workbooks', 'runs', 'programs'];
function keepRow(row, index, scope) {
  if (!row || typeof row !== 'object') return true;
  if (Array.isArray(row.programIds)) return anyAllowed(scope, row.programIds.filter(Boolean));
  if (typeof row.programId === 'string') return allowed(scope, row.programId);
  if (typeof row.runId === 'string' && row.runId) return allowed(scope, index.ofRun(row.runId));
  return true;
}
function scopeResult(result, index, scope) {
  if (!scope || !result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result.filter((row) => keepRow(row, index, scope));
  let changed = false; const out = { ...result };
  for (const field of LIST_FIELDS) if (Array.isArray(result[field])) { out[field] = result[field].filter((row) => keepRow(row, index, scope)); changed = true; }
  return changed ? out : result;
}

// Which channels used which trends ({ [themeId]: … }), for trends of programs in scope (and trends no program found).
function scopeAdoptions(byTheme, rawStudio, scope) {
  if (!scope || !byTheme || typeof byTheme !== 'object') return byTheme;
  const index = indexStudio(rawStudio);
  return Object.fromEntries(Object.entries(byTheme).filter(([themeId]) => anyAllowed(scope, index.ofTheme(themeId))));
}

module.exports = { scopeOf, indexStudio, scopeStudio, scopeAdoptions, outOfScope, scopeResult };
