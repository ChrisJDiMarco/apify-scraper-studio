const { normalizeDataset } = require('./normalize');
const { validateRecipe } = require('./recipe');

const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

async function listAllDatasetItems(client, datasetId, maxItems = 5000, pageSize = 1000) {
  const items = [];
  let offset = 0;

  while (items.length < maxItems) {
    const limit = Math.min(pageSize, maxItems - items.length);
    const page = await client.dataset(datasetId).listItems({ offset, limit, clean: true });
    const pageItems = page.items || [];
    items.push(...pageItems);
    offset += page.count ?? pageItems.length;
    if (!pageItems.length || items.length >= (page.total ?? items.length)) break;
  }

  return items;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => (
    /api[_-]?key|authorization|bearer|cookie|csrf|password|proxyPassword|secret|session|token/i.test(key)
      ? [key, '[redacted]']
      : [key, redact(item)]
  )));
}

function templateFromSchema(schema = {}, example = {}) {
  if (example && typeof example === 'object' && !Array.isArray(example) && Object.keys(example).length) return redact(example);
  const properties = schema.properties || {};
  return Object.fromEntries(Object.entries(properties).map(([key, config = {}]) => {
    if (config.default !== undefined) return [key, config.default];
    if (config.prefill !== undefined) return [key, config.prefill];
    if (config.type === 'array') return [key, []];
    if (config.type === 'integer' || config.type === 'number') return [key, 0];
    if (config.type === 'boolean') return [key, false];
    return [key, ''];
  }));
}

function fallbackDiscovery(resourceId, kind, warning) {
  return {
    id: resourceId,
    kind,
    title: resourceId,
    description: '',
    schema: {
      type: 'object',
      properties: {
        startUrls: { type: 'array', title: 'Start URLs' },
        search: { type: 'string', title: 'Search query' },
        maxItems: { type: 'integer', title: 'Max items' },
      },
    },
    inputTemplate: { startUrls: [], maxItems: 1000 },
    mapperTemplate: { text: 'text', author: 'author', url: 'url', externalId: 'id', publishedAt: 'publishedAt' },
    warnings: [warning].filter(Boolean),
  };
}

async function discoverApifyResource(payload = {}, options = {}) {
  const actorId = String(payload.actorId || '').trim().slice(0, 180);
  const taskId = String(payload.taskId || '').trim().slice(0, 180);
  if (!actorId && !taskId) throw new Error('Actor ID or task ID is required.');
  if (!options.token) return fallbackDiscovery(actorId || taskId, actorId ? 'actor' : 'task', 'Add APIFY_API_TOKEN to fetch live schema metadata.');
  if (!options.Client) throw new Error('Missing Apify client.');

  const client = new options.Client({ token: options.token });
  if (taskId) {
    const taskClient = client.task(taskId);
    const task = await taskClient.get();
    if (!task) throw new Error('Apify task not found.');
    const input = task.input || await taskClient.getInput?.() || {};
    return {
      ...fallbackDiscovery(taskId, 'task'),
      title: task.title || task.name || taskId,
      description: task.description || '',
      inputTemplate: redact(input),
      warnings: task.actId ? [`Task uses Actor ${task.actId}.`] : [],
    };
  }

  const actorClient = client.actor(actorId);
  const actor = await actorClient.get();
  if (!actor) throw new Error('Apify Actor not found.');
  const buildClient = actorClient.defaultBuild ? await actorClient.defaultBuild().catch(() => null) : null;
  const build = buildClient?.get ? await buildClient.get().catch(() => null) : null;
  const schema = build?.actorDefinition?.input || parseJson(build?.inputSchema, null) || {};
  const example = parseJson(actor.exampleRunInput?.body, null) || actor.exampleRunInput || {};
  return {
    ...fallbackDiscovery(actorId, 'actor'),
    title: actor.title || actor.name || actorId,
    description: actor.description || actor.readmeSummary || '',
    schema: schema && Object.keys(schema).length ? schema : fallbackDiscovery(actorId, 'actor').schema,
    inputTemplate: templateFromSchema(schema, example),
    warnings: [
      actor.isDeprecated ? 'Actor is marked deprecated on Apify.' : '',
      schema && Object.keys(schema).length ? '' : 'No live input schema found; using a safe starter template.',
    ].filter(Boolean),
  };
}

async function waitForStartedRun(client, startedRun, options = {}) {
  let run = startedRun;
  while (run && !TERMINAL_RUN_STATUSES.has(run.status)) {
    if (options.isCancelled?.()) {
      await client.run(run.id).abort({ gracefully: true }).catch(() => null);
      throw new Error('Job cancelled.');
    }
    run = await client.run(run.id).get({ waitForFinish: Math.min(60, Number(options.waitSecs) || 10) }) || run;
    options.onStatus?.(run);
  }
  return run;
}

function createApifyRunner({ token, Client }) {
  if (!token) throw new Error('Missing APIFY_API_TOKEN.');
  if (!Client) throw new Error('Missing Apify client.');
  const client = new Client({ token });

  return {
    async runRecipe(inputRecipe, options = {}) {
      const recipe = validateRecipe(inputRecipe);
      const target = recipe.taskId ? client.task(recipe.taskId) : client.actor(recipe.actorId);
      if (!target?.start && !target?.call) throw new Error('Selected Apify resource cannot be run.');

      const started = target.start
        ? await target.start(recipe.input || {}, { maxItems: options.maxItems })
        : await target.call(recipe.input || {});
      options.onRunStarted?.(started);
      const run = target.start ? await waitForStartedRun(client, started, options) : started;
      if (run?.status && run.status !== 'SUCCEEDED' && TERMINAL_RUN_STATUSES.has(run.status)) {
        throw new Error(`Apify run finished with status ${run.status}.`);
      }
      if (!run?.defaultDatasetId) throw new Error('Apify run finished without a default dataset.');

      const rawItems = await listAllDatasetItems(client, run.defaultDatasetId, options.maxItems || 5000);
      const normalizedItems = normalizeDataset(rawItems, {
        mapper: recipe.mapper,
        platform: recipe.platform,
        runId: run.id,
      });

      return {
        run,
        rawItems,
        normalizedItems,
      };
    },
  };
}

module.exports = {
  createApifyRunner,
  discoverApifyResource,
  listAllDatasetItems,
};
