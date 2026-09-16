import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import v5 from '../src/shared/v5-core.js';
import validation from '../src/shared/validation.js';

const {
  MISSION_PRESETS,
  appendEvent,
  buildActionGraph,
  buildDatasetProfileV2,
  buildEvidenceIndex,
  buildObservability,
  buildReleaseDiagnostics,
  dueSchedules,
  createEvent,
  createMission,
  createMissionBundle,
  evaluateArtifact,
  migrateLegacyDataToEvents,
  nextScheduleAt,
  projectEvents,
  scoreEvalSuite,
  searchEvidence,
  validateActionGraph,
  validateSchedule,
} = v5;
const {
  validateJobPayload,
  validateMissionPayload,
  validateRecipeVersionPayload,
  validateSchedulePayload,
} = validation;
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const requireFromTest = createRequire(import.meta.url);

const fixedNow = () => '2026-06-29T12:00:00.000Z';

describe('V5 event store and mission model', () => {
  it('migrates legacy data into a replayable mission projection', () => {
    const legacy = {
      projects: [{ id: 'default', name: 'Default Project', createdAt: '2026-01-01T00:00:00.000Z' }],
      recipes: [{ id: 'recipe-1', name: 'Reddit pulse', platform: 'reddit', actorId: 'apify/reddit' }],
      runs: [{ id: 'run-1', recipeId: 'recipe-1', status: 'succeeded', itemCount: 2 }],
      datasets: [{ id: 'dataset-1', recipeId: 'recipe-1', runId: 'run-1', name: 'Reddit data', platform: 'reddit', itemCount: 2 }],
      analyses: [{ id: 'report-1', datasetId: 'dataset-1', kind: 'report', status: 'succeeded', eventCount: 9 }],
      cards: [{ id: 'card-1', datasetId: 'dataset-1', title: 'Follow up', column: 'detected' }],
      assets: [{ id: 'asset-1', cardId: 'card-1', title: 'LinkedIn post', status: 'done', markdown: 'Ship this' }],
      intentRuns: [],
      settings: { maxItems: 1000 },
    };

    const events = migrateLegacyDataToEvents(legacy, { now: fixedNow });
    const projection = projectEvents(events, { now: fixedNow });

    expect(events[0]).toMatchObject({ type: 'legacy-imported', version: 1 });
    expect(projection.missions).toHaveLength(1);
    expect(projection.missions[0]).toMatchObject({
      id: 'mission-default',
      name: 'Default Project',
      status: 'active',
      recipeIds: ['recipe-1'],
      datasetIds: ['dataset-1'],
      analysisIds: ['report-1'],
      cardIds: ['card-1'],
      assetIds: ['asset-1'],
    });
    expect(projection.recipeVersions['recipe-1'][0]).toMatchObject({ version: 1, recipeId: 'recipe-1' });
    expect(projection.timeline[0]).toMatchObject({ kind: 'legacy-imported' });
  });

  it('replays mission, schedule, recipe-version, and job events deterministically', () => {
    const mission = createMission({ name: 'Competitor Watch', presetId: 'competitor-watch' }, { now: fixedNow });
    const events = [
      createEvent('mission-saved', { mission }, { now: fixedNow }),
      createEvent('mission-scheduled', {
        missionId: mission.id,
        schedule: validateSchedule({ cadence: 'weekly', timezone: 'America/New_York', quiet: true, threshold: 5 }),
      }, { now: fixedNow }),
      createEvent('recipe-version-saved', {
        recipeId: 'recipe-1',
        version: { version: 2, name: 'Competitor products', input: { q: 'pricing' }, mapper: { text: 'title' } },
      }, { now: fixedNow }),
      createEvent('job-started', {
        id: 'job-1',
        missionId: mission.id,
        kind: 'codex',
        title: 'Build report',
        sourceAction: { action: 'analyze-dataset', args: { datasetId: 'dataset-1', kind: 'report' } },
      }, { now: fixedNow }),
      createEvent('job-finished', { id: 'job-1', status: 'failed', error: 'Schema invalid' }, { now: fixedNow }),
    ];

    const projection = projectEvents(events, { now: fixedNow });

    expect(projection.missions[0]).toMatchObject({ id: mission.id, presetId: 'competitor-watch' });
    expect(projection.schedules[mission.id]).toMatchObject({ cadence: 'weekly', quiet: true, threshold: 5 });
    expect(projection.recipeVersions['recipe-1'][0]).toMatchObject({ version: 2, mapper: { text: 'title' } });
    expect(projection.jobs[0]).toMatchObject({ id: 'job-1', status: 'failed', attempts: 1, error: 'Schema invalid' });
  });

  it('appends events as jsonl without corrupting previous records', () => {
    const dir = fs.mkdtempSync(path.join('/tmp', 'apify-v5-events-'));
    const filePath = path.join(dir, 'events.jsonl');
    appendEvent(filePath, createEvent('mission-saved', { mission: createMission({ name: 'A' }, { now: fixedNow }) }, { now: fixedNow }));
    appendEvent(filePath, createEvent('mission-saved', { mission: createMission({ name: 'B' }, { now: fixedNow }) }, { now: fixedNow }));

    const rows = fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.payload.mission.name)).toEqual(['A', 'B']);
  });
});

describe('V5 evidence, profiling, planning, evals, and diagnostics', () => {
  const dataset = { id: 'dataset-1', name: 'Lead dataset', platform: 'reddit', runId: 'run-1', recipeId: 'recipe-1', createdAt: '2026-06-29T10:00:00.000Z' };
  const payload = {
    items: [
      { id: 'run-1:a', type: 'post', text: 'Acme is hiring AI workflow consultants', author: 'amy', url: 'https://example.com/a', publishedAt: '2026-06-29T09:00:00.000Z', metrics: { likes: 5, comments: 2 } },
      { id: 'run-1:b', type: 'post', text: 'BetaCorp needs Apify monitoring for competitor pricing', author: 'ben', url: 'https://example.com/b', publishedAt: '2026-06-28T09:00:00.000Z', metrics: { likes: 2, comments: 1 } },
      { id: 'run-1:a', type: 'post', text: 'Acme is hiring AI workflow consultants', author: 'amy', url: 'https://example.com/a', publishedAt: '2026-06-29T09:00:00.000Z', metrics: { likes: 5, comments: 2 } },
    ],
  };

  it('profiles datasets with fields, row types, freshness, duplicates, and mapper recommendations', () => {
    const profile = buildDatasetProfileV2(dataset, payload, { now: () => '2026-06-30T09:00:00.000Z' });

    expect(profile).toMatchObject({
      datasetId: 'dataset-1',
      rowCount: 3,
      duplicateCount: 1,
      freshness: { newest: '2026-06-29T09:00:00.000Z' },
    });
    expect(profile.fields.some((field) => field.name === 'text' && field.coverage === 1)).toBe(true);
    expect(profile.rowTypes[0]).toEqual({ type: 'post', count: 3 });
    expect(profile.mapperWarnings).toEqual([]);
    expect(profile.confidence).toBeGreaterThan(0.7);
  });

  it('indexes and searches source-backed evidence records', () => {
    const evidence = buildEvidenceIndex(dataset, payload);

    expect(evidence).toHaveLength(3);
    expect(evidence[0]).toMatchObject({
      datasetId: 'dataset-1',
      runId: 'run-1',
      recipeId: 'recipe-1',
      sourceUrl: 'https://example.com/a',
      confidence: expect.any(Number),
    });
    expect(searchEvidence(evidence, 'pricing')).toHaveLength(1);
    expect(searchEvidence(evidence, 'workflow consultants')[0].sourceUrl).toBe('https://example.com/a');
  });

  it('builds editable action graphs from mission presets and validates runnable steps', () => {
    const state = {
      recipes: [{ id: 'recipe-1', name: 'Leads' }],
      datasets: [dataset],
      intelligence: { datasetProfiles: [{ datasetId: dataset.id, reportPresetId: 'lead-list', health: { score: 91 } }] },
    };
    const graph = buildActionGraph('make me a lead sheet from this dataset', state);

    expect(MISSION_PRESETS.map((preset) => preset.id)).toContain('lead-sheet');
    expect(graph.steps.map((step) => step.action)).toEqual(['analyze-dataset', 'export-dataset', 'create-card']);
    expect(validateActionGraph(graph).canRun).toBe(true);
    expect(validateActionGraph({ ...graph, steps: [{ action: 'shell', args: {} }] }).canRun).toBe(false);
  });

  it('evaluates artifacts for evidence coverage and unsupported claims', () => {
    const evidence = buildEvidenceIndex(dataset, payload);
    const score = evaluateArtifact({
      markdown: 'Acme is hiring AI workflow consultants.\n\nUnsupported claim with no source.',
      evidenceIds: [evidence[0].id],
    }, evidence);

    expect(score.passed).toBe(false);
    expect(score.evidenceCoverage).toBeGreaterThan(0);
    expect(score.issues.some((issue) => issue.includes('Unsupported'))).toBe(true);
  });

  it('summarizes observability and release diagnostics for local production readiness', () => {
    const projection = projectEvents([
      createEvent('mission-saved', { mission: createMission({ name: 'Lead Mission' }, { now: fixedNow }) }, { now: fixedNow }),
      createEvent('job-started', { id: 'job-1', kind: 'apify-run', startedAt: '2026-06-29T11:00:00.000Z' }, { now: fixedNow }),
      createEvent('job-finished', { id: 'job-1', status: 'succeeded', metrics: { itemCount: 42, durationMs: 1200, outputBytes: 5000 } }, { now: fixedNow }),
    ], { now: fixedNow });
    const observability = buildObservability({
      ...projection,
      runs: [{ id: 'run-1', status: 'succeeded', itemCount: 42, startedAt: '2026-06-29T11:00:00.000Z', finishedAt: '2026-06-29T11:00:02.000Z' }],
      analyses: [{ id: 'analysis-1', status: 'failed', eventCount: 10, stderr: 'bad schema' }],
    });
    const diagnostics = buildReleaseDiagnostics({
      platform: 'darwin',
      env: { APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: '', APPLE_TEAM_ID: '' },
      packageConfig: { build: { mac: { hardenedRuntime: true, entitlements: 'resources/entitlements.mac.plist' }, publish: null } },
    });

    expect(observability).toMatchObject({ totalRuns: 1, totalItems: 42, failedAnalyses: 1 });
    expect(diagnostics.notarization.status).toBe('missing-credentials');
    expect(diagnostics.update.status).toBe('disabled');
  });

  it('computes due local schedules and scores golden eval cases', () => {
    const weekly = validateSchedule({ cadence: 'weekly', timezone: 'America/New_York', quiet: true, threshold: 5 });
    expect(nextScheduleAt(weekly, { from: '2026-06-29T12:00:00.000Z' })).toBe('2026-07-06T12:00:00.000Z');

    const due = dueSchedules({
      'mission-a': { ...weekly, missionId: 'mission-a', nextRunAt: '2026-06-29T11:00:00.000Z' },
      'mission-b': { ...weekly, missionId: 'mission-b', nextRunAt: '2026-06-29T13:00:00.000Z' },
      'mission-c': { ...weekly, missionId: 'mission-c', paused: true, nextRunAt: '2026-06-29T11:00:00.000Z' },
    }, { now: '2026-06-29T12:00:00.000Z' });
    expect(due.map((item) => item.missionId)).toEqual(['mission-a']);

    const evidence = buildEvidenceIndex(dataset, payload);
    const suite = scoreEvalSuite([
      { id: 'golden-1', artifact: { markdown: 'Acme is hiring AI workflow consultants.', evidenceIds: [evidence[0].id] }, evidence, minScore: 60 },
      { id: 'golden-2', artifact: { markdown: 'Unsupported claim with no source.' }, evidence, minScore: 90 },
    ]);
    expect(suite.total).toBe(2);
    expect(suite.passed).toBe(1);
    expect(suite.results[1].passed).toBe(false);
  });

  it('creates portable mission bundles with evidence and artifacts', () => {
    const projection = projectEvents(migrateLegacyDataToEvents({
      projects: [{ id: 'default', name: 'Default Project' }],
      datasets: [dataset],
      assets: [{ id: 'asset-1', title: 'Post', markdown: 'Body', evidenceIds: ['evidence-dataset-1-run-1-a'] }],
      recipes: [],
      runs: [],
      analyses: [],
      cards: [],
      intentRuns: [],
    }, { now: fixedNow }), { now: fixedNow });
    const evidence = buildEvidenceIndex(dataset, payload);
    const bundle = createMissionBundle('mission-default', { ...projection, evidence });

    expect(bundle.mission.id).toBe('mission-default');
    expect(bundle.evidence.length).toBeGreaterThan(0);
    expect(bundle.assets).toHaveLength(1);
  });

  it('covers alternate V5 profile, planner, eval, and release branches', () => {
    const weakProfile = buildDatasetProfileV2({ id: 'weak', name: 'Weak' }, {
      items: [{ id: '1', title: '', href: '' }, { id: '2', title: '', href: '' }],
    }, { now: fixedNow });
    expect(weakProfile.mapperWarnings.length).toBeGreaterThan(0);
    expect(weakProfile.recommendedFixes.some((fix) => fix.severity === 'high')).toBe(true);

    const scrapeGraph = buildActionGraph('scrape fresh market data', { recipes: [], datasets: [] });
    expect(scrapeGraph.canRun).toBe(false);
    expect(scrapeGraph.missing.join(' ')).toMatch(/recipe/i);

    const assetGraph = buildActionGraph('make linkedin launch assets', {
      recipes: [{ id: 'recipe-1', name: 'Market' }],
      datasets: [{ id: 'dataset-1', name: 'Launch data' }],
      intelligence: { datasetProfiles: [{ datasetId: 'dataset-1', reportPresetId: 'market-scan' }] },
    });
    expect(assetGraph.steps.some((step) => step.action === 'generate-assets')).toBe(true);

    const invalidEval = evaluateArtifact({ markdown: 'This has no evidence and makes a long unsupported claim about the market.' }, []);
    expect(invalidEval.passed).toBe(false);
    expect(invalidEval.issues).toContain('No evidence IDs attached.');

    const readyRelease = buildReleaseDiagnostics({
      platform: 'darwin',
      env: { APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' },
      packageConfig: {
        build: {
          mac: { hardenedRuntime: true, entitlements: 'resources/entitlements.mac.plist' },
          publish: { provider: 'generic', url: 'https://updates.example.test' },
        },
      },
    });
    expect(readyRelease.notarization.status).toBe('ready');
    expect(readyRelease.update.status).toBe('configured');
  });

  it('replays progress, evidence, artifacts, and mission status events', () => {
    const mission = createMission({ id: 'mission-x', name: 'Watch X' }, { now: fixedNow });
    const events = [
      createEvent('mission-saved', { mission }, { now: fixedNow }),
      createEvent('mission-status-changed', { missionId: 'mission-x', status: 'paused' }, { now: fixedNow }),
      createEvent('job-started', { id: 'job-x', missionId: 'mission-x', kind: 'run', title: 'Run X', progress: 1 }, { now: fixedNow }),
      createEvent('job-progressed', { id: 'job-x', progress: 52, status: 'running', logsPath: '/tmp/job-x.log' }, { now: fixedNow }),
      createEvent('evidence-indexed', { evidence: [{ id: 'evidence-x', datasetId: 'dataset-x', text: 'Pricing changed' }] }, { now: fixedNow }),
      createEvent('artifact-saved', { artifact: { id: 'artifact-x', missionId: 'mission-x', title: 'Brief', evidenceIds: ['evidence-x'] } }, { now: fixedNow }),
    ];

    const projection = projectEvents(events, { now: fixedNow });
    expect(projection.missions[0].status).toBe('paused');
    expect(projection.jobs[0]).toMatchObject({ progress: 52, logsPath: '/tmp/job-x.log' });
    expect(projection.evidence[0].id).toBe('evidence-x');
    expect(projection.artifacts[0].id).toBe('artifact-x');
  });

  it('handles event files and bundle errors defensively', () => {
    const dir = fs.mkdtempSync(path.join('/tmp', 'apify-v5-read-'));
    const filePath = path.join(dir, 'events.jsonl');
    expect(v5.readEvents(filePath)).toEqual([]);
    appendEvent(filePath, createEvent('mission-saved', { mission: createMission({ name: 'Read me' }, { now: fixedNow }) }, { now: fixedNow }));
    expect(v5.readEvents(filePath)).toHaveLength(1);
    expect(() => createMissionBundle('missing', { missions: [] })).toThrow(/Mission/);
  });
});

describe('V5 validation and packaging hooks', () => {
  it('validates V5 IPC payloads before they touch storage or processes', () => {
    expect(validateMissionPayload({ name: 'Market Watch', presetId: 'reddit-pulse' })).toMatchObject({ name: 'Market Watch', presetId: 'reddit-pulse' });
    expect(() => validateMissionPayload({ name: '' })).toThrow(/Mission name/);
    expect(validateSchedulePayload({ cadence: 'daily', timezone: 'America/New_York', quiet: true, threshold: 4 })).toMatchObject({ cadence: 'daily', quiet: true, threshold: 4 });
    expect(() => validateSchedulePayload({ cadence: 'yearly' })).toThrow(/Schedule cadence/);
    expect(validateRecipeVersionPayload({ recipeId: 'recipe-1', version: { version: 3, mapper: { text: 'body' } } })).toMatchObject({ recipeId: 'recipe-1', version: { version: 3 } });
    expect(validateJobPayload({ id: 'job-1', kind: 'codex', status: 'running' })).toMatchObject({ id: 'job-1', kind: 'codex', status: 'running' });
  });

  it('copies V5 shared runtime modules into packaged Electron output', () => {
    execFileSync(process.execPath, [path.join(projectRoot, 'scripts/copy-main-modules.mjs')], { stdio: 'pipe' });
    const packagedPath = path.join(projectRoot, 'out/shared/v5-core.js');
    expect(fs.existsSync(packagedPath)).toBe(true);
    delete requireFromTest.cache[requireFromTest.resolve(packagedPath)];
    const packaged = requireFromTest(packagedPath);
    expect(packaged.MISSION_PRESETS.length).toBeGreaterThanOrEqual(7);
  });
});
