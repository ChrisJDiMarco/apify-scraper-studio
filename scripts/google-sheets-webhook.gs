const RESPONSE_MIME = ContentService.MimeType.JSON;
const IDEMPOTENCY_PREFIX = 'apify_scraper_studio_request_';
const IDEMPOTENCY_KEEP = 250;
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
    if (payload.action === 'ping') return json({ ok: true, action: 'ping', spreadsheetId: payload.spreadsheetId });
    if (payload.action === 'archiveAndClear') return json(archiveAndClear(payload));
    if (payload.action === 'readTabs') return json(readTabs(payload));
    if (payload.action === 'writeDatasetRows') return json(writeDatasetRows(payload));
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
  (payload.tabs || []).forEach(function(tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) {
      out[tabName] = [];
      return;
    }
    out[tabName] = sheetToObjects(sheet);
  });
  return { ok: true, action: 'readTabs', tabs: out };
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
