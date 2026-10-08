// Scraper Studio Sheets bridge: an Apps Script web app the app calls with JSON POSTs.
//
// Update an existing bridge: paste this file over the old one, run `authorizeBridge` once from the editor and accept
// the permissions, then Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy. Editing the
// existing deployment keeps the web app URL that is saved in the app. Execute as: Me.
//
// Permissions. Apps Script detects these from the code. If appsscript.json pins "oauthScopes", list all three:
//   https://www.googleapis.com/auth/spreadsheets             read, write and create spreadsheets
//   https://www.googleapis.com/auth/drive                    archive copies, folders, new files (DriveApp)
//   https://www.googleapis.com/auth/script.external_request  createDoc uploads HTML to the Drive API (UrlFetchApp)
//
// Everything runs with the deploying account's permissions, and new files land in that account's Drive.
const RESPONSE_MIME = ContentService.MimeType.JSON;
const IDEMPOTENCY_PREFIX = 'apify_scraper_studio_request_';
const IDEMPOTENCY_KEEP = 250;
const BRIDGE_VERSION = 3;
const BRIDGE_ACTIONS = ['ping', 'readTabs', 'writeDatasetRows', 'archiveAndClear', 'createSpreadsheet', 'appendRows', 'createDoc', 'createFile'];
// Actions that create files remember their result by requestId, so a replay returns the same file.
const RESULT_PREFIX = 'apify_scraper_studio_result_';
const DRAFT_PREFIX = 'apify_scraper_studio_draft_';
const RESULT_KEEP = 400;
const MAX_CELL_CHARS = 50000;
const MAX_ROWS_PER_CALL = 5000;
const MAX_COLUMNS = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOC_MIME = 'application/vnd.google-apps.document';
const DEFAULT_COLUMNS = [
  'id',
  'type',
  'platform',
  'author',
  'text',
  'url',
  'publishedAt',
  'parentId',
  'threadId',
  'likes',
  'comments',
  'shares',
  'views',
  'theme',
  'relevant',
  'confidence',
  'why',
  'painPoint',
  'urgency',
  'entities',
];

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    if (payload.action === 'ping') return json({ ok: true, action: 'ping', spreadsheetId: payload.spreadsheetId, bridgeVersion: BRIDGE_VERSION, actions: BRIDGE_ACTIONS });
    if (payload.action === 'archiveAndClear') return json(archiveAndClear(payload));
    if (payload.action === 'readTabs') return json(readTabs(payload));
    if (payload.action === 'writeDatasetRows') return json(writeDatasetRows(payload));
    if (payload.action === 'createSpreadsheet') return json(createSpreadsheet(payload));
    if (payload.action === 'appendRows') return json(appendRows(payload));
    if (payload.action === 'createDoc') return json(createDoc(payload));
    if (payload.action === 'createFile') return json(createFile(payload));
    throw new Error('Unsupported action: ' + payload.action);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    return json({ ok: false, error: message, retryable: isRetryableError(message) });
  }
}

function json(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(RESPONSE_MIME);
}

function openSpreadsheet(id) {
  if (!id) throw new Error('spreadsheetId is required.');
  return SpreadsheetApp.openById(id);
}

function archiveAndClear(payload) {
  const spreadsheet = openSpreadsheet(payload.spreadsheetId);
  if (!payload.archiveFolderId) throw new Error('archiveFolderId is required.');
  const archiveName = payload.archiveName || (spreadsheet.getName() + ' Archive ' + new Date().toISOString());
  const file = DriveApp.getFileById(payload.spreadsheetId);
  const folder = DriveApp.getFolderById(payload.archiveFolderId);
  const copy = file.makeCopy(archiveName, folder);
  const tabs = payload.tabsToClear || [];
  tabs.forEach(function(tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const lastColumn = Math.max(sheet.getLastColumn(), DEFAULT_COLUMNS.length);
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  });
  return { ok: true, action: 'archiveAndClear', archiveUrl: copy.getUrl(), archiveId: copy.getId(), clearedTabs: tabs };
}

function readTabs(payload) {
  const spreadsheet = openSpreadsheet(payload.spreadsheetId);
  const out = {};
  // allTabs reads every tab in workbook order, so the app's Sheets view matches the spreadsheet exactly.
  const names = payload.allTabs ? spreadsheet.getSheets().map(function(sheet) { return sheet.getName(); }) : (payload.tabs || []);
  names.forEach(function(tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) {
      out[tabName] = [];
      return;
    }
    out[tabName] = sheetToObjects(sheet);
  });
  return { ok: true, action: 'readTabs', title: spreadsheet.getName(), order: names, tabs: out };
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(header) { return String(header || '').trim(); });
  return values.slice(1)
    .filter(function(row) { return row.some(function(cell) { return String(cell || '').trim(); }); })
    .map(function(row) {
      const object = {};
      headers.forEach(function(header, index) {
        if (header) object[header] = row[index];
      });
      return object;
    });
}

function writeDatasetRows(payload) {
  const requestId = String(payload.requestId || '').trim();
  if (requestId && alreadyProcessed(requestId)) {
    return { ok: true, action: 'writeDatasetRows', duplicate: true, requestId: requestId };
  }

  const spreadsheet = openSpreadsheet(payload.spreadsheetId);
  const sheet = ensureSheet(spreadsheet, payload.tabName || 'Twitter');
  ensureHeader(sheet);
  if (payload.clearFirst === true) clearDataRows(sheet);
  const rows = (payload.rows || []).map(rowToValues);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DEFAULT_COLUMNS.length).setValues(rows);
  if (requestId) markProcessed(requestId);
  return {
    ok: true,
    action: 'writeDatasetRows',
    requestId: requestId,
    chunkIndex: payload.chunkIndex || 1,
    chunkCount: payload.chunkCount || 1,
    rowsWritten: rows.length,
  };
}

function ensureSheet(spreadsheet, tabName) {
  return spreadsheet.getSheetByName(tabName) || spreadsheet.insertSheet(tabName);
}

function ensureHeader(sheet) {
  const current = sheet.getRange(1, 1, 1, DEFAULT_COLUMNS.length).getValues()[0];
  const hasHeader = current.some(function(cell) { return String(cell || '').trim(); });
  if (!hasHeader) sheet.getRange(1, 1, 1, DEFAULT_COLUMNS.length).setValues([DEFAULT_COLUMNS]);
}

function clearDataRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), DEFAULT_COLUMNS.length)).clearContent();
}

function rowToValues(row) {
  return DEFAULT_COLUMNS.map(function(column) {
    const value = row && row[column];
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value == null ? '' : value;
  });
}

function alreadyProcessed(requestId) {
  return PropertiesService.getScriptProperties().getProperty(IDEMPOTENCY_PREFIX + requestId) === 'done';
}

function markProcessed(requestId) {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(IDEMPOTENCY_PREFIX + requestId, 'done');
  pruneIdempotency(properties);
}

function pruneIdempotency(properties) {
  const keys = properties.getKeys().filter(function(key) {
    return key.indexOf(IDEMPOTENCY_PREFIX) === 0;
  }).sort();
  while (keys.length > IDEMPOTENCY_KEEP) properties.deleteProperty(keys.shift());
}

function isRetryableError(message) {
  return /backend|exceeded maximum execution time|internal|quota|rate limit|service invoked|temporar|timed out|timeout|too many|try again|unavailable/i.test(String(message || ''));
}

// Run once from the Apps Script editor after updating this file: Google then asks for every permission above.
function authorizeBridge() {
  UrlFetchApp.getRequest('https://www.googleapis.com/drive/v3/about?fields=user');
  return 'Sheets bridge authorized. Drive: ' + DriveApp.getRootFolder().getName();
}

// createSpreadsheet { requestId, title, folderId?, tabs: [{ name, columns, rows, frozenColumns? }] }
// One tab per entry with a bold, frozen header row; each tab's rows go in one setValues call. Larger tabs continue
// with appendRows. If an earlier attempt created the spreadsheet but stopped part-way, the retry rebuilds that same
// spreadsheet instead of making a second one.
function createSpreadsheet(payload) {
  return once(payload, 'createSpreadsheet', function(requestId) {
    const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    if (!tabs.length || tabs.length > 60) throw new Error('tabs must list between 1 and 60 tabs.');
    const folder = payload.folderId ? DriveApp.getFolderById(String(payload.folderId)) : null;
    const properties = PropertiesService.getScriptProperties();
    const draftId = properties.getProperty(DRAFT_PREFIX + requestId);
    const spreadsheet = draftId ? SpreadsheetApp.openById(draftId) : SpreadsheetApp.create(fileName(payload.title, 'Scraper Studio export'));
    if (!draftId) properties.setProperty(DRAFT_PREFIX + requestId, spreadsheet.getId());
    let first = spreadsheet.getSheets()[0];
    if (draftId) {
      first = spreadsheet.insertSheet();
      spreadsheet.getSheets().forEach(function(sheet) { if (sheet.getSheetId() !== first.getSheetId()) spreadsheet.deleteSheet(sheet); });
    }
    const used = {};
    tabs.forEach(function(tab, index) {
      const sheet = index === 0 ? first : spreadsheet.insertSheet(index);
      sheet.setName(uniqueTabName(tab && tab.name, index, used));
      writeTab(sheet, tab || {});
    });
    if (folder) DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
    properties.deleteProperty(DRAFT_PREFIX + requestId);
    return { spreadsheetId: spreadsheet.getId(), url: spreadsheet.getUrl(), tabCount: tabs.length };
  });
}

// appendRows { requestId, spreadsheetId, tabName, rows, startRow? } adds a chunk to a tab createSpreadsheet made.
// With startRow the chunk always lands on the same rows, so writing it twice changes nothing.
function appendRows(payload) {
  return once(payload, 'appendRows', function() {
    const spreadsheet = openSpreadsheet(payload.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(String(payload.tabName || ''));
    if (!sheet) throw new Error('Tab not found: ' + payload.tabName);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length > MAX_ROWS_PER_CALL) throw new Error('Send at most ' + MAX_ROWS_PER_CALL + ' rows per request.');
    if (!rows.length) return { spreadsheetId: spreadsheet.getId(), tabName: sheet.getName(), rowsWritten: 0 };
    const width = rows.reduce(function(widest, row) { return Math.max(widest, Array.isArray(row) ? row.length : 0); }, sheet.getLastColumn());
    if (width > MAX_COLUMNS) throw new Error('A tab can have at most ' + MAX_COLUMNS + ' columns.');
    const startRow = Number(payload.startRow) >= 2 ? Math.floor(Number(payload.startRow)) : sheet.getLastRow() + 1;
    ensureSize(sheet, startRow + rows.length - 1, width);
    sheet.getRange(startRow, 1, rows.length, width).setValues(rows.map(function(row) { return padRow(row, width); }));
    return { spreadsheetId: spreadsheet.getId(), tabName: sheet.getName(), rowsWritten: rows.length, startRow: startRow };
  });
}

// createDoc { requestId, title, folderId?, html } converts HTML into a native Google Doc with one multipart upload
// to the Drive API, using this script's own authorization. Shared drives are supported.
function createDoc(payload) {
  return once(payload, 'createDoc', function() {
    const title = fileName(payload.title, 'Untitled report');
    const html = String(payload.html || '');
    if (!html.trim()) throw new Error('html is required.');
    const folderId = payload.folderId ? DriveApp.getFolderById(String(payload.folderId)).getId() : '';
    const metadata = { name: title, mimeType: DOC_MIME };
    if (folderId) metadata.parents = [folderId];
    const boundary = 'studio' + Utilities.getUuid().replace(/-/g, '');
    const media = utf8(html);
    if (media.length > MAX_FILE_BYTES) throw new Error('Reports must be 5 MB or smaller.');
    const body = utf8('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n')
      .concat(media, utf8('\r\n--' + boundary + '--\r\n'));
    const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: body,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    const text = response.getContentText();
    if (status < 200 || status >= 300) throw new Error(driveError(status, text));
    const file = JSON.parse(text);
    if (!file || !file.id) throw new Error('Google Drive did not return the new document.');
    return { documentId: file.id, url: 'https://docs.google.com/document/d/' + file.id + '/edit', name: file.name || title, folderId: folderId };
  });
}

// createFile { requestId, name, folderId?, mimeType: 'image/png' | 'image/svg+xml', base64 } stores an image as-is.
function createFile(payload) {
  return once(payload, 'createFile', function() {
    const mimeType = String(payload.mimeType || '');
    if (['image/png', 'image/svg+xml'].indexOf(mimeType) < 0) throw new Error('Only PNG and SVG images can be uploaded.');
    const bytes = Utilities.base64Decode(String(payload.base64 || ''));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Images must be between 1 byte and 5 MB.');
    const folder = payload.folderId ? DriveApp.getFolderById(String(payload.folderId)) : DriveApp.getRootFolder();
    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName(payload.name, 'Image')));
    return { fileId: file.getId(), url: file.getUrl(), name: file.getName(), folderId: payload.folderId ? folder.getId() : '' };
  });
}

// A file-creating request runs at most once per requestId. The script lock makes a retry that arrives while the
// first attempt is still running wait for it, then return the remembered result instead of creating a copy.
function once(payload, action, create) {
  const requestId = String(payload.requestId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(requestId)) throw new Error('requestId is required (8-160 letters, digits, or . _ : -).');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) throw new Error('The bridge is busy with another request. Try again in a minute.');
  try {
    const previous = rememberedResult(requestId);
    if (previous) {
      previous.duplicate = true;
      return previous;
    }
    const result = create(requestId);
    result.ok = true;
    result.action = action;
    result.requestId = requestId;
    rememberResult(requestId, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function rememberedResult(requestId) {
  const saved = PropertiesService.getScriptProperties().getProperty(RESULT_PREFIX + requestId);
  if (!saved) return null;
  try {
    return JSON.parse(saved).result || null;
  } catch (error) {
    return null;
  }
}

function rememberResult(requestId, result) {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(RESULT_PREFIX + requestId, JSON.stringify({ at: Date.now(), result: result }));
  const saved = properties.getProperties();
  const keys = Object.keys(saved).filter(function(key) { return key.indexOf(RESULT_PREFIX) === 0; });
  if (keys.length <= RESULT_KEEP) return;
  keys.sort(function(a, b) { return savedAt(saved[a]) - savedAt(saved[b]); });
  keys.slice(0, keys.length - RESULT_KEEP).forEach(function(key) { properties.deleteProperty(key); });
}

function savedAt(value) {
  try {
    return Number(JSON.parse(value).at) || 0;
  } catch (error) {
    return 0;
  }
}

function writeTab(sheet, tab) {
  const columns = Array.isArray(tab.columns) ? tab.columns : [];
  const rows = Array.isArray(tab.rows) ? tab.rows : [];
  if (rows.length > MAX_ROWS_PER_CALL) throw new Error('Send at most ' + MAX_ROWS_PER_CALL + ' rows per request.');
  const width = rows.reduce(function(widest, row) { return Math.max(widest, Array.isArray(row) ? row.length : 0); }, columns.length);
  if (width > MAX_COLUMNS) throw new Error('A tab can have at most ' + MAX_COLUMNS + ' columns.');
  if (!width) return;
  ensureSize(sheet, rows.length + 1, width);
  sheet.getRange(1, 1, 1, width).setValues([padRow(columns, width)]).setFontWeight('bold').setBackground('#f1f4f2');
  sheet.setFrozenRows(1);
  const frozen = Number(tab.frozenColumns);
  if (frozen >= 1 && frozen <= 10 && frozen < width) sheet.setFrozenColumns(Math.floor(frozen));
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows.map(function(row) { return padRow(row, width); }));
}

function padRow(row, width) {
  const values = (Array.isArray(row) ? row : []).slice(0, width).map(cellValue);
  while (values.length < width) values.push('');
  return values;
}

// Numbers and booleans stay numbers and booleans. Text that Sheets would otherwise turn into a formula, number or
// date gets a leading apostrophe, which keeps it as the exact text that was sent.
function cellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  const text = (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, MAX_CELL_CHARS);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || sheetsWouldConvert(text) ? "'" + text : text;
}

function sheetsWouldConvert(text) {
  return /\d/.test(text) && /^\s*(?:[$€£¥]\s*)?(?:[\d.,]+\s*%?|\d+(?:\.\d+)?[eE][+-]?\d+|\d{1,4}[-\/.]\d{1,2}(?:[-\/.]\d{1,4})?(?:[ T]\d{1,2}:\d{2}.*)?|\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\s*$/.test(text);
}

function uniqueTabName(raw, index, used) {
  const base = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || ('Sheet' + (index + 1));
  let name = base;
  let copy = 2;
  while (used[name.toLowerCase()]) {
    const suffix = ' (' + (copy++) + ')';
    name = base.slice(0, 100 - suffix.length).trim() + suffix;
  }
  used[name.toLowerCase()] = true;
  return name;
}

// New sheets start at 1,000 rows and 26 columns; ranges past that edge must be added before writing.
function ensureSize(sheet, rows, columns) {
  const maxRows = sheet.getMaxRows();
  const maxColumns = sheet.getMaxColumns();
  if (rows > maxRows) sheet.insertRowsAfter(maxRows, rows - maxRows);
  if (columns > maxColumns) sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
}

function fileName(value, fallback) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || fallback;
}

function utf8(text) {
  return Utilities.newBlob('').setDataFromString(String(text), 'UTF-8').getBytes();
}

function driveError(status, text) {
  let detail = '';
  try {
    detail = JSON.parse(text).error.message || '';
  } catch (error) {
    detail = '';
  }
  if (status === 429 || status >= 500) return 'Google Drive is temporarily unavailable (' + status + '). Try again in a minute.';
  return 'Google Drive refused the document (' + status + ')' + (detail ? ': ' + detail : '.');
}
