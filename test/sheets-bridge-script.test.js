import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import store from '../src/main/workbooks.js';
import bridgeDelivery from '../src/main/bridge-delivery.js';
import validation from '../src/shared/validation.js';
const { normalizeWorkbookExport, exportFileName, buildWorkbookXlsx, planGoogleSheetsExport, runGoogleSheetsExport, EXPORT_LIMITS } = store;
const { createBridgeDelivery } = bridgeDelivery;
const { parseDriveFolderId, validateSettings } = validation;

const SCRIPT = fs.readFileSync(new URL('../scripts/google-sheets-webhook.gs', import.meta.url), 'utf8');
const signed = (buffer) => [...buffer].map((byte) => (byte > 127 ? byte - 256 : byte)); // Apps Script byte arrays are signed
const unsigned = (bytes) => Buffer.from(bytes.map((byte) => byte & 0xff));

// Just enough of SpreadsheetApp, DriveApp, UrlFetchApp and friends to run the bridge script in a sandbox.
function appsScript({ failOnce = {} } = {}) {
  const properties = new Map(); const spreadsheets = new Map(); const folders = new Map([['folder_trends', []], ['folder_exports', []]]); const fetches = []; const moves = []; const created = [];
  let sequence = 0; const nextId = (prefix) => `${prefix}${String(++sequence).padStart(28, '0')}`;
  const failing = (key) => { if (failOnce[key]) { failOnce[key] -= 1; throw new Error(`Exception: Service error: ${key}`); } };
  function sheet(name) {
    const grid = []; const state = { name, id: ++sequence, maxRows: 1000, maxColumns: 26, frozenRows: 0, frozenColumns: 0, headerBold: false };
    const self = {
      state, grid,
      getName: () => state.name, setName: (value) => { state.name = value; return self; }, getSheetId: () => state.id,
      getMaxRows: () => state.maxRows, getMaxColumns: () => state.maxColumns,
      insertRowsAfter: (_, count) => { state.maxRows += count; }, insertColumnsAfter: (_, count) => { state.maxColumns += count; },
      getLastRow: () => { for (let row = grid.length - 1; row >= 0; row--) if (grid[row]?.some((cell) => cell !== '' && cell !== undefined)) return row + 1; return 0; },
      getLastColumn: () => grid.reduce((widest, row) => Math.max(widest, row ? row.reduce((last, cell, index) => (cell !== '' && cell !== undefined ? index + 1 : last), 0) : 0), 0),
      setFrozenRows: (count) => { state.frozenRows = count; }, setFrozenColumns: (count) => { state.frozenColumns = count; },
      getRange: (row, column, rows, columns) => {
        if (row + rows - 1 > state.maxRows || column + columns - 1 > state.maxColumns) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
        const range = {
          setValues: (values) => {
            failing('setValues');
            if (values.length !== rows || values.some((line) => line.length !== columns)) throw new Error('Exception: The number of columns in the data does not match the number of columns in the range.');
            values.forEach((line, offset) => { grid[row - 1 + offset] ||= []; line.forEach((value, index) => { grid[row - 1 + offset][column - 1 + index] = value; }); });
            return range;
          },
          getValues: () => Array.from({ length: rows }, (_, line) => Array.from({ length: columns }, (__, index) => grid[row - 1 + line]?.[column - 1 + index] ?? '')),
          setFontWeight: (weight) => { if (row === 1 && weight === 'bold') state.headerBold = true; return range; },
          setBackground: () => range,
        };
        return range;
      },
    };
    return self;
  }
  function spreadsheet(name) {
    const id = nextId('sheet'); const tabs = [sheet('Sheet1')]; let count = 1;
    const self = {
      id, tabs, getId: () => id, getName: () => name, getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`, getSheets: () => [...tabs],
      getSheetByName: (tabName) => tabs.find((tab) => tab.getName() === tabName) || null,
      insertSheet: (index) => { let label; do label = `Sheet${++count}`; while (tabs.some((tab) => tab.getName() === label)); const tab = sheet(label); tabs.splice(index ?? tabs.length, 0, tab); return tab; },
      deleteSheet: (tab) => { tabs.splice(tabs.indexOf(tab), 1); },
    };
    spreadsheets.set(id, self); return self;
  }
  const folder = (id) => ({ getId: () => id, getName: () => id, createFile: (blob) => { const file = { id: nextId('file'), name: blob.name, mimeType: blob.mimeType, bytes: blob.bytes, folder: id }; created.push(file); return { getId: () => file.id, getUrl: () => `https://drive.google.com/file/d/${file.id}/view`, getName: () => file.name }; } });
  const blob = (bytes = [], mimeType = '', name = '') => { const self = { bytes, mimeType, name, setDataFromString: (text) => { self.bytes = signed(Buffer.from(String(text), 'utf8')); return self; }, getBytes: () => self.bytes }; return self; };
  const sandbox = {
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (text) => ({ setMimeType: () => ({ body: JSON.parse(text) }) }) },
    SpreadsheetApp: { create: (name) => { failing('create'); return spreadsheet(name); }, openById: (id) => { if (!spreadsheets.has(id)) throw new Error('Exception: Requested entity was not found.'); return spreadsheets.get(id); } },
    DriveApp: {
      getFolderById: (id) => { if (!folders.has(id)) throw new Error('Exception: No item with the given ID could be found. Or perhaps you do not have permission to access it.'); return folder(id); },
      getFileById: (id) => ({ moveTo: (target) => { moves.push({ id, folder: target.getId() }); }, makeCopy: () => ({}) }),
      getRootFolder: () => folder('root'),
    },
    UrlFetchApp: {
      getRequest: (url) => ({ url }),
      fetch: (url, options) => {
        fetches.push({ url, options, body: unsigned(options.payload).toString('utf8') });
        if (failOnce.drive) { const status = failOnce.drive; failOnce.drive = 0; return { getResponseCode: () => status, getContentText: () => JSON.stringify({ error: { message: 'The user does not have sufficient permissions for this file.' } }) }; }
        const id = nextId('doc'); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id, name: JSON.parse(fetches.at(-1).body.split('\r\n\r\n')[1].split('\r\n')[0]).name, webViewLink: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk` }) };
      },
    },
    ScriptApp: { getOAuthToken: () => 'apps-script-token' },
    Utilities: { getUuid: () => '1234-5678', newBlob: (data, mimeType, name) => blob(typeof data === 'string' ? signed(Buffer.from(data, 'utf8')) : data, mimeType, name), base64Decode: (text) => signed(Buffer.from(text, 'base64')) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) ?? null, setProperty: (key, value) => { if (String(value).length > 9000) throw new Error('Exception: Argument too large'); properties.set(key, String(value)); }, deleteProperty: (key) => properties.delete(key), getProperties: () => Object.fromEntries(properties), getKeys: () => [...properties.keys()] }) },
  };
  vm.createContext(sandbox); vm.runInContext(SCRIPT, sandbox);
  // What the app's callSheetsWebhook does: POST JSON, throw the bridge's error (with its retryable flag).
  const call = async (request) => {
    const { body } = sandbox.doPost({ postData: { contents: JSON.stringify(request) } });
    if (body.ok === false) { const error = new Error(body.error); error.retryable = body.retryable; throw error; }
    return body;
  };
  return { call, doPost: (request) => sandbox.doPost({ postData: { contents: JSON.stringify(request) } }).body, spreadsheets, fetches, moves, created, properties, sandbox };
}

const tweets = Array.from({ length: 2500 }, (_, index) => [`https://x.com/a/status/${index}`, index === 0 ? '=HYPERLINK("https://evil.example","x")' : index === 1 ? '@aleyda AI Overviews' : `Post ${index}`, String(index * 2), index === 2 ? '007' : '0.86', index === 3 ? '2026-09-24 12:00' : '']);
const workbook = () => normalizeWorkbookExport({
  name: 'Semrush social trends 2026-10-07',
  sheets: [
    { name: 'Theme Repository', columns: ['Theme', 'Novelty'], rows: [['Generative Visibility', 'NEW ANGLE'], ['Query fan-out', 'NEW TOPIC']] },
    { name: 'Twitter', columns: ['post_url', 'post_text', 'likeCount', 'Confidence_Score', 'createdAt'], rows: tweets, frozenColumns: 1 },
    { name: 'Taxonomy Lookup', columns: ['Category', '% Share'], rows: [] },
  ],
}, { maxCells: EXPORT_LIMITS.googleCells });

describe('workbook export helpers', () => {
  it('checks export sizes and names the download like the workbook', () => {
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [] })).toThrow(/no tabs/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: Array.from({ length: 21 }, () => ({ name: 't', columns: [], rows: [] })) })).toThrow(/up to 20 tabs/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [{ name: 'Wide', columns: Array.from({ length: 61 }, () => 'c'), rows: [] }] })).toThrow(/“Wide” has 61 columns/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [{ name: 'Tall', columns: ['a'], rows: Array.from({ length: 50001 }, () => ['1']) }] })).toThrow(/more than 50,000 rows/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [{ name: 'Long', columns: ['a'], rows: [['y'.repeat(50001)]] }] })).toThrow(/longer than 50,000 characters/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [{ name: 'Odd', columns: ['a'], rows: [[{ nested: true }]] }] })).toThrow(/isn’t text/);
    expect(() => normalizeWorkbookExport({ name: 'x', sheets: [{ name: 'Big', columns: ['a', 'b'], rows: Array.from({ length: 20 }, () => ['1', '2']) }] }, { maxCells: 30 })).toThrow(/more than 30 cells/);
    expect(normalizeWorkbookExport({ name: ' Golden\nThread ', sheets: [{ name: '', columns: ['n', 'b'], rows: [[1, true], [null, undefined]], frozenColumns: 99 }] })).toEqual({ name: 'Golden Thread', sheets: [{ name: 'Sheet1', columns: ['n', 'b'], rows: [['1', 'TRUE'], ['', '']] }] });
    expect(exportFileName('Semrush: social/trends?', new Date(2026, 9, 7))).toBe('Semrush social trends 2026-10-07.xlsx');
  });

  it('builds the .xlsx download with every tab and reports cells cut to Excel’s limit', () => {
    const file = buildWorkbookXlsx({ name: 'Golden Thread', sheets: [{ name: 'Twitter', columns: ['post_text'], rows: [['z'.repeat(40000)], ['short']] }] }, { date: new Date(2026, 9, 7) });
    expect(file).toMatchObject({ fileName: 'Golden Thread 2026-10-07.xlsx', sheetCount: 1, rowCount: 2, truncatedCells: 1 });
    expect(file.buffer.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('plans Google Sheets chunks of at most 2,000 rows pinned to their rows', () => {
    const plan = planGoogleSheetsExport(workbook(), { requestId: 'sheet-export-1-abc', folderId: 'folder_exports' });
    expect(plan.create).toMatchObject({ action: 'createSpreadsheet', requestId: 'sheet-export-1-abc-create', title: 'Semrush social trends 2026-10-07', folderId: 'folder_exports' });
    expect(plan.create.tabs.map((tab) => [tab.name, tab.rows.length, tab.frozenColumns])).toEqual([['Theme Repository', 2, undefined], ['Twitter', 2000, 1], ['Taxonomy Lookup', 0, undefined]]);
    expect(plan.appends).toEqual([expect.objectContaining({ action: 'appendRows', requestId: 'sheet-export-1-abc-t2-c1', tabName: 'Twitter', startRow: 2002 })]);
    expect(plan.appends[0].rows).toHaveLength(500);
    expect(plan.create.tabs[1].rows[0]).toEqual(['https://x.com/a/status/0', '=HYPERLINK("https://evil.example","x")', 0, 0.86, '']); // exact numbers travel as numbers
    expect(plan.create.tabs[1].rows[2][3]).toBe('007');
    // A small byte budget moves first chunks out of createSpreadsheet but keeps every row, in order.
    const tight = planGoogleSheetsExport(workbook(), { requestId: 'sheet-export-2-abc', maxRows: 1000, maxBytes: 60000 });
    const twitterRows = [...tight.create.tabs[1].rows, ...tight.appends.filter((append) => append.tabName === 'Twitter').flatMap((append) => append.rows)];
    expect(twitterRows).toHaveLength(2500); expect(twitterRows[2499][0]).toBe('https://x.com/a/status/2499');
    expect(tight.appends.every((append) => append.rows.length <= 1000 && Buffer.byteLength(JSON.stringify(append.rows)) <= 60000)).toBe(true);
    expect(() => planGoogleSheetsExport(workbook(), { requestId: '' })).toThrow(/request ID/);
  });

  it('accepts Drive folder links or IDs in the bridge settings', () => {
    expect(parseDriveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveFolderId('https://drive.google.com/drive/u/1/folders/0AbcSharedDrive')).toBe('0AbcSharedDrive');
    expect(parseDriveFolderId('https://drive.google.com/open?id=1Folder_Id-2')).toBe('1Folder_Id-2');
    expect(() => parseDriveFolderId('https://example.com/drive/folders/abc', 'Trend reports folder')).toThrow(/Trend reports folder must be a Google Drive folder link/);
    expect(() => parseDriveFolderId('https://drive.google.com/file/d/abc/view', 'Default Docs folder')).toThrow(/Default Docs folder/);
    const sheets = validateSettings({ sheets: { docsFolderId: 'https://drive.google.com/drive/folders/docs_1', trendReportsFolderId: 'trends_1', toolkitsFolderId: '', sheetsExportFolderId: 'https://drive.google.com/drive/folders/exports_1' } }, { maxItems: 1000, sheets: { archiveFolderId: 'folder_123' } }).sheets;
    expect(sheets).toMatchObject({ archiveFolderId: 'folder_123', docsFolderId: 'docs_1', trendReportsFolderId: 'trends_1', toolkitsFolderId: '', sheetsExportFolderId: 'exports_1' });
  });
});

describe('Apps Script bridge actions', () => {
  it('creates a Google Sheet from an export plan: bold frozen headers, text kept as text, numbers as numbers', async () => {
    const google = appsScript();
    const plan = planGoogleSheetsExport(workbook(), { requestId: 'sheet-export-3-abc', folderId: 'folder_exports' });
    const result = await runGoogleSheetsExport(plan, google.call);
    expect(result).toMatchObject({ tabCount: 3, rowsWritten: 2502, chunkCount: 2 });
    expect(result.url).toBe(`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`);
    const spreadsheet = google.spreadsheets.get(result.spreadsheetId);
    expect(spreadsheet.getName()).toBe('Semrush social trends 2026-10-07');
    expect(spreadsheet.tabs.map((tab) => tab.getName())).toEqual(['Theme Repository', 'Twitter', 'Taxonomy Lookup']);
    const twitter = spreadsheet.tabs[1];
    expect(twitter.state).toMatchObject({ frozenRows: 1, frozenColumns: 1, headerBold: true });
    expect(twitter.grid).toHaveLength(2501);
    expect(twitter.grid[0]).toEqual(['post_url', 'post_text', 'likeCount', 'Confidence_Score', 'createdAt']);
    expect(twitter.grid[1]).toEqual(['https://x.com/a/status/0', '\'=HYPERLINK("https://evil.example","x")', 0, 0.86, '']);
    expect(twitter.grid[2][1]).toBe("'@aleyda AI Overviews");
    expect(twitter.grid[3][3]).toBe("'007");
    expect(twitter.grid[4][4]).toBe("'2026-09-24 12:00");
    expect(twitter.grid[2001][0]).toBe('https://x.com/a/status/2000'); // the appended chunk starts right after the first
    expect(twitter.grid[2500][0]).toBe('https://x.com/a/status/2499');
    expect(spreadsheet.tabs[2].grid).toEqual([['Category', '% Share']]);
    expect(google.moves).toEqual([{ id: result.spreadsheetId, folder: 'folder_exports' }]);

    // Replaying the whole plan returns the same spreadsheet and writes nothing twice.
    const replay = await runGoogleSheetsExport(plan, google.call);
    expect(replay.spreadsheetId).toBe(result.spreadsheetId);
    expect(google.spreadsheets.size).toBe(1); expect(twitter.grid).toHaveLength(2501);
  });

  it('retries a stopped export into the same spreadsheet and refuses unknown folders before creating anything', async () => {
    const google = appsScript({ failOnce: { setValues: 1 } });
    const plan = planGoogleSheetsExport(workbook(), { requestId: 'sheet-export-4-abc' });
    await expect(runGoogleSheetsExport(plan, google.call)).rejects.toThrow(/Service error: setValues/);
    expect(google.spreadsheets.size).toBe(1); // created, then stopped part-way
    const result = await runGoogleSheetsExport(plan, google.call);
    expect(google.spreadsheets.size).toBe(1);
    expect(google.spreadsheets.get(result.spreadsheetId).tabs.map((tab) => tab.getName())).toEqual(['Theme Repository', 'Twitter', 'Taxonomy Lookup']);
    expect(google.spreadsheets.get(result.spreadsheetId).tabs[1].grid).toHaveLength(2501);

    const fresh = appsScript();
    await expect(runGoogleSheetsExport(planGoogleSheetsExport(workbook(), { requestId: 'sheet-export-5-abc', folderId: 'missing_folder' }), fresh.call)).rejects.toThrow(/No item with the given ID/);
    expect(fresh.spreadsheets.size).toBe(0);
  });

  it('creates a native Google Doc from HTML with one multipart Drive upload, once per requestId', async () => {
    const google = appsScript();
    const request = { action: 'createDoc', requestId: 'studio-doc-0123456789abcdef', title: 'Priority_Trends_Café_2026-10-07_09-05', folderId: 'folder_trends', html: '<!doctype html><html><body><h1>Café ☕</h1></body></html>' };
    const first = await google.call(request);
    expect(first).toMatchObject({ ok: true, action: 'createDoc', requestId: request.requestId, name: request.title, folderId: 'folder_trends' });
    expect(first.url).toBe(`https://docs.google.com/document/d/${first.documentId}/edit`);
    expect(google.fetches).toHaveLength(1);
    const [upload] = google.fetches;
    expect(upload.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink');
    expect(upload.options).toMatchObject({ method: 'post', contentType: 'multipart/related; boundary=studio12345678', headers: { Authorization: 'Bearer apps-script-token' }, muteHttpExceptions: true });
    expect(upload.body).toContain(JSON.stringify({ name: request.title, mimeType: 'application/vnd.google-apps.document', parents: ['folder_trends'] }));
    expect(upload.body).toContain('Content-Type: text/html; charset=UTF-8\r\n\r\n<!doctype html><html><body><h1>Café ☕</h1></body></html>\r\n--studio12345678--');

    const again = await google.call(request);
    expect(again).toMatchObject({ documentId: first.documentId, duplicate: true });
    expect(google.fetches).toHaveLength(1);
  });

  it('reports Drive refusals clearly and marks only temporary ones as retryable', async () => {
    const refused = appsScript({ failOnce: { drive: 403 } });
    expect(refused.doPost({ action: 'createDoc', requestId: 'studio-doc-refused-1', title: 'x', html: '<p>x</p>' })).toEqual({ ok: false, error: 'Google Drive refused the document (403): The user does not have sufficient permissions for this file.', retryable: false });
    const busy = appsScript({ failOnce: { drive: 503 } });
    expect(busy.doPost({ action: 'createDoc', requestId: 'studio-doc-busy-1', title: 'x', html: '<p>x</p>' })).toMatchObject({ ok: false, retryable: true });
    expect(busy.doPost({ action: 'createDoc', requestId: 'studio-doc-folder-1', title: 'x', folderId: 'missing', html: '<p>x</p>' })).toMatchObject({ ok: false });
    expect(busy.fetches).toHaveLength(1); // the unknown folder stopped before any upload
    expect(busy.doPost({ action: 'createDoc', title: 'x', html: '<p>x</p>' })).toMatchObject({ ok: false, error: expect.stringMatching(/requestId is required/) });
  });

  it('stores image files, answers ping with its version, and keeps the older actions working', async () => {
    const google = appsScript();
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('pixels')]);
    const file = await google.call({ action: 'createFile', requestId: 'studio-file-0123456789', name: 'Visual.png', mimeType: 'image/png', base64: png.toString('base64'), folderId: 'folder_trends' });
    expect(file).toMatchObject({ ok: true, name: 'Visual.png', folderId: 'folder_trends' });
    expect(unsigned(google.created[0].bytes).equals(png)).toBe(true);
    expect(google.doPost({ action: 'createFile', requestId: 'studio-file-exe-0001', name: 'x.exe', mimeType: 'application/x-msdownload', base64: 'AA==' })).toMatchObject({ ok: false });

    expect(google.doPost({ action: 'ping', spreadsheetId: 'abc' })).toMatchObject({ ok: true, bridgeVersion: 3, actions: expect.arrayContaining(['createSpreadsheet', 'appendRows', 'createDoc', 'createFile']) });
    expect(google.doPost({ action: 'mystery' })).toEqual({ ok: false, error: 'Unsupported action: mystery', retryable: false });

    const target = google.sandbox.SpreadsheetApp.create('Working sheet');
    const written = await google.call({ action: 'writeDatasetRows', requestId: 'legacy-request-1', spreadsheetId: target.getId(), tabName: 'Sheet1', rows: [{ id: 'item-1', text: 'Hello', likes: 3 }] });
    expect(written).toMatchObject({ ok: true, rowsWritten: 1 });
    expect(target.tabs[0].grid[1].slice(0, 5)).toEqual(['item-1', '', '', '', 'Hello']);
    expect(await google.call({ action: 'writeDatasetRows', requestId: 'legacy-request-1', spreadsheetId: target.getId(), tabName: 'Sheet1', rows: [{ id: 'item-1' }] })).toMatchObject({ duplicate: true });
  });

  it('publishes a campaign’s report through the real bridge script without a token', async () => {
    const google = appsScript();
    const adapter = createBridgeDelivery({ callBridge: google.call, getFolders: () => ({ default: '', byDeliverable: { 'evidence-report': 'folder_trends' } }), clock: () => new Date(2026, 9, 7, 9, 5) });
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>R</title></head><body><main><h1>Evidence</h1><p>Grounded.</p></main></body></html>';
    const receipts = [];
    const receipt = await adapter.publishCampaign({ campaignId: 'research-1', title: 'Semrush social trends', assets: [{ id: 'report-1', title: 'Evidence report', channel: 'Research', kind: 'text', deliverableId: 'evidence-report', theme: 'Query fan-out', html }], onProgress: async (event) => { receipts.push(event.phase); } });
    expect(receipt.status).toBe('succeeded');
    expect(receipt.assets[0].files[0]).toMatchObject({ name: 'Priority_Trends_Query fan-out_2026-10-07_09-05', folderId: 'folder_trends' });
    expect(receipt.assets[0].files[0].url).toMatch(/^https:\/\/docs\.google\.com\/document\/d\/doc\d+\/edit$/);
    expect(JSON.parse(google.fetches[0].body.split('\r\n\r\n')[1].split('\r\n')[0])).toEqual({ name: 'Priority_Trends_Query fan-out_2026-10-07_09-05', mimeType: 'application/vnd.google-apps.document', parents: ['folder_trends'] });
    expect(receipts).toEqual(['before-write', 'saved', 'asset-file-ready', 'asset-ready', 'complete']);
  });
});
