function clean(value) {
  return String(value ?? '').trim();
}

function parseSpreadsheetId(value) {
  const text = clean(value);
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : '';
}

function requireSpreadsheetId(settings = {}) {
  const id = parseSpreadsheetId(settings.workingSpreadsheetId || settings.workingSpreadsheetUrl);
  if (!id) throw new Error('Google Sheets working spreadsheet is required.');
  return id;
}

function tabNames(settings = {}) {
  return {
    twitter: clean(settings.twitterTab) || 'Twitter',
    linkedin: clean(settings.linkedinTab) || 'LinkedIn',
    reddit: clean(settings.redditTab) || 'Reddit',
    themeRepository: clean(settings.themeRepositoryTab) || 'Theme Repository',
    trendVelocity: clean(settings.trendVelocityTab) || 'Trend Velocity',
    batchLog: clean(settings.batchLogTab) || 'Batch Analysis Log',
  };
}

function clearTabs(settings = {}) {
  const tabs = tabNames(settings);
  return [tabs.twitter, tabs.linkedin, tabs.reddit, tabs.themeRepository, tabs.trendVelocity, tabs.batchLog];
}

function platformTab(settings = {}, platform = '') {
  const tabs = tabNames(settings);
  const key = clean(platform).toLowerCase();
  if (key === 'x' || key === 'twitter') return tabs.twitter;
  if (key === 'linkedin') return tabs.linkedin;
  if (key === 'reddit') return tabs.reddit;
  return tabs.twitter;
}

function buildArchiveClearRequest(settings = {}, options = {}) {
  const archiveFolderId = clean(settings.archiveFolderId);
  if (!archiveFolderId) throw new Error('Archive folder ID is required before clearing the working sheet.');
  return {
    action: 'archiveAndClear',
    spreadsheetId: requireSpreadsheetId(settings),
    archiveFolderId,
    archiveName: clean(options.archiveName) || `Golden Thread Data ${new Date().toISOString().slice(0, 10)}`,
    tabsToClear: clearTabs(settings),
  };
}

function buildPingRequest(settings = {}) {
  return {
    action: 'ping',
    spreadsheetId: requireSpreadsheetId(settings),
  };
}

function sheetValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value ?? '';
}

function buildDatasetSheetRows(items = []) {
  return items.map((item = {}) => ({
    id: clean(item.id),
    type: clean(item.type),
    platform: clean(item.platform),
    author: clean(item.author),
    text: clean(item.text),
    url: clean(item.url),
    publishedAt: clean(item.publishedAt),
    parentId: clean(item.parentId),
    threadId: clean(item.threadId),
    likes: Number(item.metrics?.likes) || 0,
    comments: Number(item.metrics?.comments) || 0,
    shares: Number(item.metrics?.shares) || 0,
    views: Number(item.metrics?.views) || 0,
    theme: clean(item.theme || item.themeMatch),
    relevant: clean(item.relevant),
    confidence: item.confidence ?? '',
    why: clean(item.why || item.reason),
    painPoint: clean(item.painPoint || item.pain_point || item.pain_point_type),
    urgency: clean(item.urgency || item.urgencySignal || item.urgency_signal),
    entities: sheetValue(item.entities),
  }));
}

function buildDatasetWriteRequest(settings = {}, dataset = {}, items = [], options = {}) {
  return {
    action: 'writeDatasetRows',
    spreadsheetId: requireSpreadsheetId(settings),
    tabName: clean(options.tabName) || platformTab(settings, dataset.platform),
    clearFirst: options.clearFirst === true,
    requestId: clean(options.requestId),
    chunkIndex: Number(options.chunkIndex) || 1,
    chunkCount: Number(options.chunkCount) || 1,
    dataset: {
      id: clean(dataset.id),
      name: clean(dataset.name),
      platform: clean(dataset.platform),
      itemCount: items.length,
    },
    rows: buildDatasetSheetRows(items),
  };
}

function buildDatasetWriteRequests(settings = {}, dataset = {}, items = [], options = {}) {
  const chunkSize = Math.max(1, Math.min(1000, Number(options.chunkSize) || 500));
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) chunks.push(items.slice(index, index + chunkSize));
  const safeChunks = chunks.length ? chunks : [[]];
  const chunkCount = safeChunks.length;
  const requestBase = clean(options.requestId) || `${clean(dataset.id) || 'dataset'}-${Date.now()}`;
  return safeChunks.map((chunk, index) => buildDatasetWriteRequest(settings, dataset, chunk, {
    ...options,
    clearFirst: options.clearFirst === true && index === 0,
    requestId: `${requestBase}-${index + 1}-of-${chunkCount}`,
    chunkIndex: index + 1,
    chunkCount,
  }));
}

function buildSheetReadRequest(settings = {}, options = {}) {
  const tabs = tabNames(settings);
  return {
    action: 'readTabs',
    spreadsheetId: requireSpreadsheetId(settings),
    tabs: Array.isArray(options.tabs) && options.tabs.length ? options.tabs.map(clean).filter(Boolean) : [tabs.twitter, tabs.linkedin, tabs.reddit],
  };
}

function isRetryableSheetStatus(status) {
  const code = Number(status);
  return code === 408 || code === 409 || code === 425 || code === 429 || (code >= 500 && code <= 599);
}

function isRetryableSheetMessage(message) {
  return /backend|exceeded maximum execution time|internal|quota|rate limit|service invoked|temporar|timed out|timeout|too many|try again|unavailable/i.test(clean(message));
}

module.exports = {
  buildArchiveClearRequest,
  buildDatasetSheetRows,
  buildDatasetWriteRequest,
  buildDatasetWriteRequests,
  buildPingRequest,
  buildSheetReadRequest,
  clearTabs,
  isRetryableSheetMessage,
  isRetryableSheetStatus,
  parseSpreadsheetId,
  platformTab,
  tabNames,
};
