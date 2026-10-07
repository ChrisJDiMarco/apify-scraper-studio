// Sheets storage: research runs open as live workbooks; imported spreadsheets and every reviewer edit are
// kept under <userData>/workbooks. No Electron dependency, so the browser host can serve the same calls.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { buildResearchWorkbook } = require('../shared/research-workbook');
const { readWorkbookFile } = require('./workbook-import');

const MAX_EDITS_BYTES = 8 * 1024 * 1024;
const MAX_EDIT_CHARS = 50000;
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

function createWorkbookStore({ root, contentWorkspace, activeWorkspaceId = () => 'general', readGoogleTabs, clock = () => new Date() } = {}) {
  if (!root || !contentWorkspace) fail('Workbook storage needs a data folder and the studio workspace.');
  fs.mkdirSync(root, { recursive: true });
  const indexFile = path.join(root, 'index.json');
  const stamp = () => new Date(clock()).toISOString();
  const researchCache = new Map();

  function writeJson(target, value) {
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, target);
  }
  function readJson(target, fallback) { try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Saved workbook data could not be read. Restore the workbooks folder from a backup.'); } }
  const readIndex = () => { const index = readJson(indexFile, null); return index?.version === 1 && Array.isArray(index.workbooks) ? index : { version: 1, workbooks: [] }; };
  const editsFile = (id) => path.join(root, `${safeId(id)}.edits.json`);
  const workbookFile = (id) => path.join(root, `${safeId(id)}.json`);
  const readEdits = (id) => readJson(editsFile(id), { version: 1, sheets: {} });
  const importedMeta = (id) => readIndex().workbooks.find((row) => row.id === id && row.workspaceId === activeWorkspaceId());

  function summary(workbook) { return workbook.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rowCount: sheet.rows.length, columnCount: sheet.columns.length })); }

  function list() {
    const research = contentWorkspace.listResearchWorkbookSources().map((source) => ({ id: source.runId, kind: 'research', name: source.title, createdAt: source.createdAt, updatedAt: source.updatedAt, status: source.status, stage: source.stage, rowCount: source.evidenceCount, themeCount: source.themeCount }));
    const imported = readIndex().workbooks.filter((row) => row.workspaceId === activeWorkspaceId()).map(({ id, name, source, createdAt, updatedAt, sheets }) => ({ id, kind: 'import', name, source, createdAt, updatedAt, rowCount: (sheets || []).reduce((sum, sheet) => sum + sheet.rowCount, 0), sheetCount: (sheets || []).length }));
    return [...research, ...imported].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async function read({ workbookId } = {}) {
    const id = safeId(workbookId);
    const meta = importedMeta(id);
    if (meta) { const workbook = readJson(workbookFile(id), null); if (!workbook) fail('This imported workbook is missing its data. Import the file again.'); return { ...workbook, kind: 'import', source: meta.source, edits: readEdits(id) }; }
    const listing = contentWorkspace.listResearchWorkbookSources().find((row) => row.runId === id);
    if (!listing) fail('This workbook is not in the selected workspace.');
    const cached = researchCache.get(id);
    if (cached?.version === listing.version) return { ...cached.workbook, edits: readEdits(id) };
    const workbook = buildResearchWorkbook(await contentWorkspace.readResearchWorkbookSource({ runId: id }));
    researchCache.set(id, { version: listing.version, workbook });
    while (researchCache.size > 3) researchCache.delete(researchCache.keys().next().value);
    return { ...workbook, edits: readEdits(id) };
  }

  function store({ parsed, source, workbookId }) {
    const usedIds = new Set();
    const sheets = parsed.sheets.filter((sheet) => sheet.rows.length).map((sheet) => sheetFromRows(sheet.name, sheet.rows, usedIds, sheet.frozenColumns));
    if (!sheets.length) fail('That file has no sheets with cells to show.');
    const index = readIndex(); const existing = workbookId ? index.workbooks.find((row) => row.id === workbookId && row.workspaceId === activeWorkspaceId()) : null;
    if (workbookId && !existing) fail('Choose an imported workbook to update.');
    const id = existing?.id || `workbook-${randomUUID()}`; const now = stamp();
    const workbook = { id, name: existing?.name || parsed.name, sheets };
    writeJson(workbookFile(id), workbook);
    const meta = { id, workspaceId: activeWorkspaceId(), name: workbook.name, source, createdAt: existing?.createdAt || now, updatedAt: now, sheets: summary(workbook) };
    writeJson(indexFile, { version: 1, workbooks: [meta, ...index.workbooks.filter((row) => row.id !== id)] });
    return { ...meta, kind: 'import', warnings: parsed.warnings || [] };
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

  function saveEdits({ workbookId, edits } = {}) {
    const id = safeId(workbookId);
    if (!importedMeta(id) && !contentWorkspace.listResearchWorkbookSources().some((row) => row.runId === id)) fail('This workbook is not in the selected workspace.');
    if (!edits || typeof edits !== 'object' || Array.isArray(edits) || typeof edits.sheets !== 'object') fail('Edits must be grouped by sheet.');
    const clean = { version: 1, sheets: {} };
    for (const [sheetId, rows] of Object.entries(edits.sheets)) {
      if (!rows || typeof rows !== 'object') continue;
      for (const [rowKey, cells] of Object.entries(rows)) {
        if (!cells || typeof cells !== 'object') continue;
        for (const [columnKey, value] of Object.entries(cells)) {
          if (typeof value !== 'string' || value.length > MAX_EDIT_CHARS) fail('A cell can hold up to 50,000 characters of text.');
          ((clean.sheets[String(sheetId).slice(0, 120)] ||= {})[String(rowKey).slice(0, 320)] ||= {})[String(columnKey).slice(0, 200)] = value;
        }
      }
    }
    if (JSON.stringify(clean).length > MAX_EDITS_BYTES) fail('This workbook has too many edits to save. Export it and start a fresh copy.');
    writeJson(editsFile(id), { ...clean, savedAt: stamp() });
    return { workbookId: id, savedAt: stamp() };
  }

  function remove({ workbookId } = {}) {
    const id = safeId(workbookId); const meta = importedMeta(id);
    if (!meta) fail('Only imported workbooks can be removed. Research runs stay with their program.');
    const index = readIndex(); writeJson(indexFile, { version: 1, workbooks: index.workbooks.filter((row) => row.id !== id) });
    for (const target of [workbookFile(id), editsFile(id)]) fs.rmSync(target, { force: true });
    return { workbookId: id, removed: true };
  }

  function rename({ workbookId, name } = {}) {
    const id = safeId(workbookId); const clean = String(name || '').trim().slice(0, 160); if (!clean) fail('Give the workbook a name.');
    const index = readIndex(); const meta = index.workbooks.find((row) => row.id === id && row.workspaceId === activeWorkspaceId());
    if (!meta) fail('Only imported workbooks can be renamed.');
    meta.name = clean; meta.updatedAt = stamp(); writeJson(indexFile, index);
    const workbook = readJson(workbookFile(id), null); if (workbook) writeJson(workbookFile(id), { ...workbook, name: clean });
    return { ...meta, kind: 'import' };
  }

  return { list, read, importFile, pullGoogleSheet, saveEdits, remove, rename };
}

function sheetValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

module.exports = { createWorkbookStore, sheetFromRows, GOLDEN_THREAD_TABS };
