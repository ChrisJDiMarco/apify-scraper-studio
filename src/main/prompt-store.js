'use strict';
// Prompt Library storage (SPEC-2 §A): saved versions of each prompt's editable blocks, per workspace, in
// <dataPath>/content-studio/prompts/<workspaceId>/<promptId>.json. Electron-free; the content workspace calls it.
// A file keeps only the blocks that differ from the default, the default's hash at save time (so "Default updated" can
// be shown when a new build changes it), an append-only history and the last test runs. No file means every block is
// the default (version 0). Writes are atomic (temp file, fsync, rename), the same pattern as team-store and ask-store.
const fs = require('fs');
const path = require('path');
const template = require('../shared/prompt-template');
const { writeFileDurable } = require('../shared/durable-write');

const FORMAT = 1;
const MAX_VERSIONS = 200;
const MAX_TESTS = 50;
const HISTORY_SHOWN = 50;
const NOTE_MAX = 200;
const SOURCES = ['library', 'ask-ai', 'restore'];
const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,180}$/;
const fail = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const copy = (value) => JSON.parse(JSON.stringify(value));
// "Oct 14, 10:42 AM EDT": the zone is named because a server's clock may not be the reader's.
const when = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'an earlier time'; };
const person = (by = {}) => ({ id: String(by?.id || 'system').slice(0, 320), name: String(by?.name || 'Automatic').slice(0, 120), role: String(by?.role || '').slice(0, 60) });
const isAdmin = (by) => by?.role === 'admin';

function createPromptStore({ root, registry = template.REGISTRY, now = () => new Date() } = {}) {
  if (!root) throw new Error('The Prompt Library needs the studio data folder.');
  const stamp = () => new Date(now()).toISOString();
  const entryOf = (promptId) => {
    const entry = registry.prompts.find((row) => row.id === promptId);
    if (!entry) throw fail('That prompt isn’t in the Prompt Library.', 404, { code: 'promptUnknown' });
    return entry;
  };
  const folder = (workspaceId) => { if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) throw fail('Choose a workspace first.', 400); return path.join(root, workspaceId); };
  const fileOf = (workspaceId, promptId) => { entryOf(promptId); return path.join(folder(workspaceId), `${promptId}.json`); };
  const fresh = (workspaceId, editionId, promptId) => ({ format: FORMAT, promptId, workspaceId, editionId, version: 0, locked: false, lock: null, blocks: {}, defaultHashes: {}, updatedAt: '', updatedBy: null, history: [], tests: [] });

  // Same pattern as ask-store's writeFile (src/shared/durable-write.js).
  function writeFile(target, value) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileDurable(target, JSON.stringify(value, null, 1));
  }
  // A damaged file is moved aside (kept for recovery by hand) and the prompt falls back to its defaults, which always pass
  // the studio's checks; `damaged` lets the Prompts page say so. A file from a newer build stops instead. A file that
  // can't be read right now (on Windows, a scanner or backup agent holding it) is not damaged: nothing is moved or reset.
  function load(workspaceId, editionId, promptId) {
    const target = fileOf(workspaceId, promptId); let text; let parsed;
    try { text = fs.readFileSync(target, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { doc: fresh(workspaceId, editionId, promptId), found: false };
      throw fail('This prompt’s saved versions could not be read right now; nothing was changed. Try again.', 503, { code: 'promptsUnreadable' });
    }
    try { parsed = JSON.parse(text); }
    catch (_) {
      try { fs.renameSync(target, `${target}.unreadable-${Date.now()}`); } catch (_) { /* Left in place; the next save replaces it. */ }
      return { doc: fresh(workspaceId, editionId, promptId), found: false, damaged: true };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.promptId !== promptId) { try { fs.renameSync(target, `${target}.unreadable-${Date.now()}`); } catch (_) { /* as above */ } return { doc: fresh(workspaceId, editionId, promptId), found: false, damaged: true }; }
    if (Number(parsed.format) > FORMAT) throw fail('These saved prompts are from a newer Golden Thread. Update the app or server.', 409);
    const doc = { ...fresh(workspaceId, editionId, promptId), ...parsed };
    doc.blocks = cleanOverrides(promptId, doc.editionId || editionId, doc.blocks);
    return { doc, found: true };
  }
  // Only editable blocks the registry still has, as text. A block a new build removed or made fixed drops out.
  function cleanOverrides(promptId, editionId, blocks) {
    const entry = entryOf(promptId); const out = {};
    for (const block of entry.blocks) if (block.editable && typeof blocks?.[block.id] === 'string' && template.inEdition(block, editionId)) out[block.id] = template.normalize(blocks[block.id]);
    return out;
  }
  const defaultsOf = (promptId, editionId) => template.defaultsFor(promptId, editionId);
  const effectiveOf = (promptId, editionId, overrides) => template.blocksFor(promptId, editionId, overrides);
  // Blocks whose default changed in a newer build since this person saved their own text over it.
  function changedDefaults(doc, editionId) {
    const defaults = defaultsOf(doc.promptId, editionId);
    return Object.keys(doc.blocks).filter((blockId) => doc.defaultHashes?.[blockId] && doc.defaultHashes[blockId] !== template.hashOf(defaults[blockId] ?? ''));
  }
  const historyRow = (row) => ({ version: row.version, at: row.at, by: row.by, source: row.source, note: row.note, revertOf: row.revertOf ?? null, conversationId: row.conversationId || '', blockIds: Object.keys(row.blocks || {}) });

  function summaryRow(doc, editionId) {
    return { version: doc.version, custom: Object.keys(doc.blocks).length > 0, locked: Boolean(doc.locked), lock: doc.lock ? copy(doc.lock) : null, updatedAt: doc.updatedAt || '', updatedBy: doc.updatedBy ? { name: doc.updatedBy.name, role: doc.updatedBy.role } : null, defaultChanged: changedDefaults(doc, editionId).length > 0 };
  }
  // Every prompt with a saved file in this workspace, by id (prompts without one are on their defaults, version 0).
  function summary(workspaceId, editionId) {
    const dir = folder(workspaceId); let names = [];
    try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const out = {};
    for (const name of names) {
      const promptId = name.slice(0, -5);
      if (!registry.prompts.some((row) => row.id === promptId)) continue;
      const { doc, found } = load(workspaceId, editionId, promptId);
      if (found) out[promptId] = summaryRow(doc, editionId);
    }
    return out;
  }
  function read(workspaceId, editionId, promptId) {
    const { doc, damaged } = load(workspaceId, editionId, promptId);
    const defaults = defaultsOf(promptId, editionId);
    return {
      promptId, version: doc.version, locked: Boolean(doc.locked), lock: doc.lock ? copy(doc.lock) : null, overrides: copy(doc.blocks), effective: effectiveOf(promptId, editionId, doc.blocks), defaults,
      customized: Object.keys(doc.blocks), defaultChanged: changedDefaults(doc, editionId), updatedAt: doc.updatedAt || '', updatedBy: doc.updatedBy ? copy(doc.updatedBy) : null,
      history: doc.history.slice(-HISTORY_SHOWN).reverse().map(historyRow), tests: copy(doc.tests.slice(-10).reverse()), damaged: Boolean(damaged),
    };
  }
  function effective(workspaceId, editionId, promptId) {
    const { doc } = load(workspaceId, editionId, promptId);
    return { version: doc.version, custom: Object.keys(doc.blocks).length > 0, blocks: effectiveOf(promptId, editionId, doc.blocks) };
  }
  // A run's copy: every listed prompt's effective text (defaults included), so a retry rebuilds exactly what ran.
  function snapshot(workspaceId, editionId, ids = []) {
    const out = {};
    for (const promptId of [...new Set(ids)]) {
      if (!registry.prompts.some((row) => row.id === promptId)) continue;
      const current = effective(workspaceId, editionId, promptId);
      out[promptId] = { version: current.version, custom: current.custom, hash: template.hashOf(current.blocks), blocks: current.blocks };
    }
    return out;
  }

  // Shared by save and revert: the conflict and lock refusals, the checks, the append and the write.
  function commit(workspaceId, editionId, promptId, { next, expectedVersion, note, by, source, conversationId = '', revertOf = null }) {
    const target = fileOf(workspaceId, promptId); const { doc } = load(workspaceId, editionId, promptId); const entry = entryOf(promptId); const author = person(by);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== doc.version) {
      const last = doc.updatedBy?.name || 'Someone';
      throw fail(doc.version > 0 ? `${last} saved version ${doc.version} of “${entry.name}” at ${when(doc.updatedAt)}, after you opened it. Reopen the prompt to see their change, then try again.` : `“${entry.name}” changed since you opened it. Reopen the prompt and try again.`, 409, { code: 'promptConflict', version: doc.version });
    }
    if (doc.locked && !isAdmin(author)) throw fail(`An admin locked “${entry.name}”, so only admins can change it. Ask an admin to make this change.`, 403, { code: 'promptLocked' });
    const text = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
    if (!text) throw fail('Add a short note saying what you changed and why.', 400, { code: 'promptNote', problems: [{ blockId: '', message: 'Add a short note saying what you changed and why.' }] });
    if (text.length > NOTE_MAX) throw fail(`Keep the note to ${NOTE_MAX} characters.`, 400, { code: 'promptNote', problems: [{ blockId: '', message: `Keep the note to ${NOTE_MAX} characters.` }] });
    if (!SOURCES.includes(source)) throw fail('Unknown change source.', 400);
    const defaults = defaultsOf(promptId, editionId);
    const overrides = Object.fromEntries(Object.entries(next).filter(([blockId, value]) => value !== defaults[blockId]));
    const problems = template.validateBlocks(promptId, editionId, overrides);
    if (problems.length) throw fail(problems.length === 1 ? problems[0].message : `This change has ${problems.length} problems to fix first.`, 400, { code: 'promptInvalid', problems });
    // Nothing changed: no new version, no history row.
    if (template.hashOf(effectiveOf(promptId, editionId, overrides)) === template.hashOf(effectiveOf(promptId, editionId, doc.blocks))) return { version: doc.version, changed: false };
    const at = stamp(); const version = doc.version + 1;
    const defaultHashes = Object.fromEntries(Object.keys(overrides).map((blockId) => [blockId, template.hashOf(defaults[blockId] ?? '')]));
    const row = { version, at, by: author, source, note: text, blocks: copy(overrides), defaultHashes, hash: template.hashOf(effectiveOf(promptId, editionId, overrides)), revertOf, conversationId: String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120) };
    // Append-only; past the cap the oldest rows go (the current version is always the newest row).
    const history = [...doc.history, row].slice(-MAX_VERSIONS);
    writeFile(target, { ...doc, format: FORMAT, workspaceId, editionId, version, blocks: overrides, defaultHashes, updatedAt: at, updatedBy: author, history });
    return { version, changed: true };
  }
  // blocks: the editable blocks being changed ({ blockId: text }); blocks left out keep their current text.
  function save(workspaceId, editionId, promptId, { blocks, expectedVersion, note, by, source = 'library', conversationId = '' } = {}) {
    const entry = entryOf(promptId);
    if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks) || !Object.keys(blocks).length) throw fail('Change at least one part of the prompt before saving.', 400, { code: 'promptEmpty', problems: [{ blockId: '', message: 'Change at least one part of the prompt before saving.' }] });
    // Unknown, fixed, other-edition and non-text blocks are refused by name before anything else.
    const problems = [];
    for (const [blockId, value] of Object.entries(blocks)) {
      const block = entry.blocks.find((row) => row.id === blockId);
      if (!block || !block.editable) problems.push(...template.validateBlocks(promptId, editionId, { [blockId]: value }));
      else if (!template.inEdition(block, editionId)) problems.push({ blockId, message: `${block.label} isn’t used in this workspace’s edition.` });
      else if (typeof value !== 'string') problems.push({ blockId, message: `${block.label} must be text.` });
    }
    if (problems.length) throw fail(problems.length === 1 ? problems[0].message : `This change has ${problems.length} problems to fix first.`, 400, { code: 'promptInvalid', problems });
    const { doc } = load(workspaceId, editionId, promptId);
    const next = { ...effectiveOf(promptId, editionId, doc.blocks), ...Object.fromEntries(Object.entries(blocks).map(([blockId, value]) => [blockId, template.normalize(value)])) };
    return commit(workspaceId, editionId, promptId, { next, expectedVersion, note, by, source, conversationId });
  }
  // Back to an earlier version (0 = the defaults) as a new version, checked against today's rules.
  function revert(workspaceId, editionId, promptId, { toVersion, expectedVersion, note, by } = {}) {
    const { doc } = load(workspaceId, editionId, promptId);
    if (!Number.isInteger(toVersion) || toVersion < 0 || toVersion > doc.version) throw fail('Choose a saved version to restore.', 400);
    let blocks = {};
    if (toVersion > 0) {
      const row = doc.history.find((entry) => entry.version === toVersion);
      if (!row) throw fail(`Version ${toVersion} is older than the ${MAX_VERSIONS} versions the studio keeps.`, 404);
      blocks = cleanOverrides(promptId, editionId, row.blocks);
    }
    const defaults = defaultsOf(promptId, editionId);
    const next = { ...defaults, ...blocks };
    return commit(workspaceId, editionId, promptId, { next, expectedVersion, note: typeof note === 'string' && note.trim() ? note : toVersion ? `Restored version ${toVersion}` : 'Restored the default', by, source: 'restore', revertOf: toVersion });
  }
  // A version's effective text: 0 = defaults, 'current', or a saved version.
  function versionBlocks(doc, editionId, version) {
    if (version === 0 || version === '0' || version === 'default') return defaultsOf(doc.promptId, editionId);
    if (version === 'current' || version === undefined || version === null) return effectiveOf(doc.promptId, editionId, doc.blocks);
    const number = Number(version);
    if (!Number.isInteger(number) || number < 0 || number > doc.version) throw fail('Choose a saved version to compare.', 400);
    if (number === doc.version) return effectiveOf(doc.promptId, editionId, doc.blocks);
    const row = doc.history.find((entry) => entry.version === number);
    if (!row) throw fail(`Version ${number} is older than the ${MAX_VERSIONS} versions the studio keeps.`, 404);
    return effectiveOf(doc.promptId, editionId, cleanOverrides(doc.promptId, editionId, row.blocks));
  }
  // Per-block line diffs between two versions, or a version and a draft ({ blockId: text } over the current text).
  function diff(workspaceId, editionId, promptId, { from = 'current', to = 'draft', draft = null } = {}) {
    const entry = entryOf(promptId); const { doc } = load(workspaceId, editionId, promptId);
    const side = (value) => {
      if (value !== 'draft') return versionBlocks(doc, editionId, value);
      if (draft != null && (typeof draft !== 'object' || Array.isArray(draft))) throw fail('Send the draft as text per block.', 400);
      return { ...effectiveOf(promptId, editionId, doc.blocks), ...Object.fromEntries(Object.entries(draft || {}).filter(([, text]) => typeof text === 'string').map(([blockId, text]) => [blockId, template.normalize(text)])) };
    };
    const a = side(from); const b = side(to);
    const blocks = entry.blocks.filter((block) => block.editable && template.inEdition(block, editionId) && (a[block.id] ?? '') !== (b[block.id] ?? '')).map((block) => ({ blockId: block.id, label: block.label, lines: template.lineDiff(a[block.id] ?? '', b[block.id] ?? '') }));
    return { from, to, blocks };
  }
  // Admins lock a prompt so only admins can change it. Not a version: the text doesn't change.
  function setLock(workspaceId, editionId, promptId, { locked, by } = {}) {
    const author = person(by);
    if (!isAdmin(author)) throw fail('Only an admin can lock or unlock a prompt.', 403, { code: 'adminOnly' });
    if (typeof locked !== 'boolean') throw fail('Choose locked or unlocked.', 400);
    const target = fileOf(workspaceId, promptId); const { doc } = load(workspaceId, editionId, promptId);
    if (Boolean(doc.locked) === locked) return { locked };
    writeFile(target, { ...doc, format: FORMAT, workspaceId, editionId: doc.editionId || editionId, locked, lock: { locked, at: stamp(), by: author } });
    return { locked };
  }
  // A paid test run's record (never a version). Keeps the last 50.
  function recordTest(workspaceId, editionId, promptId, test = {}) {
    const target = fileOf(workspaceId, promptId); const { doc } = load(workspaceId, editionId, promptId);
    const row = { id: String(test.id || '').slice(0, 80), version: doc.version, draftHash: String(test.draftHash || '').slice(0, 64), sample: String(test.sample || '').slice(0, 40), at: stamp(), by: person(test.by), route: String(test.route || '').slice(0, 20), model: String(test.model || '').slice(0, 80), effort: String(test.effort || '').slice(0, 20), costUsd: Number.isFinite(test.costUsd) ? test.costUsd : null, ok: test.ok === true, status: String(test.status || (test.ok ? 'passed' : 'failed')).slice(0, 20), problems: (Array.isArray(test.problems) ? test.problems : []).slice(0, 20).map((problem) => String(problem).slice(0, 400)) };
    writeFile(target, { ...doc, format: FORMAT, workspaceId, editionId: doc.editionId || editionId, tests: [...doc.tests, row].slice(-MAX_TESTS) });
    return copy(row);
  }
  // When a workspace is removed, its saved prompts go with it.
  function purgeWorkspace(workspaceId) { fs.rmSync(folder(workspaceId), { recursive: true, force: true }); }

  return { summary, summaryRow: (workspaceId, editionId, promptId) => summaryRow(load(workspaceId, editionId, promptId).doc, editionId), read, effective, snapshot, save, revert, diff, setLock, recordTest, purgeWorkspace };
}

module.exports = { createPromptStore, MAX_VERSIONS, MAX_TESTS };
