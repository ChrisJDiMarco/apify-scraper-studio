const fs = require('fs');
const path = require('path');

const EVENT_VERSION = 1;
const ACTIVE_STATUSES = ['active', 'watching', 'paused', 'archived'];
const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused'];
const ACTION_NAMES = ['run-recipe', 'analyze-dataset', 'export-dataset', 'create-card', 'generate-assets', 'test-recipe'];

const MISSION_PRESETS = [
  {
    id: 'lead-sheet',
    name: 'Lead Sheet',
    description: 'Find prospects, produce a sourced lead report, export CSV, and create a follow-up card.',
    actions: ['analyze-dataset', 'export-dataset', 'create-card'],
    reportPresetId: 'lead-list',
  },
  {
    id: 'competitor-watch',
    name: 'Competitor Watch',
    description: 'Track competitor moves, pricing, positioning, and product shifts.',
    actions: ['analyze-dataset', 'create-card'],
    reportPresetId: 'competitive-report',
  },
  {
    id: 'reddit-pulse',
    name: 'Reddit Pulse',
    description: 'Turn Reddit and community chatter into threads, objections, and opportunities.',
    actions: ['analyze-dataset', 'create-card'],
    reportPresetId: 'subreddit-pulse',
  },
  {
    id: 'hiring-scan',
    name: 'Hiring Scan',
    description: 'Find hiring signals and infer buying intent from job posts and career pages.',
    actions: ['analyze-dataset', 'export-dataset', 'create-card'],
    reportPresetId: 'lead-list',
  },
  {
    id: 'review-mining',
    name: 'Review Mining',
    description: 'Mine reviews for pain points, language, objections, and product opportunities.',
    actions: ['analyze-dataset', 'create-card'],
    reportPresetId: 'market-scan',
  },
  {
    id: 'influencer-map',
    name: 'Influencer Map',
    description: 'Identify accounts, authors, creators, and repeated signal sources worth tracking.',
    actions: ['analyze-dataset', 'export-dataset'],
    reportPresetId: 'account-intelligence',
  },
  {
    id: 'launch-angles',
    name: 'Launch Angles',
    description: 'Turn fresh market data into positioning angles, social copy, and campaign assets.',
    actions: ['analyze-dataset', 'create-card', 'generate-assets'],
    reportPresetId: 'market-scan',
  },
];

function nowIso(now = () => new Date().toISOString()) {
  const value = typeof now === 'function' ? now() : now;
  return new Date(value).toISOString();
}

function slug(value, fallback = 'item') {
  const text = String(value || fallback).toLowerCase().trim()
    .replace(/[^a-z0-9._~@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(list(values).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createEvent(type, payload = {}, options = {}) {
  const timestamp = nowIso(options.now);
  return {
    id: options.id || `event-${slug(type)}-${Date.parse(timestamp)}-${Math.random().toString(36).slice(2, 8)}`,
    version: EVENT_VERSION,
    type,
    payload,
    createdAt: timestamp,
    meta: {
      source: options.source || 'local-v5',
      ...(options.meta || {}),
    },
  };
}

function appendEvent(filePath, event) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
  return event;
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function presetById(id) {
  return MISSION_PRESETS.find((preset) => preset.id === id) || MISSION_PRESETS[0];
}

function createMission(input = {}, options = {}) {
  const createdAt = nowIso(options.now);
  const preset = presetById(input.presetId || 'lead-sheet');
  const id = input.id || `mission-${slug(input.name || preset.name)}`;
  return {
    id,
    name: cleanText(input.name || preset.name),
    presetId: input.presetId || preset.id,
    status: ACTIVE_STATUSES.includes(input.status) ? input.status : 'active',
    goal: cleanText(input.goal || preset.description),
    description: cleanText(input.description || preset.description),
    recipeIds: unique(input.recipeIds),
    runIds: unique(input.runIds),
    datasetIds: unique(input.datasetIds),
    analysisIds: unique(input.analysisIds),
    cardIds: unique(input.cardIds),
    assetIds: unique(input.assetIds),
    exportIds: unique(input.exportIds),
    createdAt: input.createdAt || createdAt,
    updatedAt: input.updatedAt || createdAt,
  };
}

function defaultMissionFromLegacy(data = {}, options = {}) {
  const project = list(data.projects)[0] || {};
  return createMission({
    id: `mission-${slug(project.id || 'default')}`,
    name: project.name || 'Default Mission',
    presetId: 'lead-sheet',
    recipeIds: list(data.recipes).map((item) => item.id),
    runIds: list(data.runs).map((item) => item.id),
    datasetIds: list(data.datasets).map((item) => item.id),
    analysisIds: list(data.analyses).map((item) => item.id),
    cardIds: list(data.cards).map((item) => item.id),
    assetIds: list(data.assets).map((item) => item.id),
    createdAt: project.createdAt,
  }, options);
}

function migrateLegacyDataToEvents(data = {}, options = {}) {
  return [createEvent('legacy-imported', { data }, { now: options.now, source: 'legacy-data-json' })];
}

function emptyProjection(options = {}) {
  return {
    version: 5,
    projectedAt: nowIso(options.now),
    missions: [],
    activeMissionId: '',
    recipeVersions: {},
    schedules: {},
    jobs: [],
    timeline: [],
    evidence: [],
    artifacts: [],
    missionPresets: MISSION_PRESETS,
    migrations: [],
  };
}

function jobFromPayload(payload = {}, timestamp = '') {
  return {
    id: payload.id || `job-${Date.parse(timestamp)}`,
    missionId: payload.missionId || '',
    kind: payload.kind || 'job',
    title: payload.title || payload.kind || 'Job',
    status: payload.status || 'running',
    sourceAction: payload.sourceAction || null,
    progress: numeric(payload.progress),
    attempts: Math.max(1, numeric(payload.attempts) || 1),
    logsPath: payload.logsPath || '',
    artifacts: list(payload.artifacts),
    metrics: payload.metrics || {},
    startedAt: payload.startedAt || timestamp,
    updatedAt: timestamp,
    finishedAt: payload.finishedAt || '',
    error: payload.error || '',
  };
}

function upsertById(listValue, record) {
  const items = list(listValue);
  const index = items.findIndex((item) => item.id === record.id);
  if (index >= 0) items[index] = record;
  else items.unshift(record);
  return items;
}

function projectLegacy(state, data, event) {
  const mission = defaultMissionFromLegacy(data, { now: () => event.createdAt });
  state.missions = upsertById(state.missions, mission);
  state.activeMissionId = mission.id;
  for (const recipe of list(data.recipes)) {
    state.recipeVersions[recipe.id] = [{
      version: 1,
      recipeId: recipe.id,
      name: recipe.name || recipe.id,
      input: recipe.input || {},
      mapper: recipe.mapper || {},
      actorId: recipe.actorId || '',
      taskId: recipe.taskId || '',
      platform: recipe.platform || '',
      createdAt: event.createdAt,
    }];
  }
  for (const asset of list(data.assets)) {
    state.artifacts = upsertById(state.artifacts, {
      id: asset.id,
      missionId: mission.id,
      cardId: asset.cardId || '',
      title: asset.title || asset.id,
      status: asset.status || 'draft',
      evidenceIds: list(asset.evidenceIds),
      markdown: asset.markdown || '',
      updatedAt: asset.updatedAt || asset.createdAt || event.createdAt,
    });
  }
  state.timeline.unshift({
    id: event.id,
    kind: 'legacy-imported',
    missionId: mission.id,
    label: 'Imported legacy workspace',
    createdAt: event.createdAt,
  });
  state.migrations.push({ id: event.id, kind: 'legacy-imported', createdAt: event.createdAt });
}

function projectEvents(events = [], options = {}) {
  const state = emptyProjection(options);
  for (const event of list(events)) {
    const payload = event.payload || {};
    if (event.version && event.version > EVENT_VERSION) continue;
    if (event.type === 'legacy-imported') {
      projectLegacy(state, payload.data || {}, event);
      continue;
    }
    if (event.type === 'mission-saved') {
      const mission = createMission(payload.mission || payload, { now: () => event.createdAt });
      state.missions = upsertById(state.missions, mission);
      state.activeMissionId = state.activeMissionId || mission.id;
      state.timeline.unshift({ id: event.id, missionId: mission.id, kind: 'mission-saved', label: `Saved ${mission.name}`, createdAt: event.createdAt });
    }
    if (event.type === 'mission-status-changed') {
      state.missions = state.missions.map((mission) => (
        mission.id === payload.missionId
          ? { ...mission, status: ACTIVE_STATUSES.includes(payload.status) ? payload.status : mission.status, updatedAt: event.createdAt }
          : mission
      ));
      state.timeline.unshift({ id: event.id, missionId: payload.missionId, kind: 'mission-status-changed', label: `Mission ${payload.status}`, createdAt: event.createdAt });
    }
    if (event.type === 'mission-scheduled') {
      state.schedules[payload.missionId] = { ...payload.schedule, missionId: payload.missionId, updatedAt: event.createdAt };
      state.timeline.unshift({ id: event.id, missionId: payload.missionId, kind: 'mission-scheduled', label: `Scheduled ${payload.schedule?.cadence || 'mission'}`, createdAt: event.createdAt });
    }
    if (event.type === 'recipe-version-saved') {
      const recipeId = payload.recipeId || payload.version?.recipeId;
      const current = state.recipeVersions[recipeId] || [];
      state.recipeVersions[recipeId] = [
        {
          recipeId,
          createdAt: event.createdAt,
          ...(payload.version || {}),
        },
        ...current,
      ].sort((a, b) => numeric(b.version) - numeric(a.version));
      state.timeline.unshift({ id: event.id, kind: 'recipe-version-saved', label: `Saved recipe v${payload.version?.version || ''}`, createdAt: event.createdAt });
    }
    if (event.type === 'job-started') {
      state.jobs = upsertById(state.jobs, jobFromPayload(payload, event.createdAt));
      state.timeline.unshift({ id: event.id, missionId: payload.missionId || '', kind: 'job-started', label: payload.title || payload.kind || 'Job started', createdAt: event.createdAt });
    }
    if (event.type === 'job-progressed') {
      state.jobs = state.jobs.map((job) => (
        job.id === payload.id
          ? { ...job, progress: numeric(payload.progress), status: payload.status || job.status, updatedAt: event.createdAt, logsPath: payload.logsPath || job.logsPath, metrics: { ...(job.metrics || {}), ...(payload.metrics || {}) } }
          : job
      ));
    }
    if (event.type === 'job-finished') {
      state.jobs = state.jobs.map((job) => (
        job.id === payload.id
          ? {
              ...job,
              status: JOB_STATUSES.includes(payload.status) ? payload.status : 'succeeded',
              error: payload.error || '',
              metrics: { ...(job.metrics || {}), ...(payload.metrics || {}) },
              artifacts: list(payload.artifacts).length ? payload.artifacts : job.artifacts,
              finishedAt: payload.finishedAt || event.createdAt,
              updatedAt: event.createdAt,
            }
          : job
      ));
    }
    if (event.type === 'evidence-indexed') {
      state.evidence = [
        ...list(payload.evidence),
        ...state.evidence,
      ];
    }
    if (event.type === 'artifact-saved') {
      state.artifacts = upsertById(state.artifacts, {
        ...(payload.artifact || {}),
        updatedAt: event.createdAt,
      });
    }
  }
  return state;
}

function fieldSet(items) {
  const fields = new Map();
  for (const item of list(items)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) {
      const value = item[key];
      const current = fields.get(key) || { name: key, present: 0, types: new Set(), examples: [] };
      if (value !== undefined && value !== null && value !== '') {
        current.present += 1;
        current.types.add(Array.isArray(value) ? 'array' : typeof value);
        if (current.examples.length < 3) current.examples.push(value);
      }
      fields.set(key, current);
    }
  }
  return Array.from(fields.values()).map((field) => ({
    name: field.name,
    coverage: list(items).length ? Number((field.present / list(items).length).toFixed(2)) : 0,
    types: Array.from(field.types).sort(),
    examples: field.examples,
  })).sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name));
}

function itemText(item) {
  return cleanText(item?.text || item?.title || item?.body || item?.description || item?.content || item?.name || '');
}

function itemUrl(item) {
  return cleanText(item?.url || item?.href || item?.link || item?.permalink || item?.postUrl || item?.website || '');
}

function itemPublishedAt(item) {
  return cleanText(item?.publishedAt || item?.createdAt || item?.date || item?.timestamp || '');
}

function buildDatasetProfileV2(dataset = {}, payload = {}, options = {}) {
  const items = list(payload.items);
  const keys = new Set();
  const rowTypes = new Map();
  const dates = [];
  let textCount = 0;
  let urlCount = 0;
  for (const item of items) {
    const key = item?.id || `${itemText(item)}|${itemUrl(item)}`;
    if (key) keys.add(key);
    rowTypes.set(item?.type || 'row', (rowTypes.get(item?.type || 'row') || 0) + 1);
    if (itemText(item)) textCount += 1;
    if (itemUrl(item)) urlCount += 1;
    const date = Date.parse(itemPublishedAt(item));
    if (Number.isFinite(date)) dates.push(date);
  }
  const rowCount = items.length;
  const duplicateCount = Math.max(0, rowCount - keys.size);
  const textCoverage = rowCount ? textCount / rowCount : 0;
  const urlCoverage = rowCount ? urlCount / rowCount : 0;
  const mapperWarnings = [];
  const qualityWarnings = [];
  if (rowCount && textCoverage < 0.4) mapperWarnings.push('Map a readable text/title/body field before running analyst reports.');
  if (rowCount && urlCoverage < 0.25) mapperWarnings.push('Map source URL/permalink fields so evidence can be inspected.');
  if (duplicateCount > 0) qualityWarnings.push(`${duplicateCount} duplicate row${duplicateCount === 1 ? '' : 's'} detected.`);
  const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : '';
  const oldest = dates.length ? new Date(Math.min(...dates)).toISOString() : '';
  const now = Date.parse(nowIso(options.now));
  const ageHours = newest ? Math.round((now - Date.parse(newest)) / 36e5) : null;
  const confidence = Number(clamp(0.25 + textCoverage * 0.34 + urlCoverage * 0.22 + Math.min(rowCount, 100) / 500 - Math.min(duplicateCount, 20) / 100, 0, 0.98).toFixed(2));
  return {
    datasetId: dataset.id || '',
    name: dataset.name || 'Dataset',
    platform: dataset.platform || '',
    rowCount,
    fields: fieldSet(items),
    rowTypes: Array.from(rowTypes.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    textCoverage: Number(textCoverage.toFixed(2)),
    urlCoverage: Number(urlCoverage.toFixed(2)),
    duplicateCount,
    freshness: { newest, oldest, ageHours },
    mapperWarnings,
    qualityWarnings,
    confidence,
    recommendedFixes: [
      ...mapperWarnings.map((warning) => ({ severity: 'high', message: warning })),
      ...qualityWarnings.map((warning) => ({ severity: 'medium', message: warning })),
    ],
  };
}

function evidenceId(datasetId, item, index) {
  return `evidence-${slug(datasetId)}-${slug(item?.id || item?.externalId || index)}`;
}

function buildEvidenceIndex(dataset = {}, payload = {}) {
  return list(payload.items).map((item, index) => {
    const text = itemText(item);
    const sourceUrl = itemUrl(item);
    const confidence = Number(clamp(0.35 + (text ? 0.28 : 0) + (sourceUrl ? 0.24 : 0) + (item?.id ? 0.1 : 0), 0.1, 0.98).toFixed(2));
    return {
      id: evidenceId(dataset.id || 'dataset', item, index),
      datasetId: dataset.id || '',
      runId: dataset.runId || item?.runId || '',
      recipeId: dataset.recipeId || '',
      itemId: item?.id || item?.externalId || `${index}`,
      type: item?.type || 'row',
      text,
      author: item?.author || '',
      sourceUrl,
      publishedAt: itemPublishedAt(item),
      metrics: item?.metrics || {},
      confidence,
      provenance: {
        datasetName: dataset.name || '',
        platform: dataset.platform || item?.platform || '',
        rowIndex: index,
      },
    };
  });
}

function searchEvidence(evidence = [], query = '', options = {}) {
  const q = lower(query);
  if (!q) return list(evidence).slice(0, options.limit || 20);
  return list(evidence)
    .map((item) => {
      const haystack = lower(`${item.text} ${item.author} ${item.sourceUrl} ${item.type}`);
      const score = haystack.includes(q) ? 10 : q.split(/\s+/).reduce((sum, part) => sum + (part && haystack.includes(part) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.confidence - a.item.confidence)
    .slice(0, options.limit || 20)
    .map((entry) => entry.item);
}

function selectedDataset(state = {}) {
  const datasets = list(state.datasets);
  return datasets.find((dataset) => dataset.id === state.selectedDatasetId) || datasets[0] || null;
}

function selectedProfile(state = {}, datasetId = '') {
  return list(state.intelligence?.datasetProfiles).find((profile) => profile.datasetId === datasetId) || null;
}

function buildActionGraph(command = '', state = {}) {
  const text = lower(command);
  const dataset = selectedDataset(state);
  const profile = dataset ? selectedProfile(state, dataset.id) : null;
  const recipe = list(state.recipes)[0] || null;
  const steps = [];
  const missing = [];
  const wantsScrape = /scrape|crawl|collect|run|watch|listen/.test(text);
  const wantsLead = /lead|prospect|csv|sheet/.test(text);
  const wantsCompetitor = /competitor|competitive|pricing|positioning/.test(text);
  const wantsAsset = /asset|post|campaign|launch|copy|linkedin|twitter|x /.test(text);
  const presetId = wantsCompetitor ? 'competitor-watch' : wantsAsset ? 'launch-angles' : wantsLead ? 'lead-sheet' : 'reddit-pulse';
  const preset = presetById(presetId);
  if (wantsScrape || (!dataset && recipe)) {
    if (!recipe) missing.push('Save a recipe before running a scrape step.');
    else steps.push({ id: 'run-recipe', action: 'run-recipe', label: `Run ${recipe.name || recipe.id}`, args: { recipeId: recipe.id }, editable: true });
  }
  if (!dataset) {
    if (!steps.length) missing.push('Select or create a dataset before analysis steps.');
  } else {
    steps.push({
      id: 'analyze-dataset',
      action: 'analyze-dataset',
      label: preset.reportPresetId === 'lead-list' ? 'Build lead report' : 'Build analyst report',
      args: { datasetId: dataset.id, kind: 'report', reportPresetId: preset.reportPresetId || profile?.reportPresetId || 'market-scan' },
      editable: true,
    });
    if (wantsLead || preset.actions.includes('export-dataset')) {
      steps.push({ id: 'export-dataset', action: 'export-dataset', label: 'Export CSV', args: { datasetId: dataset.id, format: 'csv' }, editable: true });
    }
    steps.push({ id: 'create-card', action: 'create-card', label: 'Create production card', args: { datasetId: dataset.id, title: `${dataset.name || 'Dataset'} follow-up` }, editable: true });
    if (wantsAsset || preset.actions.includes('generate-assets')) {
      steps.push({ id: 'generate-assets', action: 'generate-assets', label: 'Generate asset pack', args: { datasetId: dataset.id, presetId: 'launch-pack' }, editable: true });
    }
  }
  return {
    id: `graph-${slug(command || preset.name)}`,
    command: cleanText(command),
    presetId,
    title: preset.name,
    targetDatasetId: dataset?.id || '',
    targetRecipeId: recipe?.id || '',
    steps,
    missing: unique(missing),
    canRun: steps.length > 0 && missing.length === 0,
    createdAt: nowIso(),
  };
}

function validateActionGraph(graph = {}) {
  const errors = [];
  const steps = list(graph.steps);
  if (!steps.length) errors.push('Action graph needs at least one step.');
  for (const step of steps) {
    if (!ACTION_NAMES.includes(step.action)) errors.push(`Unsupported action: ${step.action}`);
    if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) errors.push(`Step ${step.id || step.action} needs args.`);
  }
  return {
    canRun: errors.length === 0 && !list(graph.missing).length,
    errors,
  };
}

function validateSchedule(schedule = {}) {
  const cadence = ['manual', 'hourly', 'daily', 'weekly', 'monthly'].includes(schedule.cadence) ? schedule.cadence : 'manual';
  return {
    cadence,
    timezone: cleanText(schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    quiet: Boolean(schedule.quiet),
    threshold: clamp(Math.round(numeric(schedule.threshold) || 3), 1, 10),
    paused: Boolean(schedule.paused),
    lastRunAt: cleanText(schedule.lastRunAt),
    nextRunAt: cleanText(schedule.nextRunAt),
  };
}

function addCadence(date, cadence) {
  const next = new Date(date.getTime());
  if (cadence === 'hourly') next.setUTCHours(next.getUTCHours() + 1);
  if (cadence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  if (cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function nextScheduleAt(schedule = {}, options = {}) {
  const valid = validateSchedule(schedule);
  if (valid.paused || valid.cadence === 'manual') return '';
  const from = Date.parse(options.from || nowIso(options.now));
  let cursor = Date.parse(valid.nextRunAt || valid.lastRunAt || options.from || nowIso(options.now));
  if (!Number.isFinite(cursor)) cursor = from;
  let next = addCadence(new Date(cursor <= from ? from : cursor), valid.cadence);
  while (next.getTime() <= from) next = addCadence(next, valid.cadence);
  return next.toISOString();
}

function dueSchedules(schedules = {}, options = {}) {
  const current = Date.parse(options.now || nowIso(options.nowFn));
  return Object.values(schedules || {})
    .filter((schedule) => {
      const valid = validateSchedule(schedule);
      const due = Date.parse(valid.nextRunAt);
      return !valid.paused && valid.cadence !== 'manual' && Number.isFinite(due) && due <= current;
    })
    .sort((a, b) => String(a.nextRunAt || '').localeCompare(String(b.nextRunAt || '')));
}

function evaluateArtifact(artifact = {}, evidence = []) {
  const evidenceIds = unique(artifact.evidenceIds);
  const evidenceById = new Map(list(evidence).map((item) => [item.id, item]));
  const matched = evidenceIds.filter((id) => evidenceById.has(id));
  const markdown = cleanText(artifact.markdown || artifact.markdownReport || artifact.summary);
  const sentences = markdown.split(/[.!?]\s+/).map(cleanText).filter((sentence) => sentence.length > 24);
  const unsupported = sentences.filter((sentence) => {
    const sentenceTerms = lower(sentence).split(/\W+/).filter((term) => term.length > 4).slice(0, 8);
    if (!sentenceTerms.length) return false;
    return !matched.some((id) => {
      const ev = evidenceById.get(id);
      const haystack = lower(ev?.text || '');
      return sentenceTerms.some((term) => haystack.includes(term));
    });
  });
  const evidenceCoverage = evidenceIds.length ? matched.length / evidenceIds.length : 0;
  const issues = [];
  if (evidenceIds.length === 0) issues.push('No evidence IDs attached.');
  if (evidenceCoverage < 1) issues.push('Some evidence IDs do not exist in the evidence graph.');
  if (unsupported.length) issues.push(`Unsupported claim count: ${unsupported.length}.`);
  const score = clamp(100 - issues.length * 22 - unsupported.length * 8 + Math.round(evidenceCoverage * 20), 0, 100);
  return {
    passed: score >= 80 && issues.length === 0,
    score,
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    unsupportedClaims: unsupported,
    issues,
  };
}

function scoreEvalSuite(cases = []) {
  const results = list(cases).map((testCase, index) => {
    const result = evaluateArtifact(testCase.artifact || {}, testCase.evidence || []);
    const minScore = numeric(testCase.minScore) || 80;
    return {
      id: testCase.id || `eval-${index + 1}`,
      name: testCase.name || testCase.id || `Eval ${index + 1}`,
      minScore,
      passed: result.score >= minScore && result.passed,
      ...result,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    avgScore: results.length ? Number((results.reduce((sum, result) => sum + result.score, 0) / results.length).toFixed(1)) : 0,
    results,
  };
}

function durationMs(record = {}) {
  const start = Date.parse(record.startedAt || '');
  const finish = Date.parse(record.finishedAt || '');
  return Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? finish - start : 0;
}

function buildObservability(state = {}) {
  const runs = list(state.runs);
  const analyses = list(state.analyses);
  const jobs = list(state.jobs);
  const successfulRuns = runs.filter((run) => run.status === 'succeeded');
  const failedRuns = runs.filter((run) => run.status === 'failed');
  const totalItems = runs.reduce((sum, run) => sum + numeric(run.itemCount), 0);
  const totalRunMs = runs.reduce((sum, run) => sum + durationMs(run), 0);
  const failedAnalyses = analyses.filter((analysis) => analysis.status === 'failed').length;
  const codexEvents = analyses.reduce((sum, analysis) => sum + numeric(analysis.eventCount), 0);
  const outputBytes = jobs.reduce((sum, job) => sum + numeric(job.metrics?.outputBytes), 0);
  return {
    totalRuns: runs.length,
    successfulRuns: successfulRuns.length,
    failedRuns: failedRuns.length,
    failureRate: runs.length ? Number(((failedRuns.length / runs.length) * 100).toFixed(1)) : 0,
    totalItems,
    avgItemsPerRun: runs.length ? Number((totalItems / runs.length).toFixed(1)) : 0,
    avgRunSeconds: runs.length ? Number((totalRunMs / runs.length / 1000).toFixed(1)) : 0,
    failedAnalyses,
    codexEvents,
    outputBytes,
    tokenishOutput: Math.round(outputBytes / 4),
    activeJobs: jobs.filter((job) => job.status === 'running').length,
  };
}

function buildReleaseDiagnostics(context = {}) {
  const env = context.env || {};
  const build = context.packageConfig?.build || {};
  const mac = build.mac || {};
  const hasNotaryCreds = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
  const hasHardenedRuntime = mac.hardenedRuntime === true;
  const hasEntitlements = Boolean(mac.entitlements);
  const publish = build.publish || context.packageConfig?.publish;
  return {
    platform: context.platform || process.platform,
    signing: {
      status: hasHardenedRuntime && hasEntitlements ? 'configured' : 'needs-config',
      hardenedRuntime: hasHardenedRuntime,
      entitlements: mac.entitlements || '',
    },
    notarization: {
      status: hasNotaryCreds ? 'ready' : 'missing-credentials',
      requiredEnv: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    },
    update: {
      status: publish ? 'configured' : 'disabled',
      provider: publish?.provider || '',
    },
    checks: [
      'npm test',
      'npm run test:coverage',
      'npm audit --audit-level=moderate',
      'npm run build',
      'npm run dist',
      'codesign --verify --deep --strict',
      'hdiutil verify',
    ],
  };
}

function createMissionBundle(missionId, state = {}) {
  const mission = list(state.missions).find((item) => item.id === missionId);
  if (!mission) throw new Error('Mission not found.');
  const contains = (ids, id) => list(ids).includes(id);
  return {
    exportedAt: nowIso(),
    mission,
    recipes: list(state.recipes).filter((item) => contains(mission.recipeIds, item.id)),
    runs: list(state.runs).filter((item) => contains(mission.runIds, item.id)),
    datasets: list(state.datasets).filter((item) => contains(mission.datasetIds, item.id)),
    analyses: list(state.analyses).filter((item) => contains(mission.analysisIds, item.id)),
    cards: list(state.cards).filter((item) => contains(mission.cardIds, item.id)),
    assets: list(state.assets || state.artifacts).filter((item) => contains(mission.assetIds, item.id) || item.missionId === mission.id),
    evidence: list(state.evidence).filter((item) => contains(mission.datasetIds, item.datasetId)),
    schedules: state.schedules?.[mission.id] ? [state.schedules[mission.id]] : [],
  };
}

module.exports = {
  ACTION_NAMES,
  EVENT_VERSION,
  JOB_STATUSES,
  MISSION_PRESETS,
  ACTIVE_STATUSES,
  appendEvent,
  buildActionGraph,
  buildDatasetProfileV2,
  buildEvidenceIndex,
  buildObservability,
  buildReleaseDiagnostics,
  cleanText,
  createEvent,
  createMission,
  createMissionBundle,
  dueSchedules,
  evaluateArtifact,
  migrateLegacyDataToEvents,
  nextScheduleAt,
  projectEvents,
  readEvents,
  scoreEvalSuite,
  searchEvidence,
  slug,
  validateActionGraph,
  validateSchedule,
};
