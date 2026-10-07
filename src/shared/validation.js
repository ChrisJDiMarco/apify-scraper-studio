function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value, label, options = {}) {
  const text = String(value ?? '').trim();
  if (options.required && !text) throw new Error(`${label} is required.`);
  if (options.max && text.length > options.max) throw new Error(`${label} is too long.`);
  if (options.pattern && text && !options.pattern.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function enumValue(value, label, allowed) {
  const text = stringValue(value, label, { required: true, max: 80 });
  if (!allowed.includes(text)) throw new Error(`${label} is unsupported.`);
  return text;
}

function boolValue(value) {
  return Boolean(value);
}

function intValue(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number)) throw new Error(`${label} must be a whole number.`);
  if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}

function stringArray(value, label, { maxItems = 100, maxLength = 160 } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > maxItems) throw new Error(`${label} has too many items.`);
  return [...new Set(value.map((item) => stringValue(item, label, { max: maxLength })).filter(Boolean))];
}

function optionalRecord(value, label) {
  if (value == null || value === '') return {};
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function validateKeyName(value, allowed) {
  return enumValue(value, 'Key name', allowed);
}

function validateKeyValue(keyName, value) {
  const text = stringValue(value, keyName, { required: true, max: 3000 });
  if (keyName !== 'GOOGLE_SHEETS_WEBHOOK_URL') return text;
  let url;
  try {
    url = new URL(text);
  } catch (_) {
    throw new Error('Webhook URL is invalid.');
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('Webhook URL must be HTTPS.');
  return text;
}

function validateId(value, label = 'ID') {
  return stringValue(value, label, { required: true, max: 180, pattern: /^[a-z0-9._~@-]+$/i });
}

function parseSpreadsheetId(value) {
  const text = stringValue(value, 'Spreadsheet', { max: 1000 });
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : '';
}

function sheetTab(value, fallback, label) {
  return stringValue(value ?? fallback, label, { max: 80 }) || fallback;
}

function validateSheetSettings(value, current = {}) {
  const sheets = optionalRecord(value, 'Google Sheets settings');
  const workingSpreadsheetUrl = stringValue(sheets.workingSpreadsheetUrl ?? current.workingSpreadsheetUrl, 'Working spreadsheet URL', { max: 1000 });
  const workingSpreadsheetId = parseSpreadsheetId(workingSpreadsheetUrl || sheets.workingSpreadsheetId || current.workingSpreadsheetId);
  if ((workingSpreadsheetUrl || sheets.workingSpreadsheetId) && !workingSpreadsheetId) throw new Error('Spreadsheet URL or ID is invalid.');

  return {
    ...current,
    workingSpreadsheetUrl,
    workingSpreadsheetId,
    archiveFolderId: stringValue(sheets.archiveFolderId ?? current.archiveFolderId, 'Archive folder ID', { max: 240, pattern: /^[a-zA-Z0-9_-]*$/ }),
    twitterTab: sheetTab(sheets.twitterTab, current.twitterTab || 'Twitter', 'Twitter tab'),
    linkedinTab: sheetTab(sheets.linkedinTab, current.linkedinTab || 'LinkedIn', 'LinkedIn tab'),
    redditTab: sheetTab(sheets.redditTab, current.redditTab || 'Reddit', 'Reddit tab'),
    themeRepositoryTab: sheetTab(sheets.themeRepositoryTab, current.themeRepositoryTab || 'Theme Repository', 'Theme repository tab'),
    trendVelocityTab: sheetTab(sheets.trendVelocityTab, current.trendVelocityTab || 'Trend Velocity', 'Trend velocity tab'),
    batchLogTab: sheetTab(sheets.batchLogTab, current.batchLogTab || 'Batch Analysis Log', 'Batch analysis log tab'),
  };
}

function aiBudget(value) {
  const amount = Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(amount) || amount < 0.01 || amount > 100) throw new Error('AI budget must be between $0.01 and $100.');
  return amount;
}

function validateSettings(value, current = {}) {
  const settings = optionalRecord(value, 'Settings');
  return {
    ...current,
    aiProvider: enumValue(settings.aiProvider ?? current.aiProvider ?? 'claude', 'AI provider', ['claude', 'codex']),
    aiModel: stringValue(settings.aiModel ?? current.aiModel ?? 'claude-opus-5-5', 'Claude model', { required: true, max: 160, pattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/ }),
    aiMaxBudgetUsd: aiBudget(settings.aiMaxBudgetUsd ?? current.aiMaxBudgetUsd ?? 1),
    maxItems: intValue(settings.maxItems, 'Max items', { min: 1, max: 10000, fallback: current.maxItems || 1000 }),
    sheets: validateSheetSettings(settings.sheets, current.sheets || {}),
  };
}

function validateMoveCardPayload(value) {
  const payload = optionalRecord(value, 'Move card payload');
  return {
    cardId: validateId(payload.cardId, 'Card ID'),
    column: validateId(payload.column, 'Column'),
    card: payload.card == null ? null : optionalRecord(payload.card, 'Card'),
  };
}

function validateCardPayload(value) {
  const payload = optionalRecord(value, 'Card');
  return {
    ...payload,
    id: payload.id ? validateId(payload.id, 'Card ID') : '',
    title: stringValue(payload.title, 'Card title', { required: true, max: 180 }),
    description: stringValue(payload.description, 'Card description', { max: 2000 }),
    column: stringValue(payload.column || 'detected', 'Column', { max: 80 }),
    tags: stringArray(payload.tags, 'Tags', { maxItems: 20, maxLength: 40 }),
    datasetId: payload.datasetId ? validateId(payload.datasetId, 'Dataset ID') : '',
    signalCount: stringValue(payload.signalCount, 'Signal count', { max: 80 }),
    signalChange: stringValue(payload.signalChange, 'Signal change', { max: 80 }),
    priority: stringValue(payload.priority || 'normal', 'Priority', { max: 80 }),
  };
}

function validateAssetPayload(value) {
  const payload = optionalRecord(value, 'Asset');
  return {
    ...payload,
    id: payload.id ? validateId(payload.id, 'Asset ID') : '',
    cardId: payload.cardId ? validateId(payload.cardId, 'Card ID') : '',
    assetType: stringValue(payload.assetType, 'Asset type', { max: 120 }),
    title: stringValue(payload.title, 'Asset title', { required: true, max: 180 }),
    channel: stringValue(payload.channel, 'Channel', { max: 120 }),
    markdown: stringValue(payload.markdown, 'Markdown', { max: 200000 }),
    status: stringValue(payload.status || 'draft', 'Status', { max: 80 }),
    evidenceIds: stringArray(payload.evidenceIds, 'Evidence IDs', { maxItems: 500, maxLength: 180 }),
  };
}

function validateGenerateAssetsPayload(value) {
  const payload = optionalRecord(value, 'Asset generation payload');
  return {
    card: validateCardPayload(payload.card),
    assetTypeIds: stringArray(payload.assetTypeIds, 'Asset type IDs', { maxItems: 50, maxLength: 120 }),
    datasetId: payload.datasetId ? validateId(payload.datasetId, 'Dataset ID') : '',
  };
}

function validateExportPayload(value) {
  const payload = optionalRecord(value, 'Export payload');
  return {
    datasetId: validateId(payload.datasetId, 'Dataset ID'),
    format: enumValue(payload.format || 'jsonl', 'Export format', ['jsonl', 'csv']),
    reveal: payload.reveal !== false,
  };
}

function validateAnalysisPayload(value) {
  const payload = optionalRecord(value, 'Analysis payload');
  return {
    datasetId: validateId(payload.datasetId, 'Dataset ID'),
    kind: enumValue(payload.kind, 'Analysis kind', ['tag', 'thread', 'report']),
    reportPresetId: payload.reportPresetId ? validateId(payload.reportPresetId, 'Report preset ID') : '',
  };
}

function validateIntentPayload(value) {
  const payload = optionalRecord(value, 'Intent payload');
  return {
    command: stringValue(payload.command, 'Command', { required: true, max: 1000 }),
    datasetId: payload.datasetId ? validateId(payload.datasetId, 'Dataset ID') : '',
  };
}

function validateIntentActionPayload(value) {
  const payload = optionalRecord(value, 'Intent action payload');
  const action = enumValue(payload.action, 'Intent action', ['run-recipe', 'analyze-dataset', 'export-dataset', 'create-card']);
  const args = optionalRecord(payload.args, 'Intent action args');
  const common = {
    id: payload.id ? validateId(payload.id, 'Intent action ID') : action,
    label: stringValue(payload.label || action, 'Intent action label', { max: 180 }),
    action,
  };

  if (action === 'run-recipe') return { ...common, args: { recipeId: validateId(args.recipeId, 'Recipe ID') } };
  if (action === 'analyze-dataset') return { ...common, args: validateAnalysisPayload(args) };
  if (action === 'export-dataset') return { ...common, args: { ...validateExportPayload(args), reveal: false } };
  return {
    ...common,
    args: {
      datasetId: validateId(args.datasetId, 'Dataset ID'),
      title: stringValue(args.title, 'Card title', { max: 180 }),
    },
  };
}

function validateMissionPayload(value) {
  const payload = optionalRecord(value, 'Mission');
  return {
    ...payload,
    id: payload.id ? validateId(payload.id, 'Mission ID') : '',
    name: stringValue(payload.name, 'Mission name', { required: true, max: 180 }),
    presetId: stringValue(payload.presetId || 'lead-sheet', 'Mission preset', { max: 120 }),
    status: stringValue(payload.status || 'active', 'Mission status', { max: 80 }),
    goal: stringValue(payload.goal || payload.description, 'Mission goal', { max: 2000 }),
    recipeIds: stringArray(payload.recipeIds, 'Recipe IDs', { maxItems: 200, maxLength: 180 }),
    datasetIds: stringArray(payload.datasetIds, 'Dataset IDs', { maxItems: 500, maxLength: 180 }),
    analysisIds: stringArray(payload.analysisIds, 'Analysis IDs', { maxItems: 500, maxLength: 180 }),
    cardIds: stringArray(payload.cardIds, 'Card IDs', { maxItems: 500, maxLength: 180 }),
    assetIds: stringArray(payload.assetIds, 'Asset IDs', { maxItems: 500, maxLength: 180 }),
  };
}

function validateSchedulePayload(value) {
  const payload = optionalRecord(value, 'Schedule');
  const cadence = enumValue(payload.cadence || 'manual', 'Schedule cadence', ['manual', 'hourly', 'daily', 'weekly', 'monthly']);
  return {
    cadence,
    timezone: stringValue(payload.timezone || 'UTC', 'Timezone', { max: 80 }),
    quiet: boolValue(payload.quiet),
    threshold: intValue(payload.threshold, 'Meaningful-change threshold', { min: 1, max: 10, fallback: 3 }),
    paused: boolValue(payload.paused),
    lastRunAt: stringValue(payload.lastRunAt, 'Last run date', { max: 80 }),
    nextRunAt: stringValue(payload.nextRunAt, 'Next run date', { max: 80 }),
  };
}

function validateRecipeVersionPayload(value) {
  const payload = optionalRecord(value, 'Recipe version payload');
  const version = optionalRecord(payload.version, 'Recipe version');
  return {
    recipeId: validateId(payload.recipeId || version.recipeId, 'Recipe ID'),
    version: {
      ...version,
      version: intValue(version.version, 'Recipe version', { min: 1, max: 100000, fallback: 1 }),
      name: stringValue(version.name, 'Recipe version name', { max: 180 }),
      input: optionalRecord(version.input, 'Recipe input'),
      mapper: optionalRecord(version.mapper, 'Recipe mapper'),
      notes: stringValue(version.notes, 'Recipe version notes', { max: 2000 }),
    },
  };
}

function validateJobPayload(value) {
  const payload = optionalRecord(value, 'Job');
  return {
    ...payload,
    id: validateId(payload.id, 'Job ID'),
    missionId: payload.missionId ? validateId(payload.missionId, 'Mission ID') : '',
    kind: stringValue(payload.kind, 'Job kind', { required: true, max: 80 }),
    status: enumValue(payload.status || 'queued', 'Job status', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused']),
    title: stringValue(payload.title || payload.kind, 'Job title', { max: 180 }),
    error: stringValue(payload.error, 'Job error', { max: 5000 }),
    progress: intValue(payload.progress, 'Job progress', { min: 0, max: 100, fallback: 0 }),
  };
}

module.exports = {
  boolValue,
  enumValue,
  intValue,
  isRecord,
  optionalRecord,
  stringArray,
  stringValue,
  validateAnalysisPayload,
  validateAssetPayload,
  validateCardPayload,
  validateExportPayload,
  validateGenerateAssetsPayload,
  validateId,
  validateIntentActionPayload,
  validateIntentPayload,
  validateJobPayload,
  validateKeyName,
  validateKeyValue,
  validateMissionPayload,
  validateMoveCardPayload,
  validateRecipeVersionPayload,
  validateSchedulePayload,
  validateSettings,
  validateSheetSettings,
};
