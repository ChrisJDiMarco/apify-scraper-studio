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

function validateRecipe(input) {
  const recipe = input || {};
  const name = String(recipe.name || '').trim();
  const platform = String(recipe.platform || '').trim();
  const actorId = String(recipe.actorId || '').trim();
  const taskId = String(recipe.taskId || '').trim();

  if (!name) throw new Error('Recipe name is required.');
  if (!platform) throw new Error('Platform is required.');
  if (!actorId && !taskId) throw new Error('Actor ID or task ID is required.');
  if (actorId && taskId) throw new Error('Use either actor ID or task ID, not both.');

  const inputJson = parseJsonObject(recipe.inputJson || recipe.input || {}, {});
  const mapper = parseJsonObject(recipe.mapperJson || recipe.mapper || {}, {});

  return {
    id: recipe.id || toId('recipe'),
    name,
    platform,
    actorId,
    taskId,
    input: inputJson,
    mapper,
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
