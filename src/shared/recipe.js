const { validateBrandContext } = require('./brand-context');
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|cookie|csrf|password|proxyPassword|secret|session|token)/i;

function toId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('Expected a JSON object.');
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed;
}

function restoreSecretFields(value, previous, field = '') {
  if (SECRET_KEY_PATTERN.test(field) && value === '[redacted]') {
    if (previous == null || previous === '[redacted]') {
      throw new Error(`Re-enter the saved value for "${field}" before saving or testing this recipe.`);
    }
    return previous;
  }
  if (Array.isArray(value)) return value.map((item, index) => restoreSecretFields(item, previous?.[index]));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    restoreSecretFields(item, previous && Object.hasOwn(previous, key) ? previous[key] : undefined, key),
  ]));
}

function validateRunOptions(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Run limits must be an object.');
  const maxTotalChargeUsd = Number(value.maxTotalChargeUsd);
  const timeoutSecs = Number(value.timeoutSecs);
  if (!Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd <= 0 || maxTotalChargeUsd > 100) throw new Error('Run budget must be greater than $0 and no more than $100.');
  if (!Number.isInteger(timeoutSecs) || timeoutSecs < 30 || timeoutSecs > 3600) throw new Error('Run timeout must be between 30 and 3600 seconds.');
  return { maxTotalChargeUsd, timeoutSecs };
}

function validateMarketingBrief(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Marketing brief must be an object.');
  const allowed = ['competitor-positioning', 'campaign-message-audit', 'launch-research', 'account-research', 'content-opportunity', 'voice-of-customer', 'ad-creative-research', 'weekly-competitor-changes'];
  if (!allowed.includes(value.templateId) || value.reportPresetId !== value.templateId) throw new Error('Unknown marketing starter.');
  const brief = { templateId: value.templateId, reportPresetId: value.reportPresetId, templateVersion: 1 };
  for (const [key, max] of Object.entries({ brand: 120, decision: 2000, audience: 800 })) {
    brief[key] = String(value[key] || '').trim();
    if ((key !== 'audience' && !brief[key]) || brief[key].length > max) throw new Error('Marketing brief ' + key + ' is missing or too long.');
  }
  if (!Array.isArray(value.sourceUrls) || !value.sourceUrls.length || value.sourceUrls.length > 15) throw new Error('Choose 1 to 15 source pages.');
  brief.sourceUrls = [...new Set(value.sourceUrls.map((source) => {
    let url;
    try { url = new URL(source); } catch { throw new Error('Source page URL is invalid.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use public HTTP or HTTPS pages without embedded credentials.');
    url.hash = '';
    return url.href;
  }))];
  if (value.brandContext) brief.brandContext = validateBrandContext(value.brandContext);
  if (value.brandProfileId) brief.brandProfileId = String(value.brandProfileId).slice(0, 160);
  if (value.templateId === 'account-research' && !brief.brandContext?.icp) throw new Error('Account research needs your saved ICP criteria.');
  return brief;
}

function validateSearchContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Search context must be an object.');
  if (!['reddit', 'x', 'linkedin-search', 'linkedin-profile'].includes(value.sourceId)) throw new Error('Unknown search source.');
  // Rebuild the documented collection contract rather than trusting supplied row caps.
  const { buildSearchRecipes } = require('./source-catalog');
  const plan = buildSearchRecipes({
    query: value.query,
    platformIds: [value.sourceId],
    sourceUrls: value.sourceUrls,
    maxItems: value.requestedMaxItems ?? value.maxItems,
    sourceOptions: value.sourceOptions ? { [value.sourceId]: value.sourceOptions } : {},
  });
  return plan.recipes[0].searchContext;
}

function validateRecipe(input, previousRecipe = null) {
  const recipe = input || {};
  const name = String(recipe.name || '').trim();
  const platform = String(recipe.platform || '').trim();
  const actorId = String(recipe.actorId || '').trim();
  const taskId = String(recipe.taskId || '').trim();

  if (!name) throw new Error('Recipe name is required.');
  if (!platform) throw new Error('Platform is required.');
  if (!actorId && !taskId) throw new Error('Actor ID or task ID is required.');
  if (actorId && taskId) throw new Error('Use either actor ID or task ID, not both.');

  const sameResource = previousRecipe && recipe.id === previousRecipe.id
    && actorId === previousRecipe.actorId && taskId === previousRecipe.taskId;
  const inputJson = restoreSecretFields(
    parseJsonObject(recipe.inputJson || recipe.input || {}, {}),
    sameResource ? previousRecipe.input : undefined,
  );
  const mapper = parseJsonObject(recipe.mapperJson || recipe.mapper || {}, {});

  return {
    id: recipe.id || toId('recipe'),
    name,
    platform,
    actorId,
    taskId,
    input: inputJson,
    mapper,
    ...(recipe.runOptions ? { runOptions: validateRunOptions(recipe.runOptions) } : {}),
    ...(recipe.searchContext ? { searchContext: validateSearchContext(recipe.searchContext) } : {}),
    ...(recipe.marketingBrief ? { marketingBrief: validateMarketingBrief(recipe.marketingBrief) } : {}),
    proxyNote: String(recipe.proxyNote || '').trim(),
    createdAt: recipe.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (SECRET_KEY_PATTERN.test(key)) return [key, '[redacted]'];
    return [key, redactSecrets(item)];
  }));
}

function publicRecipe(recipe) {
  return {
    ...recipe,
    input: redactSecrets(recipe.input || {}),
  };
}

module.exports = {
  SECRET_KEY_PATTERN,
  parseJsonObject,
  publicRecipe,
  redactSecrets,
  toId,
  validateRecipe,
};
