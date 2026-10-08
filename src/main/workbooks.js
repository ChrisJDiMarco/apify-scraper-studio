// Sheets storage: research runs open as live workbooks; imported spreadsheets and every reviewer edit are
// kept under <userData>/workbooks. No Electron dependency, so the browser host can serve the same calls.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { buildResearchWorkbook } = require('../shared/research-workbook');
const { readWorkbookFile } = require('./workbook-import');
const { buildXlsx, exactNumber } = require('../shared/xlsx-writer');

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
    const research = contentWorkspace.listResearchWorkbookSources().map((source) => ({ id: source.runId, kind: 'research', programId: source.programId || '', name: source.title, createdAt: source.createdAt, updatedAt: source.updatedAt, status: source.status, stage: source.stage, rowCount: source.evidenceCount, themeCount: source.themeCount }));
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
