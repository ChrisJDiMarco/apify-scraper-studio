// Sheets storage: research runs and the cross-run Trend tracker open as live workbooks; imported spreadsheets and
// every reviewer edit are kept under <userData>/workbooks. No Electron dependency, so the browser host can serve the same calls.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { buildResearchWorkbook } = require('../shared/research-workbook');
// The cross-run Trend tracker, loaded on use so a host without it still opens every other workbook.
const trendHistory = () => require('../shared/trend-history');
const TREND_TRACKER_ID = 'trend-tracker'; // trend-history.js TREND_TRACKER_ID
const { readWorkbookFile } = require('./workbook-import');
const { buildXlsx, exactNumber } = require('../shared/xlsx-writer');
const { renameDurable } = require('../shared/durable-write');

const MAX_EDITS_BYTES = 8 * 1024 * 1024;
const MAX_EDIT_CHARS = 50000;
const MAX_STORED_CELLS = 6000000; // workbook-import.js MAX_WORKBOOK_CELLS: a pulled Google Sheet gets the same bound
const MAX_CHANGES = 20000;
const MAX_SEEN = 64;
const KEY_COLUMNS = /^(post_url|url|link|permalink|id|item_id|post_id|theme|category)$/i;
// Tabs the Golden Thread workbook uses; a pull asks for these plus any the person names.
const GOLDEN_THREAD_TABS = ['Theme Repository', 'Twitter', 'Reddit', 'LinkedIn', 'Theme Summary Data', 'Post Counts Reference', 'Trend Velocity', 'Taxonomy Lookup', 'Batch Analysis Log', 'Active Log'];

function fail(message) { throw new Error(message); }
function safeId(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(value)) fail('Choose a workbook from the list.'); return value; }
const slug = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sheet';

// Row 1 is the header, as in the sheet people know. Edits key off a stable column (post_url, Theme, …)
// when one exists, so pulling a newer copy of the same sheet keeps every note in place.
function sheetFromRows(name, rows, usedIds, frozenColumns = 0) {
  const [header = [], ...body] = rows;
  const width = Math.max(header.length, ...body.map((row) => row.length), 0);
  const columns = Array.from({ length: width }, (_, index) => String(header[index] ?? '').trim());
  const data = body.map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? '')));
  const keyIndex = columns.findIndex((label, index) => KEY_COLUMNS.test(label) && data.length && new Set(data.map((row) => row[index])).size === data.length && data.every((row) => row[index] !== ''));
  let id = slug(name); while (usedIds.has(id)) id = `${slug(name)}-${usedIds.size + 1}`; usedIds.add(id);
  return { id, name: String(name).slice(0, 120), columns, rows: data, rowKeys: data.map((row, index) => keyIndex >= 0 ? `k:${row[keyIndex].slice(0, 300)}` : `r${index + 2}`), ...(frozenColumns ? { frozenColumns } : {}) };
}

// `caller` names who is reading or saving (the browser studio's signed-in person), so two people's edits to one sheet merge
// cell by cell instead of the last save replacing the file.
function createWorkbookStore({ root, contentWorkspace, activeWorkspaceId = () => 'general', readGoogleTabs, clock = () => new Date(), caller = () => null } = {}) {
  if (!root || !contentWorkspace) fail('Workbook storage needs a data folder and the studio workspace.');
  fs.mkdirSync(root, { recursive: true });
  const indexFile = path.join(root, 'index.json');
  const stamp = () => new Date(clock()).toISOString();
  const researchCache = new Map();
  let trackerCache = null;

  function writeJson(target, value) {
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameDurable(temp, target); // retried on Windows while a scanner holds the file
  }
  function readJson(target, fallback) { try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Saved workbook data could not be read. Restore the workbooks folder from a backup.'); } }
  const readIndex = () => { const index = readJson(indexFile, null); return index?.version === 1 && Array.isArray(index.workbooks) ? index : { version: 1, workbooks: [] }; };
  const editsFile = (id) => path.join(root, `${safeId(id)}.edits.json`);
  const workbookFile = (id) => path.join(root, `${safeId(id)}.json`);
  // Every workspace has its own Trend tracker under the same id, so its edits are kept per workspace.
  const editsKey = (id) => (id === TREND_TRACKER_ID ? `${id}-${activeWorkspaceId()}` : id);
  const readEdits = (id) => readJson(editsFile(editsKey(id)), { version: 1, sheets: {} });
  // What each person last read or saved of a sheet's edits: the base an older page's whole-snapshot save is compared with,
  // so only the cells that person changed are written (see saveEdits).
  const seen = new Map();
  const callerOf = () => { let value = null; try { value = caller(); } catch (_) { value = null; } return { id: String(value?.id || 'local').slice(0, 320), name: String(value?.name || '').slice(0, 120) }; };
  const seenKey = (id) => `${callerOf().id}|${editsKey(id)}`;
  function remember(key, sheets) { seen.delete(key); seen.set(key, sheets); while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value); }
  // The edits a page receives: the cells only (who changed each cell stays on the server, for conflict messages).
  function editsForPage(id) { const stored = readEdits(id); const edits = { version: 1, sheets: stored.sheets || {}, ...(stored.savedAt ? { savedAt: stored.savedAt } : {}) }; remember(seenKey(id), edits.sheets); return edits; }
  const importedMeta = (id) => readIndex().workbooks.find((row) => row.id === id && row.workspaceId === activeWorkspaceId());
  const trackerListing = () => { try { return contentWorkspace.listTrendHistorySources?.() || null; } catch (_) { return null; } };

  function summary(workbook) { return workbook.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rowCount: sheet.rows.length, columnCount: sheet.columns.length })); }

  function list() {
    const research = contentWorkspace.listResearchWorkbookSources().map((source) => ({ id: source.runId, kind: 'research', programId: source.programId || '', name: source.title, createdAt: source.createdAt, updatedAt: source.updatedAt, status: source.status, stage: source.stage, rowCount: source.evidenceCount, themeCount: source.themeCount }));
    const imported = readIndex().workbooks.filter((row) => row.workspaceId === activeWorkspaceId()).map(({ id, name, source, createdAt, updatedAt, sheets }) => ({ id, kind: 'import', name, source, createdAt, updatedAt, rowCount: (sheets || []).reduce((sum, sheet) => sum + sheet.rowCount, 0), sheetCount: (sheets || []).length }));
    // The Trend tracker leads the list as soon as any run has found trends.
    const tracker = trackerListing();
    const trackers = tracker?.trendCount ? [{ id: TREND_TRACKER_ID, kind: 'tracker', name: 'Trend tracker', createdAt: tracker.createdAt, updatedAt: tracker.updatedAt, rowCount: tracker.trendCount, runCount: tracker.runCount, quickScanCount: tracker.quickScanCount, counts: tracker.counts, sinceRun: tracker.sinceRun }] : [];
    return [...trackers, ...[...research, ...imported].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))];
  }

  async function read({ workbookId } = {}) {
    const id = safeId(workbookId);
    if (id === TREND_TRACKER_ID) {
      const tracker = trackerListing(); if (!tracker) fail('The Trend tracker isn’t available on this studio host yet.');
      const key = `${activeWorkspaceId()}|${tracker.version}`;
      if (trackerCache?.key !== key) trackerCache = { key, workbook: trendHistory().buildTrendTrackerWorkbook(await contentWorkspace.readTrendHistorySource(), { now: clock() }) };
      return { ...trackerCache.workbook, edits: editsForPage(id) };
    }
    const meta = importedMeta(id);
    if (meta) { const workbook = readJson(workbookFile(id), null); if (!workbook) fail('This imported workbook is missing its data. Import the file again.'); return { ...workbook, kind: 'import', source: meta.source, edits: editsForPage(id) }; }
    const listing = contentWorkspace.listResearchWorkbookSources().find((row) => row.runId === id);
    if (!listing) fail('This workbook is not in the selected workspace.');
    // Trend Velocity counts runs across the workspace, so a newer run refreshes older runs' workbooks too.
    const version = `${listing.version}|${trackerListing()?.version || ''}`;
    const cached = researchCache.get(id);
    if (cached?.version === version) return { ...cached.workbook, edits: editsForPage(id) };
    const workbook = buildResearchWorkbook(await contentWorkspace.readResearchWorkbookSource({ runId: id }));
    researchCache.set(id, { version, workbook });
    while (researchCache.size > 3) researchCache.delete(researchCache.keys().next().value);
    return { ...workbook, edits: editsForPage(id) };
  }

  function store({ parsed, source, workbookId }) {
    // Rows can be ragged; each sheet is stored as rows × its widest row, so that is what is counted.
    const cells = parsed.sheets.reduce((sum, sheet) => sum + sheet.rows.length * sheet.rows.reduce((width, row) => Math.max(width, row.length), 0), 0);
    if (cells > MAX_STORED_CELLS) fail('This workbook has more cells than the studio can import at once. Split it into smaller files.');
    const usedIds = new Set();
    const sheets = parsed.sheets.filter((sheet) => sheet.rows.length).map((sheet) => sheetFromRows(sheet.name, sheet.rows, usedIds, sheet.frozenColumns));
    if (!sheets.length) fail('That file has no sheets with cells to show.');
    const index = readIndex(); const existing = workbookId ? index.workbooks.find((row) => row.id === workbookId && row.workspaceId === activeWorkspaceId()) : null;
    if (workbookId && !existing) fail('Choose an imported workbook to update.');
    const id = existing?.id || `workbook-${randomUUID()}`; const now = stamp();
    const workbook = { id, name: existing?.name || parsed.name, sheets };
    const warnings = [...(parsed.warnings || [])];
    // Replacing with a newer file: each edit follows its record into the new rows (see carryEdits), read before the old file is overwritten.
    const storedEdits = existing ? readEdits(id) : null;
    const carried = existing ? carryEdits(readJson(workbookFile(id), null), workbook, storedEdits) : null;
    writeJson(workbookFile(id), workbook);
    if (carried?.changed) {
      writeJson(editsFile(editsKey(id)), { version: 1, sheets: carried.sheets, meta: carried.meta, savedAt: carried.dropped ? now : storedEdits.savedAt || '' });
      if (carried.dropped) warnings.push(`${carried.dropped.toLocaleString('en-US')} edited ${carried.dropped === 1 ? 'cell was' : 'cells were'} cleared because ${carried.dropped === 1 ? 'its row or column' : 'their rows or columns'} changed in the new file.`);
    }
    const meta = { id, workspaceId: activeWorkspaceId(), name: workbook.name, source, createdAt: existing?.createdAt || now, updatedAt: now, sheets: summary(workbook) };
    writeJson(indexFile, { version: 1, workbooks: [meta, ...index.workbooks.filter((row) => row.id !== id)] });
    return { ...meta, kind: 'import', warnings };
  }

  async function importFile({ filePath, workbookId } = {}) {
    const parsed = await readWorkbookFile(filePath);
    return store({ parsed, workbookId, source: { kind: 'file', fileName: path.basename(filePath) } });
  }

  async function pullGoogleSheet({ spreadsheetUrl, workbookId, tabs = [] } = {}) {
    if (typeof readGoogleTabs !== 'function') fail('Google Sheets is not connected on this host.');
    const url = String(spreadsheetUrl || importedMeta(workbookId || '')?.source?.spreadsheetUrl || '').trim();
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]{20,}/.test(url)) fail('Paste the full Google Sheets link (it starts with https://docs.google.com/spreadsheets/d/).');
    const wanted = [...new Set([...GOLDEN_THREAD_TABS, ...(Array.isArray(tabs) ? tabs : []).map((tab) => String(tab).trim()).filter(Boolean)])].slice(0, 40);
    const response = await readGoogleTabs({ spreadsheetUrl: url, tabs: wanted });
    const sheets = Object.entries(response?.tabs || {}).filter(([, rows]) => Array.isArray(rows) && rows.length).map(([name, rows]) => {
      const header = [...rows.reduce((keys, row) => { Object.keys(row || {}).forEach((key) => keys.add(key)); return keys; }, new Set())];
      return { name, rows: [header, ...rows.map((row) => header.map((key) => sheetValue(row?.[key])))] };
    });
    if (!sheets.length) fail('That spreadsheet returned no rows for the Golden Thread tabs. Check the link, or download it as .xlsx and import the file instead.');
    const order = Array.isArray(response.order) ? response.order : wanted; // newer bridges send the workbook's own tab order
    sheets.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    return store({ parsed: { name: response.title || 'Google Sheet', sheets, warnings: [] }, workbookId, source: { kind: 'google-sheets', spreadsheetUrl: url } });
  }

  // Edits merge cell by cell, so two people (or two tabs) on one sheet never erase each other's work. Three shapes:
  //   { changes: [{ sheetId, rowKey, columnKey, value: string|null, base: string|null }] }: value null reverts the cell;
  //     base is the stored edit the page last saw. A cell someone else changed since comes back in `conflicts`, unsaved.
  //   { edits, base }: a whole snapshot plus the edits the page loaded; the difference is applied as changes.
  //   { edits }: an older page's whole snapshot, compared with what this person last read or saved. A conflict there is
  //     reported as an error after the other cells are saved, because that page only shows errors.
  // Each cell remembers who wrote it last (meta, kept on the server), for conflict messages.
  // Node runs this read-modify-write without interruption, so no lock is needed.
  function saveEdits({ workbookId, edits, base, changes } = {}) {
    const id = safeId(workbookId);
    const tracker = id === TREND_TRACKER_ID && Boolean(trackerListing());
    if (!tracker && !importedMeta(id) && !contentWorkspace.listResearchWorkbookSources().some((row) => row.runId === id)) fail('This workbook is not in the selected workspace.');
    const who = callerOf(); const key = seenKey(id);
    let list; let snapshot = null; let older = false;
    if (Array.isArray(changes)) list = cleanChanges(changes);
    else {
      if (!edits || typeof edits !== 'object' || Array.isArray(edits) || typeof edits.sheets !== 'object') fail('Edits must be grouped by sheet.');
      snapshot = cleanSheets(edits.sheets);
      const known = base && typeof base === 'object' && !Array.isArray(base) && base.sheets && typeof base.sheets === 'object' ? cleanSheets(base.sheets) : seen.get(key);
      older = !base;
      // With no known base (the server restarted under an open page) nothing is removed: only the cells the page holds are written.
      list = known ? diffSheets(known, snapshot) : cellsOf(snapshot).map((cell) => ({ ...cell, base: undefined }));
    }
    const current = readEdits(id); const sheets = current.sheets && typeof current.sheets === 'object' ? current.sheets : {}; const meta = current.meta && typeof current.meta === 'object' ? current.meta : {};
    const conflicts = []; let changed = 0; const at = stamp();
    for (const change of list) {
      const stored = sheets[change.sheetId]?.[change.rowKey]?.[change.columnKey] ?? null;
      if (stored === change.value) continue;
      const writer = meta[change.sheetId]?.[change.rowKey]?.[change.columnKey] || null;
      // An older page may have missed a refresh, so the cells it no longer holds are cleared only when this person wrote
      // them (or nobody is recorded); clearing someone else's cell needs a page that sends its base.
      const othersCell = older && change.value === null && writer?.id && writer.id !== who.id;
      if ((change.base !== undefined && stored !== change.base) || othersCell) { conflicts.push({ sheetId: change.sheetId, rowKey: change.rowKey, columnKey: change.columnKey, stored, by: writer?.by || '' }); continue; }
      if (change.value === null) { setCell(sheets, change, undefined); setCell(meta, change, undefined); }
      else { setCell(sheets, change, change.value); setCell(meta, change, { by: who.name, id: who.id, at }); }
      changed++;
    }
    const saved = { version: 1, sheets, meta, savedAt: changed ? at : current.savedAt || '' };
    if (changed) {
      if (JSON.stringify(saved).length > MAX_EDITS_BYTES) fail('This workbook has too many edits to save. Export it and start a fresh copy.');
      writeJson(editsFile(editsKey(id)), saved);
    }
    if (snapshot) remember(key, snapshot); // what this page now shows, conflicts included: its next snapshot is compared with it
    if (older) {
      if (conflicts.length) throw conflictError(conflicts);
      return { workbookId: id, savedAt: saved.savedAt || at };
    }
    return { workbookId: id, savedAt: saved.savedAt || at, edits: { version: 1, sheets }, conflicts };
  }

  function remove({ workbookId } = {}) {
    const id = safeId(workbookId); const meta = importedMeta(id);
    if (!meta) fail(id === TREND_TRACKER_ID ? 'The Trend tracker is rebuilt from your research runs, so it stays in Sheets. Only imported workbooks can be removed.' : 'Only imported workbooks can be removed. Research runs stay with their program.');
    const index = readIndex(); writeJson(indexFile, { version: 1, workbooks: index.workbooks.filter((row) => row.id !== id) });
    for (const target of [workbookFile(id), editsFile(id)]) fs.rmSync(target, { force: true });
    return { workbookId: id, removed: true };
  }

  function rename({ workbookId, name } = {}) {
    const id = safeId(workbookId); const clean = String(name || '').trim().slice(0, 160); if (!clean) fail('Give the workbook a name.');
    const index = readIndex(); const meta = index.workbooks.find((row) => row.id === id && row.workspaceId === activeWorkspaceId());
    if (!meta) fail(id === TREND_TRACKER_ID ? 'The Trend tracker keeps its name. Only imported workbooks can be renamed.' : 'Only imported workbooks can be renamed.');
    meta.name = clean; meta.updatedAt = stamp(); writeJson(indexFile, index);
    const workbook = readJson(workbookFile(id), null); if (workbook) writeJson(workbookFile(id), { ...workbook, name: clean });
    return { ...meta, kind: 'import' };
  }

  return { list, read, importFile, pullGoogleSheet, saveEdits, remove, rename };
}

// Edits as sent by a page, checked and bounded: { [sheetId]: { [rowKey]: { [columnKey]: text } } }.
function cleanSheets(input) {
  const clean = {};
  for (const [sheetId, rows] of Object.entries(input || {})) {
    if (!rows || typeof rows !== 'object') continue;
    for (const [rowKey, cells] of Object.entries(rows)) {
      if (!cells || typeof cells !== 'object') continue;
      for (const [columnKey, value] of Object.entries(cells)) {
        if (typeof value !== 'string' || value.length > MAX_EDIT_CHARS) fail('A cell can hold up to 50,000 characters of text.');
        ((clean[String(sheetId).slice(0, 120)] ||= {})[String(rowKey).slice(0, 320)] ||= {})[String(columnKey).slice(0, 200)] = value;
      }
    }
  }
  if (JSON.stringify(clean).length > MAX_EDITS_BYTES) fail('This workbook has too many edits to save. Export it and start a fresh copy.');
  return clean;
}
const cellsOf = (sheets) => Object.entries(sheets).flatMap(([sheetId, rows]) => Object.entries(rows).flatMap(([rowKey, cells]) => Object.entries(cells).map(([columnKey, value]) => ({ sheetId, rowKey, columnKey, value }))));
// What changed between the edits a page started from and the snapshot it sends now; a cell gone from the snapshot was reverted.
function diffSheets(base, next) {
  const list = [];
  for (const cell of cellsOf(next)) { const before = base[cell.sheetId]?.[cell.rowKey]?.[cell.columnKey] ?? null; if (before !== cell.value) list.push({ ...cell, base: before }); }
  for (const cell of cellsOf(base)) if (next[cell.sheetId]?.[cell.rowKey]?.[cell.columnKey] === undefined) list.push({ ...cell, value: null, base: cell.value });
  return list;
}
function cleanChanges(changes) {
  if (changes.length > MAX_CHANGES) fail('Save fewer cells at a time.');
  return changes.map((change) => {
    if (!change || typeof change !== 'object' || ['sheetId', 'rowKey', 'columnKey'].some((field) => typeof change[field] !== 'string' || !change[field])) fail('Each change needs its sheet, row and column.');
    const value = change.value ?? null; const base = change.base === undefined ? null : change.base;
    if ((value !== null && (typeof value !== 'string' || value.length > MAX_EDIT_CHARS)) || (base !== null && typeof base !== 'string')) fail('A cell can hold up to 50,000 characters of text.');
    return { sheetId: change.sheetId.slice(0, 120), rowKey: change.rowKey.slice(0, 320), columnKey: change.columnKey.slice(0, 200), value, base };
  });
}
// Sets (or, with undefined, removes) one cell in a sheets/rows/cells tree, dropping rows and sheets left empty.
function setCell(tree, { sheetId, rowKey, columnKey }, value) {
  if (value === undefined) {
    const row = tree[sheetId]?.[rowKey]; if (!row) return;
    delete row[columnKey]; if (!Object.keys(row).length) delete tree[sheetId][rowKey]; if (!Object.keys(tree[sheetId]).length) delete tree[sheetId];
    return;
  }
  ((tree[sheetId] ||= {})[rowKey] ||= {})[columnKey] = value;
}
// Edit column keys as the grid makes them (sheet-model.js columnKeys): the header when it is unique, else the column letter.
function columnLetter(index) { let n = index + 1; let letters = ''; while (n > 0) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); } return letters; }
function editColumnKeys(columns) {
  const counts = new Map(); for (const label of columns) counts.set(label, (counts.get(label) || 0) + 1);
  return columns.map((label, index) => (label && counts.get(label) === 1 ? label : `#${columnLetter(index)}`));
}
// Old row index → new row key, for each old row whose cells, in every column both tabs share, match the new rows exactly
// as often as they appeared before (repeated identical rows pair up in order); anything else has no match.
function contentMatch(before, after, beforeKeys, afterKeys) {
  const pairs = beforeKeys.flatMap((key, index) => { const at = afterKeys.indexOf(key); return at >= 0 && before.columns[index] === after.columns[at] ? [[index, at]] : []; });
  const found = new Map(); if (!pairs.length) return found;
  const group = (rows, side) => { const groups = new Map(); rows.forEach((row, index) => { const key = JSON.stringify(pairs.map((pair) => row[pair[side]] ?? '')); const list = groups.get(key); if (list) list.push(index); else groups.set(key, [index]); }); return groups; };
  const olds = group(before.rows, 0); const news = group(after.rows, 1);
  for (const [key, list] of olds) { const into = news.get(key); if (into?.length === list.length) list.forEach((index, n) => found.set(index, after.rowKeys[into[n]])); }
  return found;
}
// Replacing an imported workbook with a newer file. Edits are stored by tab, row key and column key. A row keyed by a unique
// column (k:…) keeps its key, but a row keyed by its position (r<n>) would put the old edit on whatever record now sits on that
// row. So each edit follows its record: a k: key still in the new tab stays; any other row moves to the new row with the same
// cells; an edit whose row, column or tab can't be found is cleared and counted. A CSV's only tab is named after the file,
// so a workbook with one tab carries its edits into the new file's one tab whatever it is called.
function carryEdits(previous, next, stored) {
  const sheets = {}; const meta = {}; let dropped = 0; let moved = false;
  const oldSheets = Array.isArray(previous?.sheets) ? previous.sheets : [];
  for (const [sheetId, rows] of Object.entries(stored?.sheets || {})) {
    const before = oldSheets.find((sheet) => sheet.id === sheetId);
    const after = next.sheets.find((sheet) => sheet.id === sheetId) || (oldSheets.length === 1 && next.sheets.length === 1 ? next.sheets[0] : null);
    const beforeKeys = before ? editColumnKeys(before.columns) : []; const afterKeys = after ? editColumnKeys(after.columns) : [];
    const afterRows = new Set(after?.rowKeys || []); let match = null;
    // A letter key (#B) carries over only when the same header still sits under it.
    const carries = (columnKey) => { const at = afterKeys.indexOf(columnKey); if (at < 0) return false; if (!columnKey.startsWith('#')) return true; const was = beforeKeys.indexOf(columnKey); return was >= 0 && before.columns[was] === after.columns[at]; };
    for (const [rowKey, cells] of Object.entries(rows || {})) {
      let target = null;
      if (after && rowKey.startsWith('k:') && afterRows.has(rowKey)) target = rowKey;
      else if (after && before) { match ||= contentMatch(before, after, beforeKeys, afterKeys); target = match.get(before.rowKeys.indexOf(rowKey)) ?? null; }
      for (const [columnKey, value] of Object.entries(cells || {})) {
        if (target === null || !carries(columnKey)) { dropped++; continue; }
        const into = { sheetId: after.id, rowKey: target, columnKey };
        setCell(sheets, into, value);
        const writer = stored.meta?.[sheetId]?.[rowKey]?.[columnKey]; if (writer) setCell(meta, into, writer);
        if (after.id !== sheetId || target !== rowKey) moved = true;
      }
    }
  }
  return { sheets, meta, dropped, changed: dropped > 0 || moved };
}
function conflictError(conflicts) {
  const names = [...new Set(conflicts.map((entry) => entry.by).filter(Boolean))];
  const who = names.length ? names.slice(0, 2).join(' and ') : 'Someone else';
  const cells = conflicts.length === 1 ? '1 cell' : `${conflicts.length.toLocaleString('en-US')} cells`;
  return Object.assign(new Error(`${who} changed ${cells} you edited, so ${conflicts.length === 1 ? 'their value was' : 'their values were'} kept. Reopen the sheet to see the current values; your other changes are saved.`), { status: 409, code: 'sheetConflict', conflicts });
}

function sheetValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Exports. The renderer sends what the grid shows: each tab's header and rows with the person's edits applied.
// Sizes are checked here, before anything is written to disk or sent to Google.
const EXPORT_LIMITS = { sheets: 20, rows: 50000, columns: 60, cellChars: 50000, xlsxCells: 5000000, googleCells: 2000000 };
const GOOGLE_CHUNK_ROWS = 2000;
const GOOGLE_CHUNK_BYTES = 4 * 1024 * 1024;
const exportName = (value, fallback = 'Workbook') => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || fallback;

function exportCell(value, tabName) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'string') fail(`“${tabName}” has a cell that isn’t text. Reopen the workbook and export again.`);
  if (value.length > EXPORT_LIMITS.cellChars) fail(`A cell in “${tabName}” is longer than 50,000 characters. Shorten it before exporting.`);
  return value;
}

function normalizeWorkbookExport(payload, { maxCells = EXPORT_LIMITS.xlsxCells, tooLarge = '' } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Choose a workbook to export.');
  const { sheets } = payload;
  if (!Array.isArray(sheets) || !sheets.length) fail('This workbook has no tabs to export.');
  if (sheets.length > EXPORT_LIMITS.sheets) fail(`An export can include up to ${EXPORT_LIMITS.sheets} tabs. This workbook has ${sheets.length}.`);
  let cells = 0;
  const clean = sheets.map((sheet, index) => {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) fail(`Tab ${index + 1} is missing its cells.`);
    const name = exportName(sheet.name, `Sheet${index + 1}`).slice(0, 120);
    if (!Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) fail(`“${name}” is missing its header or rows.`);
    if (sheet.columns.length > EXPORT_LIMITS.columns) fail(`“${name}” has ${sheet.columns.length} columns. An export can include up to ${EXPORT_LIMITS.columns}.`);
    if (sheet.rows.length > EXPORT_LIMITS.rows) fail(`“${name}” has more than 50,000 rows. Download that tab as CSV instead.`);
    const columns = sheet.columns.map((value) => exportCell(value, name));
    const rows = sheet.rows.map((row) => {
      if (!Array.isArray(row)) fail(`“${name}” has a row that isn’t a list of cells.`);
      if (row.length > EXPORT_LIMITS.columns) fail(`“${name}” has rows wider than ${EXPORT_LIMITS.columns} columns.`);
      cells += row.length;
      return row.map((value) => exportCell(value, name));
    });
    cells += columns.length;
    if (cells > maxCells) fail(tooLarge || `This workbook has more than ${maxCells.toLocaleString('en-US')} cells. Download one tab at a time instead.`);
    const frozenColumns = Number.isInteger(sheet.frozenColumns) && sheet.frozenColumns > 0 && sheet.frozenColumns <= 10 ? sheet.frozenColumns : 0;
    return { name, columns, rows, ...(frozenColumns ? { frozenColumns } : {}) };
  });
  return { name: exportName(payload.name), sheets: clean };
}

const pad2 = (value) => String(value).padStart(2, '0');
function exportFileName(name, date = new Date()) {
  const base = exportName(name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Workbook';
  return `${base} ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}.xlsx`;
}

// Download: one .xlsx with every tab sent. Cells over Excel's 32,767-character limit are shortened and counted.
function buildWorkbookXlsx(payload, { date = new Date() } = {}) {
  const workbook = normalizeWorkbookExport(payload);
  let truncatedCells = 0;
  const buffer = buildXlsx({ title: workbook.name, sheets: workbook.sheets, modifiedAt: date, onStats: (stats) => { truncatedCells = stats.truncatedCells; } });
  return { buffer, fileName: exportFileName(workbook.name, date), sheetCount: workbook.sheets.length, rowCount: workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0), truncatedCells };
}

// Google Sheets tab names: up to 100 characters, unique ignoring case.
function googleTabNames(names) {
  const used = new Set();
  return names.map((raw, index) => {
    const base = String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || `Sheet${index + 1}`;
    let name = base; let copy = 2;
    while (used.has(name.toLowerCase())) { const suffix = ` (${copy++})`; name = `${base.slice(0, 100 - suffix.length).trim()}${suffix}`; }
    used.add(name.toLowerCase());
    return name;
  });
}

function chunkRows(rows, maxRows, maxBytes) {
  const chunks = []; let current = []; let bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (current.length && (current.length >= maxRows || bytes + size > maxBytes)) { chunks.push(current); current = []; bytes = 2; }
    current.push(row); bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// Google Sheets through the Apps Script bridge: createSpreadsheet carries every tab's header plus as many first rows
// as fit one request; appendRows sends the rest in order, at most 2,000 rows (about 4 MB) per call. Request IDs are
// fixed when the plan is made, so a retry or a replay never writes a chunk twice. Numbers that read back exactly are
// sent as numbers; the bridge keeps every other value as text.
function planGoogleSheetsExport(workbook, { requestId, folderId = '', maxRows = GOOGLE_CHUNK_ROWS, maxBytes = GOOGLE_CHUNK_BYTES } = {}) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{8,100}$/.test(requestId)) fail('A Google Sheets export needs a request ID.');
  const names = googleTabNames(workbook.sheets.map((sheet) => sheet.name));
  const tabs = []; const appends = []; let budget = maxBytes;
  workbook.sheets.forEach((sheet, index) => {
    const chunks = chunkRows(sheet.rows.map((row) => row.map((value) => exactNumber(value) ?? value)), maxRows, maxBytes);
    const headerBytes = Buffer.byteLength(JSON.stringify([names[index], sheet.columns])) + 64;
    const firstBytes = chunks.length ? Buffer.byteLength(JSON.stringify(chunks[0])) : 0;
    const first = chunks.length && headerBytes + firstBytes <= budget ? chunks.shift() : [];
    budget -= headerBytes + (first.length ? firstBytes : 0);
    tabs.push({ name: names[index], columns: sheet.columns, rows: first, ...(sheet.frozenColumns ? { frozenColumns: sheet.frozenColumns } : {}) });
    // startRow pins each chunk to its rows (row 1 is the header), so writing a chunk twice changes nothing.
    let startRow = 2 + first.length;
    chunks.forEach((rows, chunk) => { appends.push({ action: 'appendRows', requestId: `${requestId}-t${index + 1}-c${chunk + 1}`, tabName: names[index], startRow, rows }); startRow += rows.length; });
  });
  return { create: { action: 'createSpreadsheet', requestId: `${requestId}-create`, title: workbook.name, ...(folderId ? { folderId } : {}), tabs }, appends };
}

// Runs a plan in order. A replay of the same plan gets the same spreadsheet back (the bridge remembers every
// requestId) and skips the chunks it already wrote.
async function runGoogleSheetsExport(plan, callBridge) {
  if (!plan?.create || !Array.isArray(plan.create.tabs) || !Array.isArray(plan.appends)) fail('This Google Sheets export has no saved plan to run.');
  const created = await callBridge(plan.create);
  const spreadsheetId = String(created?.spreadsheetId || '');
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheetId)) fail('The Sheets bridge did not return the new spreadsheet. Redeploy scripts/google-sheets-webhook.gs (see the Sheets guide) and try again.');
  let rowsWritten = plan.create.tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
  for (const append of plan.appends) { await callBridge({ ...append, spreadsheetId }); rowsWritten += append.rows.length; }
  return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, tabCount: plan.create.tabs.length, rowsWritten, chunkCount: plan.appends.length + 1 };
}

module.exports = { createWorkbookStore, sheetFromRows, GOLDEN_THREAD_TABS, EXPORT_LIMITS, normalizeWorkbookExport, exportFileName, buildWorkbookXlsx, planGoogleSheetsExport, runGoogleSheetsExport };
