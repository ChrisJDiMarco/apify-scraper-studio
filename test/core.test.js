import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import recipe from '../src/shared/recipe.js';
import normalize from '../src/shared/normalize.js';
import apifyRunner from '../src/shared/apify-runner.js';
import codexRunner from '../src/shared/codex-runner.js';
import intelligence from '../src/shared/intelligence.js';
import { analysesForDataset, codexEventLabel, codexEventLabels, latestAnalysisForDataset, sortAnalysesLatestFirst } from '../src/shared/analysis.js';
import { cardDraftFromInput, cardFromAsset } from '../src/shared/assets.js';
import { buildPipeline, countByStatus, derivePlatformBreakdown, groupThreads, summarizeStudio } from '../src/shared/dashboard.js';
import { datasetItemKey, datasetItemSearchText } from '../src/shared/dataset-view.js';
import { readinessItems } from '../src/shared/health.js';
import { RECIPE_TEMPLATES } from '../src/shared/recipe-templates.js';
import { runDurationLabel, runRecipeLabel, runSearchText } from '../src/shared/run-view.js';
import workspace from '../src/shared/workspace.js';
import validation from '../src/shared/validation.js';
import sheetsBridge from '../src/shared/google-sheets.js';

const { SECRET_KEY_PATTERN, parseJsonObject, publicRecipe, redactSecrets, validateRecipe } = recipe;
const { normalizeDataset, normalizeItem, normalizeMetrics, toCsv, toJsonl } = normalize;
const { createApifyRunner, discoverApifyResource, listAllDatasetItems } = apifyRunner;
const { REPORT_PRESETS, buildAnalysisContext, buildAssetPrompt, buildCodexCommand, buildPrompt, parseJsonlEvents, reportPresetById, validateAiOutput } = codexRunner;
const { buildReadinessSummary, buildSetupSteps, buildStudioIntelligence, buildWorkPlan, planIntent, profileDataset, suggestCommands } = intelligence;
const { ensureWorkspace, isPathInside, safeFilename } = workspace;
const { buildArchiveClearRequest, buildDatasetSheetRows, buildDatasetWriteRequest, buildDatasetWriteRequests, buildPingRequest, buildSheetReadRequest, isRetryableSheetMessage, isRetryableSheetStatus, parseSpreadsheetId } = sheetsBridge;
const { boolValue, enumValue, intValue, optionalRecord, stringArray, stringValue, validateAnalysisPayload, validateAssetPayload, validateCardPayload, validateExportPayload, validateGenerateAssetsPayload, validateId, validateIntentActionPayload, validateIntentPayload, validateKeyName, validateKeyValue, validateMoveCardPayload, validateSettings } = validation;
const workflowConfig = JSON.parse(fs.readFileSync(new URL('../src/shared/asset-workflow.json', import.meta.url), 'utf8'));
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const requireFromTest = createRequire(import.meta.url);

describe('entrypoint syntax', () => {
  it('keeps packaged Electron scripts parseable by Node', () => {
    for (const file of ['src/main/index.js', 'src/preload/index.js', 'scripts/copy-main-modules.mjs']) {
      execFileSync(process.execPath, ['--check', path.join(projectRoot, file)], { stdio: 'pipe' });
    }
  });

  it('copies shared main-process runtime files used by the packaged app', () => {
    execFileSync(process.execPath, [path.join(projectRoot, 'scripts/copy-main-modules.mjs')], { stdio: 'pipe' });
    const packagedRunnerPath = path.join(projectRoot, 'out/shared/codex-runner.js');
    const presetPath = path.join(projectRoot, 'out/shared/report-presets.json');

    expect(fs.existsSync(presetPath)).toBe(true);
    delete requireFromTest.cache[requireFromTest.resolve(packagedRunnerPath)];
    const packagedRunner = requireFromTest(packagedRunnerPath);
    expect(packagedRunner.reportPresetById('lead-list').id).toBe('lead-list');
    expect(fs.existsSync(path.join(projectRoot, 'out/shared/intelligence.js'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'out/shared/validation.js'))).toBe(true);
  });
});

describe('IPC validation helpers', () => {
  it('accepts only supported key names and local IDs', () => {
    expect(validateKeyName('APIFY_API_TOKEN', ['APIFY_API_TOKEN'])).toBe('APIFY_API_TOKEN');
    expect(validateKeyValue('GOOGLE_SHEETS_WEBHOOK_URL', 'https://script.google.com/macros/s/abc/exec')).toBe('https://script.google.com/macros/s/abc/exec');
    expect(validateId('dataset-123_abc', 'Dataset ID')).toBe('dataset-123_abc');
    expect(() => validateKeyName('OTHER_TOKEN', ['APIFY_API_TOKEN'])).toThrow(/unsupported/);
    expect(() => validateKeyValue('GOOGLE_SHEETS_WEBHOOK_URL', 'file:///tmp/nope')).toThrow(/Webhook URL/);
    expect(() => validateId('../outside', 'Dataset ID')).toThrow(/invalid/);
    expect(() => validateId('bad id', 'Dataset ID')).toThrow(/invalid/);
  });

  it('validates settings, exports, analysis jobs, and assets', () => {
    expect(validateSettings({ maxItems: '25' }, { maxItems: 1000 }).maxItems).toBe(25);
    expect(() => validateSettings({ maxItems: 10001 }, { maxItems: 1000 })).toThrow(/between/);
    expect(validateSettings({
      sheets: {
        workingSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet_123-abc/edit',
        archiveFolderId: 'folder_123',
        twitterTab: 'X Posts',
      },
    }, { maxItems: 1000 }).sheets).toMatchObject({
      workingSpreadsheetId: 'sheet_123-abc',
      archiveFolderId: 'folder_123',
      twitterTab: 'X Posts',
      linkedinTab: 'LinkedIn',
      redditTab: 'Reddit',
    });
    expect(() => validateSettings({ sheets: { workingSpreadsheetUrl: 'not google' } }, { maxItems: 1000 })).toThrow(/Spreadsheet/);

    expect(validateExportPayload({ datasetId: 'dataset-1', format: 'csv' })).toEqual({ datasetId: 'dataset-1', format: 'csv', reveal: true });
    expect(validateExportPayload({ datasetId: 'dataset-1', format: 'csv', reveal: false })).toMatchObject({ reveal: false });
    expect(() => validateExportPayload({ datasetId: 'dataset-1', format: 'xlsx' })).toThrow(/unsupported/);

    expect(validateAnalysisPayload({ datasetId: 'dataset-1', kind: 'report', reportPresetId: 'lead-list' })).toMatchObject({
      datasetId: 'dataset-1',
      kind: 'report',
      reportPresetId: 'lead-list',
    });
    expect(() => validateAnalysisPayload({ datasetId: 'dataset-1', kind: 'delete-everything' })).toThrow(/unsupported/);
    expect(validateIntentPayload({ command: 'make a lead sheet', datasetId: 'dataset-1' })).toEqual({ command: 'make a lead sheet', datasetId: 'dataset-1' });
    expect(() => validateIntentPayload({ command: '' })).toThrow(/Command/);
    expect(() => validateIntentPayload({ command: 'x', datasetId: '../bad' })).toThrow(/Dataset ID/);
    expect(validateIntentActionPayload({
      id: 'generate-report',
      label: 'Generate report',
      action: 'analyze-dataset',
      args: { datasetId: 'dataset-1', kind: 'report', reportPresetId: 'lead-list' },
    })).toEqual({
      id: 'generate-report',
      label: 'Generate report',
      action: 'analyze-dataset',
      args: { datasetId: 'dataset-1', kind: 'report', reportPresetId: 'lead-list' },
    });
    expect(() => validateIntentActionPayload({ action: 'open-shell', args: {} })).toThrow(/Intent action/);

    expect(validateAssetPayload({
      id: 'asset-1',
      title: 'Lead list',
      markdown: 'body',
      evidenceIds: ['a', 'a', 'b'],
    })).toMatchObject({ id: 'asset-1', title: 'Lead list', evidenceIds: ['a', 'b'] });
  });

  it('validates asset generation requests before Codex sees them', () => {
    expect(validateGenerateAssetsPayload({
      card: { id: 'card-1', title: 'Trend' },
      assetTypeIds: ['blog-post', 'linkedin-post'],
      datasetId: 'dataset-1',
    })).toMatchObject({
      card: { id: 'card-1', title: 'Trend' },
      assetTypeIds: ['blog-post', 'linkedin-post'],
      datasetId: 'dataset-1',
    });

    expect(() => validateGenerateAssetsPayload({
      card: { id: '../bad', title: 'Trend' },
      assetTypeIds: ['blog-post'],
    })).toThrow(/Card ID/);
  });
});

describe('recipes and redaction', () => {
  it('validates actor recipes and redacts secret-like input fields', () => {
    const saved = validateRecipe({
      name: 'Reddit pulse',
      platform: 'reddit',
      actorId: 'apify/reddit-scraper',
      inputJson: '{"cookie":"abc","startUrls":[{"url":"https://reddit.com/r/apify"}]}',
    });

    expect(saved.actorId).toBe('apify/reddit-scraper');
    expect(publicRecipe(saved).input.cookie).toBe('[redacted]');
  });

  it('rejects missing and ambiguous Apify resources', () => {
    expect(() => validateRecipe({ platform: 'x', actorId: 'a' })).toThrow(/Recipe name/);
    expect(() => validateRecipe({ name: 'Bad', actorId: 'a' })).toThrow(/Platform/);
    expect(() => validateRecipe({ name: 'Bad', platform: 'x' })).toThrow(/Actor ID/);
    expect(() => validateRecipe({ name: 'Bad', platform: 'x', actorId: 'a', taskId: 'b' })).toThrow(/either/);
  });

  it('parses recipe JSON inputs and supports task-only recipes', () => {
    expect(parseJsonObject('', { ok: true })).toEqual({ ok: true });
    expect(parseJsonObject({ startUrls: [] })).toEqual({ startUrls: [] });
    expect(() => parseJsonObject(42)).toThrow(/JSON object/);
    expect(() => parseJsonObject('[]')).toThrow(/JSON object/);

    expect(validateRecipe({
      name: 'Saved task',
      platform: 'reddit',
      taskId: 'user~task',
      input: { q: 'ai' },
      mapper: { text: 'body' },
    })).toMatchObject({ taskId: 'user~task', actorId: '', input: { q: 'ai' }, mapper: { text: 'body' } });
  });

  it('redacts nested token, session, cookie, and password fields', () => {
    expect(redactSecrets({ auth: { token: 't' }, proxyPassword: 'p', safe: 'ok' })).toEqual({
      auth: { token: '[redacted]' },
      proxyPassword: '[redacted]',
      safe: 'ok',
    });
  });

  it('redacts secret-looking keys inside arrays without changing safe values', () => {
    expect(redactSecrets([{ bearer: 'abc', safe: 'ok' }, 'text'])).toEqual([{ bearer: '[redacted]', safe: 'ok' }, 'text']);
    expect(publicRecipe({ input: { apiKey: 'secret', nested: [{ cookie: 'c' }] } }).input).toEqual({
      apiKey: '[redacted]',
      nested: [{ cookie: '[redacted]' }],
    });
  });

  it('keeps recipe templates valid, generic, and free of secret fields', () => {
    const ids = new Set(RECIPE_TEMPLATES.map((template) => template.id));
    expect(ids.size).toBe(RECIPE_TEMPLATES.length);

    for (const template of RECIPE_TEMPLATES) {
      expect(template.actorId || template.taskId).toBeUndefined();
      for (const key of Object.keys({ ...template.input, ...template.mapper })) {
        expect(SECRET_KEY_PATTERN.test(key)).toBe(false);
      }
      expect(validateRecipe({
        name: template.name,
        platform: template.platform,
        actorId: 'sample/actor',
        input: template.input,
        mapper: template.mapper,
      })).toMatchObject({ platform: template.platform, actorId: 'sample/actor' });
    }
  });
});

describe('Google Sheets bridge', () => {
  const sheetSettings = validateSettings({
    sheets: {
      workingSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet_123-abc/edit#gid=0',
      archiveFolderId: 'folder_123',
    },
  }, { maxItems: 1000 }).sheets;

  it('builds a ping request for testing the webhook safely', () => {
    expect(buildPingRequest(sheetSettings)).toEqual({
      action: 'ping',
      spreadsheetId: 'sheet_123-abc',
    });
  });

  it('builds archive and clear requests for the working repository sheet', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/sheet_123-abc/edit')).toBe('sheet_123-abc');
    const request = buildArchiveClearRequest(sheetSettings, { archiveName: 'Golden Thread 2026-07-01' });

    expect(request).toMatchObject({
      action: 'archiveAndClear',
      spreadsheetId: 'sheet_123-abc',
      archiveFolderId: 'folder_123',
      archiveName: 'Golden Thread 2026-07-01',
    });
    expect(request.tabsToClear).toEqual(['Twitter', 'LinkedIn', 'Reddit', 'Theme Repository', 'Trend Velocity', 'Batch Analysis Log']);
    expect(() => buildArchiveClearRequest({ ...sheetSettings, archiveFolderId: '' })).toThrow(/Archive folder/);
  });

  it('maps normalized dataset rows into a Sheets write request', () => {
    const dataset = { id: 'ds-1', name: 'Reddit pulse', platform: 'reddit' };
    const items = [{
      id: 'item-1',
      type: 'post',
      platform: 'reddit',
      author: 'u/alice',
      text: 'GSC attribution is broken',
      url: 'https://reddit.com/r/seo/1',
      publishedAt: '2026-07-01',
      metrics: { likes: 5, comments: 2, shares: 0, views: 99 },
    }];

    expect(buildDatasetSheetRows(items)[0]).toEqual({
      id: 'item-1',
      type: 'post',
      platform: 'reddit',
      author: 'u/alice',
      text: 'GSC attribution is broken',
      url: 'https://reddit.com/r/seo/1',
      publishedAt: '2026-07-01',
      parentId: '',
      threadId: '',
      likes: 5,
      comments: 2,
      shares: 0,
      views: 99,
      theme: '',
      relevant: '',
      confidence: '',
      why: '',
      painPoint: '',
      urgency: '',
      entities: '',
    });

    expect(buildDatasetWriteRequest(sheetSettings, dataset, items)).toMatchObject({
      action: 'writeDatasetRows',
      spreadsheetId: 'sheet_123-abc',
      tabName: 'Reddit',
      clearFirst: false,
      dataset: { id: 'ds-1', name: 'Reddit pulse', platform: 'reddit', itemCount: 1 },
    });
  });

  it('chunks large dataset writes with stable request IDs', () => {
    const dataset = { id: 'ds-1', name: 'Twitter pulse', platform: 'x' };
    const items = Array.from({ length: 1201 }, (_, index) => ({
      id: `item-${index}`,
      type: 'post',
      platform: 'x',
      text: `row ${index}`,
      metrics: {},
    }));
    const requests = buildDatasetWriteRequests(sheetSettings, dataset, items, {
      clearFirst: true,
      chunkSize: 500,
      requestId: 'write-run-1',
    });

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.rows.length)).toEqual([500, 500, 201]);
    expect(requests.map((request) => request.clearFirst)).toEqual([true, false, false]);
    expect(requests.map((request) => request.requestId)).toEqual(['write-run-1-1-of-3', 'write-run-1-2-of-3', 'write-run-1-3-of-3']);
    expect(requests[0]).toMatchObject({ tabName: 'Twitter', chunkIndex: 1, chunkCount: 3 });
  });

  it('marks only transient Sheets statuses as retryable', () => {
    expect(isRetryableSheetStatus(429)).toBe(true);
    expect(isRetryableSheetStatus(500)).toBe(true);
    expect(isRetryableSheetStatus(503)).toBe(true);
    expect(isRetryableSheetStatus(400)).toBe(false);
    expect(isRetryableSheetStatus(403)).toBe(false);
    expect(isRetryableSheetMessage('Service invoked too many times for one day')).toBe(true);
    expect(isRetryableSheetMessage('Exceeded maximum execution time')).toBe(true);
    expect(isRetryableSheetMessage('Spreadsheet ID is required')).toBe(false);
  });

  it('builds a working sheet import request for platform tabs', () => {
    expect(buildSheetReadRequest(sheetSettings)).toEqual({
      action: 'readTabs',
      spreadsheetId: 'sheet_123-abc',
      tabs: ['Twitter', 'LinkedIn', 'Reddit'],
    });
  });

  it('ships an Apps Script webhook template with every app action and chunk idempotency', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'scripts/google-sheets-webhook.gs'), 'utf8');
    for (const token of ['doPost', 'archiveAndClear', 'readTabs', 'writeDatasetRows', 'ping']) {
      expect(source).toContain(token);
    }
    expect(source).toContain('requestId');
    expect(source).toContain('PropertiesService');
    expect(source).toContain('duplicate');
    expect(source).toContain('retryable');
  });

  it('wires Sheets test and replay actions through Electron IPC', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(projectRoot, 'src/preload/index.js'), 'utf8');
    for (const channel of ['test-sheets-bridge', 'replay-sheet-run']) {
      expect(mainSource).toContain(channel);
      expect(preloadSource).toContain(channel);
    }
  });
});

describe('normalization', () => {
  it('normalizes common social post fields', () => {
    const item = normalizeItem({
      id: '42',
      body: 'Found a buying signal',
      username: 'chris',
      permalink: 'https://example.com/post',
      score: 12,
      numComments: 3,
    }, { runId: 'run-1', platform: 'reddit' });

    expect(item).toMatchObject({
      id: 'run-1:42',
      externalId: '42',
      platform: 'reddit',
      text: 'Found a buying signal',
      author: 'chris',
      url: 'https://example.com/post',
      metrics: { likes: 12, comments: 3, shares: 0, views: 0 },
    });
  });

  it('normalizes mapper-defined fields and primitive raw values', () => {
    expect(normalizeItem('loose text', { runId: 'run-2', platform: 'web' })).toMatchObject({
      id: expect.stringContaining('run-2:'),
      platform: 'web',
      type: 'post',
      text: '',
      raw: { value: 'loose text' },
    });

    expect(normalizeItem({
      bodyText: 'mapped text',
      handle: 'agent',
      href: 'https://example.com',
      uuid: 'u1',
      category: 'comment',
      stats: { likeCount: '9', replyCount: 'bad' },
    }, {
      runId: 'run-3',
      platform: 'custom',
      mapper: { text: 'bodyText', author: 'handle', url: 'href', externalId: 'uuid', type: 'category' },
    })).toMatchObject({
      id: 'run-3:u1',
      type: 'comment',
      author: 'agent',
      url: 'https://example.com',
      metrics: { likes: 0, comments: 0, shares: 0, views: 0 },
    });
  });

  it('normalizes metrics and datasets defensively', () => {
    expect(normalizeMetrics({ metrics: { favoriteCount: 4, retweetCount: 2, impressions: 10 } })).toEqual({
      likes: 4,
      comments: 0,
      shares: 2,
      views: 10,
    });
    expect(normalizeDataset(null)).toEqual([]);
  });

  it('serializes items as jsonl for Codex', () => {
    expect(toJsonl([{ id: 'a' }, { id: 'b' }])).toBe('{"id":"a"}\n{"id":"b"}');
  });

  it('exports normalized items as escaped csv', () => {
    expect(toCsv([{ id: 'a', text: 'hello, "world"', metrics: { likes: 1, comments: 2, shares: 3, views: 4 } }])).toContain('"hello, ""world"""');
  });
});

describe('Apify runner', () => {
  it('paginates dataset items until total or maxItems is reached', async () => {
    const calls = [];
    const client = {
      dataset: () => ({
        listItems: async ({ offset, limit }) => {
          calls.push({ offset, limit });
          const items = Array.from({ length: Math.min(limit, 5 - offset) }, (_, index) => ({ id: offset + index + 1 }));
          return { items, count: items.length, total: 5 };
        },
      }),
    };

    const items = await listAllDatasetItems(client, 'dataset', 5, 2);
    expect(items).toHaveLength(5);
    expect(calls).toEqual([{ offset: 0, limit: 2 }, { offset: 2, limit: 2 }, { offset: 4, limit: 1 }]);
  });

  it('stops pagination when Apify returns an empty page without count metadata', async () => {
    const client = {
      dataset: () => ({
        listItems: async () => ({ items: [] }),
      }),
    };

    await expect(listAllDatasetItems(client, 'dataset', 5, 2)).resolves.toEqual([]);
  });

  it('runs an Actor and normalizes returned dataset items', async () => {
    const startedRuns = [];
    class FakeClient {
      actor(id) {
        return { start: async () => {
          startedRuns.push(id);
          return { id: `run-${id}`, status: 'RUNNING', defaultDatasetId: 'ds1' };
        } };
      }
      run() {
        return { get: async () => ({ id: 'run-actor', status: 'SUCCEEDED', defaultDatasetId: 'ds1' }) };
      }
      dataset() {
        return { listItems: async () => ({ items: [{ id: 'p1', text: 'hello' }], count: 1, total: 1 }) };
      }
    }

    const runner = createApifyRunner({ token: 'token', Client: FakeClient });
    const result = await runner.runRecipe({ name: 'X', platform: 'x', actorId: 'actor', input: {} });
    expect(result.run.defaultDatasetId).toBe('ds1');
    expect(result.normalizedItems[0].text).toBe('hello');
    expect(startedRuns).toEqual(['actor']);
  });

  it('runs saved tasks and rejects runs without datasets', async () => {
    class TaskClient {
      task(id) {
        return { call: async () => ({ id: `run-${id}`, defaultDatasetId: 'task-ds' }) };
      }
      dataset() {
        return { listItems: async () => ({ items: [], count: 0, total: 0 }) };
      }
    }

    await expect(createApifyRunner({ token: 'token', Client: TaskClient }).runRecipe({
      name: 'Task',
      platform: 'x',
      taskId: 'task-1',
      input: {},
    })).resolves.toMatchObject({ run: { defaultDatasetId: 'task-ds' }, rawItems: [] });

    class NoDatasetClient {
      actor() {
        return { call: async () => ({ id: 'run-1' }) };
      }
    }

    await expect(createApifyRunner({ token: 'token', Client: NoDatasetClient }).runRecipe({
      name: 'Actor',
      platform: 'x',
      actorId: 'actor',
      input: {},
    })).rejects.toThrow(/default dataset/);
  });

  it('fails fast when Apify runner prerequisites are missing', async () => {
    expect(() => createApifyRunner({ token: '', Client: class {} })).toThrow(/APIFY_API_TOKEN/);
    expect(() => createApifyRunner({ token: 'token' })).toThrow(/Apify client/);

    class BadClient {
      actor() {
        return {};
      }
    }

    const runner = createApifyRunner({ token: 'token', Client: BadClient });
    await expect(runner.runRecipe({ name: 'X', platform: 'x', actorId: 'actor', input: {} })).rejects.toThrow(/cannot be run/);
  });

  it('discovers actor schemas and task input without leaking credentials', async () => {
    class DiscoveryClient {
      actor(id) {
        return {
          get: async () => ({
            id,
            title: 'Web Scraper',
            description: 'Scrapes pages.',
            defaultRunOptions: { maxItems: 100 },
            exampleRunInput: { body: '{"startUrls":[{"url":"https://example.com"}]}', contentType: 'application/json' },
          }),
          defaultBuild: async () => ({
            get: async () => ({
              actorDefinition: {
                input: {
                  type: 'object',
                  properties: {
                    startUrls: { type: 'array', title: 'Start URLs', prefill: [] },
                    maxItems: { type: 'integer', title: 'Max items', default: 25 },
                  },
                },
              },
            }),
          }),
        };
      }
      task() {
        return {
          get: async () => ({ id: 'task-1', name: 'Saved task', actId: 'actor-1' }),
          getInput: async () => ({ search: 'apify', token: 'secret' }),
        };
      }
    }

    const actor = await discoverApifyResource({ actorId: 'user/actor' }, { token: 'token', Client: DiscoveryClient });
    expect(actor.schema.properties.maxItems.default).toBe(25);
    expect(actor.inputTemplate.startUrls[0].url).toBe('https://example.com');

    const task = await discoverApifyResource({ taskId: 'task-1' }, { token: 'token', Client: DiscoveryClient });
    expect(task.inputTemplate).toEqual({ search: 'apify', token: '[redacted]' });
    expect(task.warnings.join(' ')).not.toContain('secret');
  });

  it('falls back and fails clearly for Apify discovery edge cases', async () => {
    const offline = await discoverApifyResource({ actorId: 'public/actor' }, { token: '', Client: class {} });
    expect(offline.warnings.join(' ')).toMatch(/APIFY_API_TOKEN/);

    await expect(discoverApifyResource({ actorId: 'actor' }, { token: 'token' })).rejects.toThrow(/Apify client/);

    class SparseClient {
      actor(id) {
        return {
          get: async () => (id === 'missing' ? undefined : {
            id,
            name: 'Sparse',
            isDeprecated: true,
            exampleRunInput: null,
          }),
          defaultBuild: async () => ({ get: async () => ({ inputSchema: '{"type":"object","properties":{"enabled":{"type":"boolean"},"count":{"type":"integer"},"search":{"type":"string"},"urls":{"type":"array"}}}' }) }),
        };
      }
      task() {
        return { get: async () => undefined };
      }
    }

    const sparse = await discoverApifyResource({ actorId: 'sparse' }, { token: 'token', Client: SparseClient });
    expect(sparse.inputTemplate).toEqual({ enabled: false, count: 0, search: '', urls: [] });
    expect(sparse.warnings.join(' ')).toMatch(/deprecated/);
    await expect(discoverApifyResource({ actorId: 'missing' }, { token: 'token', Client: SparseClient })).rejects.toThrow(/Actor not found/);
    await expect(discoverApifyResource({ taskId: 'missing-task' }, { token: 'token', Client: SparseClient })).rejects.toThrow(/task not found/i);
  });

  it('aborts a running Apify run when cancellation is requested', async () => {
    let aborted = false;
    class SlowClient {
      actor() {
        return { start: async () => ({ id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds1' }) };
      }
      run() {
        return {
          get: async () => ({ id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds1' }),
          abort: async () => {
            aborted = true;
            return { id: 'run-1', status: 'ABORTED' };
          },
        };
      }
    }

    const runner = createApifyRunner({ token: 'token', Client: SlowClient });
    await expect(runner.runRecipe({
      name: 'Slow',
      platform: 'x',
      actorId: 'actor',
      input: {},
    }, { isCancelled: () => true })).rejects.toThrow(/cancelled/);
    expect(aborted).toBe(true);
  });

  it('reports terminal failed Apify runs before reading datasets', async () => {
    class FailedClient {
      actor() {
        return { start: async () => ({ id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds1' }) };
      }
      run() {
        return { get: async () => ({ id: 'run-1', status: 'FAILED', defaultDatasetId: 'ds1' }) };
      }
      dataset() {
        throw new Error('should not read dataset');
      }
    }

    const runner = createApifyRunner({ token: 'token', Client: FailedClient });
    await expect(runner.runRecipe({ name: 'Failed', platform: 'x', actorId: 'actor', input: {} })).rejects.toThrow(/FAILED/);
  });
});

describe('Codex runner', () => {
  it('builds a non-interactive Codex command with approval before exec', () => {
    const { command, args } = buildCodexCommand({
      workspaceDir: '/tmp/work',
      schemaPath: '/tmp/schema.json',
      outputPath: '/tmp/out.json',
      prompt: 'Tag this',
    });

    expect(command).toBe('codex');
    expect(args.slice(0, 5)).toEqual(['--ask-for-approval', 'never', '--cd', '/tmp/work', 'exec']);
    expect(args).toContain('--json');
    expect(args).toContain('--output-schema');
  });

  it('parses JSONL events and validates output shapes', () => {
    expect(parseJsonlEvents('{"type":"turn.started"}\nnot-json')).toEqual([
      { type: 'turn.started' },
      { type: 'raw', text: 'not-json' },
    ]);
    expect(validateAiOutput('tag', { itemTags: [] })).toEqual({ itemTags: [] });
    expect(validateAiOutput('assetPack', { assets: [] })).toEqual({ assets: [] });
    expect(() => validateAiOutput('report', { summary: 'x' })).toThrow(/markdownReport/);
    expect(() => validateAiOutput('assetPack', { assets: [{ assetType: 'blog' }] })).toThrow(/Invalid asset/);
  });

  it('builds prompts for each Codex analysis kind and rejects invalid roots', () => {
    expect(buildPrompt('thread', '/tmp/items.jsonl')).toContain('conversation threads');
    expect(buildPrompt('report', '/tmp/items.jsonl', { contextPath: '/tmp/context.json', reportPresetId: 'lead-list' })).toContain('First read /tmp/context.json');
    expect(buildPrompt('report', '/tmp/items.jsonl', { contextPath: '/tmp/context.json', reportPresetId: 'lead-list' })).toContain('data-quality caveats');
    expect(buildPrompt('tag', '/tmp/items.jsonl')).toContain('Tag every normalized social item');
    expect(() => validateAiOutput('tag', null)).toThrow(/JSON object/);
    expect(() => validateAiOutput('thread', { threads: 'nope' })).toThrow(/Missing threads/);
    expect(() => validateAiOutput('assetPack', { assets: [null] })).toThrow(/Invalid asset output/);
  });

  it('builds analysis context with dataset profile, health, and run rules', () => {
    const context = buildAnalysisContext({
      dataset: { id: 'ds-1', name: 'Leads', platform: 'linkedin', itemCount: 2 },
      profile: {
        kind: 'lead-list',
        label: 'Lead List',
        confidence: 0.9,
        health: { score: 91 },
        quality: {},
        warnings: [],
        fields: ['company'],
        summary: 'Ready',
      },
      kind: 'report',
      reportPresetId: 'lead-list',
    });

    expect(context).toMatchObject({
      dataset: { id: 'ds-1', name: 'Leads', itemCount: 2 },
      profile: { kind: 'lead-list', health: { score: 91 } },
      run: { kind: 'report', reportPresetId: 'lead-list', reportPresetName: 'Lead list' },
    });
    expect(context.rules.join(' ')).toContain('Cite item IDs');
  });

  it('builds an asset generation prompt from a local context file', () => {
    expect(buildAssetPrompt('/tmp/context.json')).toContain('/tmp/context.json');
  });

  it('keeps report presets unique and routes report prompts through them', () => {
    expect(REPORT_PRESETS.map((preset) => preset.id)).toEqual([
      'market-scan',
      'account-intelligence',
      'subreddit-pulse',
      'lead-list',
      'competitive-report',
    ]);
    for (const preset of REPORT_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.instruction).toBeTruthy();
    }

    expect(reportPresetById('lead-list').name).toBe('Lead list');
    expect(reportPresetById('missing').id).toBe('market-scan');
    expect(buildPrompt('report', '/tmp/items.jsonl', { reportPresetId: 'competitive-report' })).toContain('Competitive report');
  });
});

describe('asset workflow config', () => {
  it('keeps columns, presets, cards, and asset types internally aligned', () => {
    const columnIds = new Set(workflowConfig.columns.map((column) => column.id));
    const assetTypeIds = new Set(workflowConfig.assetTypes.map((assetType) => assetType.id));

    expect(columnIds.size).toBe(workflowConfig.columns.length);
    expect(assetTypeIds.size).toBe(workflowConfig.assetTypes.length);
    expect(workflowConfig.assetTypes).toHaveLength(20);

    for (const card of workflowConfig.initialCards) {
      expect(columnIds.has(card.column)).toBe(true);
    }

    for (const preset of workflowConfig.presets) {
      expect(preset.assetTypeIds.length).toBeGreaterThan(0);
      for (const assetTypeId of preset.assetTypeIds) {
        expect(assetTypeIds.has(assetTypeId)).toBe(true);
      }
    }

    expect(workflowConfig.presets.find((preset) => preset.id === 'full-blitz').assetTypeIds).toHaveLength(workflowConfig.assetTypes.length);
  });
});

describe('asset helpers', () => {
  it('turns a saved asset into a follow-up Kanban card', () => {
    const card = cardFromAsset({
      title: 'Lead list',
      channel: 'sales',
      assetType: 'lead-list',
      status: 'done',
      markdown: `First line\n\n${'x'.repeat(700)}`,
      evidenceIds: ['a', 'b'],
    });

    expect(card).toMatchObject({
      title: 'Lead list',
      column: 'ready',
      tags: ['sales', 'lead-list'],
      signalCount: '2',
      signalChange: 'Asset',
      priority: 'done',
    });
    expect(card.description.length).toBe(500);
  });

  it('builds sensible cards from sparse assets', () => {
    expect(cardFromAsset({})).toMatchObject({
      title: 'Asset follow-up',
      description: '',
      column: 'ready',
      tags: [],
      signalCount: '',
      priority: 'asset',
    });
  });

  it('builds a manual Kanban card draft with dataset context and clean tags', () => {
    expect(cardDraftFromInput({
      id: 'card-1',
      title: '  AI search buyers  ',
      description: ' Watch objections ',
      tags: 'reddit, leads, reddit,  ',
    }, { id: 'ds-1', itemCount: 42 })).toMatchObject({
      id: 'card-1',
      title: 'AI search buyers',
      description: 'Watch objections',
      column: 'detected',
      tags: ['reddit', 'leads'],
      datasetId: 'ds-1',
      signalCount: 42,
      signalChange: 'Apify',
      priority: 'manual',
    });

    expect(() => cardDraftFromInput({ title: '   ' })).toThrow(/Card title/);
  });
});

describe('dataset view helpers', () => {
  it('prefers stable social IDs before falling back to row index', () => {
    expect(datasetItemKey({ id: 'normalized-1' }, 4)).toBe('normalized-1');
    expect(datasetItemKey({ postId: 'post-1' }, 4)).toBe('post-1');
    expect(datasetItemKey({ commentId: 'comment-1' }, 4)).toBe('comment-1');
    expect(datasetItemKey({ externalId: 'external-1' }, 4)).toBe('external-1');
    expect(datasetItemKey({}, 4)).toBe('row-4');
  });

  it('builds searchable text for normalized and raw rows', () => {
    expect(datasetItemSearchText({
      type: 'post',
      author: 'chris',
      text: 'buying signal',
      url: 'https://example.com/post',
      externalId: 'p1',
    })).toContain('buying signal');

    expect(datasetItemSearchText({ nested: { handle: 'apify' } }, true)).toContain('"handle":"apify"');
  });
});

describe('run view helpers', () => {
  it('labels runs from recipe names before falling back to Apify IDs', () => {
    expect(runRecipeLabel({ actorId: 'apify/reddit' }, { name: 'Reddit pulse' })).toBe('Reddit pulse');
    expect(runRecipeLabel({ actorId: 'apify/reddit' })).toBe('apify/reddit');
    expect(runRecipeLabel({ taskId: 'task-1' })).toBe('task-1');
    expect(runRecipeLabel({})).toBe('Untitled run');
  });

  it('formats run duration without needing live timers', () => {
    expect(runDurationLabel({ startedAt: '2026-06-27T10:00:00.000Z', finishedAt: '2026-06-27T10:00:42.000Z' })).toBe('42s');
    expect(runDurationLabel({ startedAt: '2026-06-27T10:00:00.000Z', finishedAt: '2026-06-27T10:02:01.000Z' })).toBe('2m');
    expect(runDurationLabel({ startedAt: '2026-06-27T10:00:00.000Z', status: 'running' })).toBe('Running');
  });

  it('builds searchable text for run triage', () => {
    expect(runSearchText({
      status: 'failed',
      platform: 'reddit',
      actorId: 'apify/reddit',
      datasetId: 'dataset-1',
      error: 'Rate limit',
    }, { name: 'Subreddit pulse' })).toContain('Rate limit');
  });
});

describe('readiness helpers', () => {
  it('summarizes setup readiness without exposing secrets', () => {
    expect(readinessItems(
      { keys: { APIFY_API_TOKEN: true } },
      { dataRoot: '/tmp/apify-studio' },
      { ok: true, version: 'codex 1.2.3' },
    )).toEqual([
      { id: 'apify', label: 'Apify token', tone: 'ready', detail: 'Saved in keychain' },
      { id: 'codex', label: 'Codex CLI', tone: 'ready', detail: 'codex 1.2.3' },
      { id: 'workspace', label: 'Local workspace', tone: 'ready', detail: '/tmp/apify-studio' },
    ]);

    expect(readinessItems({}, {}, { ok: false, error: 'not found' })[1]).toMatchObject({
      id: 'codex',
      tone: 'warning',
      detail: 'not found',
    });
  });
});

describe('analysis helpers', () => {
  it('selects the latest matching analysis for a dataset and kind', () => {
    const analyses = [
      { id: 'tag-new', datasetId: 'ds-1', kind: 'tag', finishedAt: '2026-06-27T12:05:00.000Z' },
      { id: 'thread-old', datasetId: 'ds-1', kind: 'thread', finishedAt: '2026-06-27T12:00:00.000Z' },
      { id: 'thread-new', datasetId: 'ds-1', kind: 'thread', startedAt: '2026-06-27T12:10:00.000Z' },
      { id: 'thread-other', datasetId: 'ds-2', kind: 'thread', finishedAt: '2026-06-27T12:20:00.000Z' },
    ];

    expect(latestAnalysisForDataset(analyses, 'ds-1', 'thread')).toMatchObject({ id: 'thread-new' });
    expect(latestAnalysisForDataset(analyses, 'ds-2', 'tag')).toBe(null);
  });

  it('sorts and scopes analysis lists for the selected dataset', () => {
    const analyses = [
      { id: 'old-report', datasetId: 'ds-1', kind: 'report', finishedAt: '2026-06-27T12:00:00.000Z' },
      { id: 'new-thread', datasetId: 'ds-1', kind: 'thread', startedAt: '2026-06-27T12:20:00.000Z' },
      { id: 'new-report', datasetId: 'ds-1', kind: 'report', finishedAt: '2026-06-27T12:10:00.000Z' },
      { id: 'other-report', datasetId: 'ds-2', kind: 'report', finishedAt: '2026-06-27T12:30:00.000Z' },
    ];

    expect(sortAnalysesLatestFirst(analyses).map((analysis) => analysis.id)).toEqual([
      'other-report',
      'new-thread',
      'new-report',
      'old-report',
    ]);
    expect(analysesForDataset(analyses, 'ds-1', 'report').map((analysis) => analysis.id)).toEqual(['new-report', 'old-report']);
  });

  it('summarizes arbitrary Codex JSONL events without schema assumptions', () => {
    expect(codexEventLabel({ type: 'turn.started' })).toBe('turn.started');
    expect(codexEventLabel({ type: 'agent.message', message: 'Working on it' })).toBe('agent.message: Working on it');
    expect(codexEventLabels([
      { type: 'a' },
      { type: 'b' },
      { type: 'c', text: 'done' },
    ], 2)).toEqual(['b', 'c: done']);
  });
});

describe('workspace', () => {
  it('creates a safe local workspace directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apify-studio-'));
    const dir = ensureWorkspace(root, 'default');
    expect(fs.existsSync(dir)).toBe(true);
    expect(ensureWorkspace(root, 'default')).toBe(dir);
    expect(safeFilename('bad/name with spaces')).toBe('bad-name-with-spaces');
    expect(safeFilename('!!!')).toBe('file');
  });

  it('keeps local file actions inside their intended root', () => {
    const root = path.join(os.tmpdir(), 'apify-studio-root');
    expect(isPathInside(root, path.join(root, 'datasets', 'a.json'))).toBe(true);
    expect(isPathInside(root, `${root}-sibling/file.json`)).toBe(false);
    expect(isPathInside(root, path.join(root, '..', 'outside.json'))).toBe(false);
  });
});

describe('validation primitives', () => {
  it('validates primitive values with useful bounds', () => {
    expect(boolValue('x')).toBe(true);
    expect(stringValue('  ok  ', 'Name', { required: true, max: 4 })).toBe('ok');
    expect(enumValue('csv', 'Format', ['csv', 'jsonl'])).toBe('csv');
    expect(intValue('3', 'Count', { min: 1, max: 5 })).toBe(3);
    expect(optionalRecord('', 'Payload')).toEqual({});
    expect(stringArray(['a', 'a', 'b'], 'Tags')).toEqual(['a', 'b']);

    expect(() => stringValue('', 'Name', { required: true })).toThrow(/required/);
    expect(() => stringValue('abcdef', 'Name', { max: 3 })).toThrow(/too long/);
    expect(() => enumValue('xml', 'Format', ['csv'])).toThrow(/unsupported/);
    expect(() => intValue('1.2', 'Count')).toThrow(/whole number/);
    expect(() => optionalRecord([], 'Payload')).toThrow(/object/);
    expect(() => stringArray('tag', 'Tags')).toThrow(/list/);
  });

  it('validates card and move payloads', () => {
    expect(validateCardPayload({ title: 'Trend', tags: ['ai', 'ai'], signalCount: 7 })).toMatchObject({
      title: 'Trend',
      tags: ['ai'],
      signalCount: '7',
      column: 'detected',
    });
    expect(validateMoveCardPayload({ cardId: 'card-1', column: 'ready', card: { title: 'Trend' } })).toMatchObject({
      cardId: 'card-1',
      column: 'ready',
      card: { title: 'Trend' },
    });
    expect(() => validateCardPayload({ title: '' })).toThrow(/Card title/);
    expect(() => validateMoveCardPayload({ cardId: 'card 1', column: 'ready' })).toThrow(/Card ID/);
  });
});

describe('dashboard helpers', () => {
  it('handles empty and malformed state without crashing', () => {
    expect(summarizeStudio({ datasets: 'bad', keys: {} })).toMatchObject({
      recipes: 0,
      totalItems: 0,
      apifyConnected: false,
      latestDataset: null,
      latestRun: null,
    });
    expect(derivePlatformBreakdown([{ itemCount: 'bad' }, { platform: 'z', itemCount: 0 }])).toEqual([
      { platform: 'unknown', datasets: 1, items: 0 },
      { platform: 'z', datasets: 1, items: 0 },
    ]);
    expect(buildPipeline({}).map((stage) => stage.tone)).toEqual(['warning', 'ready', 'neutral', 'ready', 'neutral']);
    expect(groupThreads([{ text: 'floating' }])).toMatchObject([{ id: 'unthreaded', root: { text: 'floating' }, replies: [] }]);
  });

  it('summarizes app state and platform coverage for the Thinklet workspace', () => {
    const state = {
      recipes: [{ id: 'recipe-1' }],
      runs: [{ status: 'succeeded' }, { status: 'failed' }],
      datasets: [
        { id: 'ds-1', platform: 'reddit', itemCount: 10, name: 'Reddit pulse' },
        { id: 'ds-2', platform: 'x', itemCount: 5, name: 'X scan' },
        { id: 'ds-3', platform: 'reddit', itemCount: 7, name: 'Reddit leads' },
      ],
      analyses: [{ kind: 'tag', status: 'succeeded' }, { kind: 'report', status: 'failed' }],
      cards: [{ id: 'card-1' }, { id: 'card-2' }],
      assets: [{ id: 'asset-1', status: 'done' }, { id: 'asset-2', status: 'failed' }],
      keys: { APIFY_API_TOKEN: true },
      jobs: [{ id: 'job-1' }],
    };

    expect(summarizeStudio(state)).toMatchObject({
      recipes: 1,
      runs: 2,
      datasets: 3,
      reports: 1,
      cards: 2,
      assets: 2,
      assetsDone: 1,
      totalItems: 22,
      activeJobs: 1,
      apifyConnected: true,
    });
    expect(derivePlatformBreakdown(state.datasets)).toEqual([
      { platform: 'reddit', datasets: 2, items: 17 },
      { platform: 'x', datasets: 1, items: 5 },
    ]);
    expect(buildPipeline(state)[1]).toMatchObject({
      id: 'runs',
      count: 2,
      detail: '1 complete, 1 failed',
      tone: 'warning',
    });
    expect(buildPipeline(state).at(-1)).toMatchObject({
      id: 'assets',
      count: 2,
      detail: '1 complete, 2 cards',
    });
    expect(countByStatus([{ status: 'ready' }, {}, { status: 'ready' }])).toEqual({ ready: 2, unknown: 1 });
  });

  it('groups normalized comments into thread previews', () => {
    expect(groupThreads([
      { id: 'post-1', text: 'root', threadId: 't1' },
      { id: 'comment-1', text: 'reply', threadId: 't1', parentId: 'post-1' },
      { id: 'post-2', text: 'solo' },
    ])).toMatchObject([
      { id: 't1', root: { id: 'post-1' }, replies: [{ id: 'comment-1' }] },
      { id: 'post-2', root: { id: 'post-2' }, replies: [] },
    ]);
  });
});

describe('studio intelligence', () => {
  const state = {
    keys: { APIFY_API_TOKEN: true },
    recipes: [{ id: 'recipe-1', name: 'RevOps hiring scan', platform: 'linkedin' }],
    datasets: [{ id: 'ds-1', name: 'RevOps hiring leads', platform: 'linkedin', itemCount: 2, createdAt: '2026-06-29T10:00:00.000Z' }],
  };
  const payload = {
    items: [
      {
        id: 'a',
        companyName: 'Acme AI',
        title: 'Hiring VP RevOps',
        text: 'Acme AI is hiring RevOps leadership for sales-led growth.',
        url: 'https://example.com/acme',
        email: 'ops@example.com',
      },
      {
        id: 'b',
        company: 'Northstar',
        jobTitle: 'Revenue Operations Manager',
        description: 'Scaling GTM systems.',
        url: 'https://example.com/northstar',
      },
    ],
  };

  it('profiles datasets into a usable kind with recommended next actions', () => {
    const profile = profileDataset(state.datasets[0], payload);

    expect(profile).toMatchObject({
      datasetId: 'ds-1',
      kind: 'lead-list',
      reportPresetId: 'lead-list',
      itemCount: 2,
    });
    expect(profile.confidence).toBeGreaterThan(0.7);
    expect(profile.health).toMatchObject({ label: 'Excellent', tone: 'ready' });
    expect(profile.recommendedActions.map((action) => action.action)).toEqual([
      'analyze-dataset',
      'export-dataset',
      'create-card',
    ]);
  });

  it('surfaces quality warnings instead of pretending bad data is ready', () => {
    const profile = profileDataset({ id: 'empty', name: 'Empty scrape' }, { items: [] });

    expect(profile.kind).toBe('empty');
    expect(profile.warnings).toContain('Dataset has no normalized rows.');
    expect(profile.recommendedActions[0]).toMatchObject({ action: 'run-recipe' });
  });

  it('plans runnable plain-English commands against current app state', () => {
    const intelligenceState = buildStudioIntelligence(state, () => payload);
    const plan = planIntent('make me a lead sheet from the latest data', {
      ...state,
      intelligence: intelligenceState,
    });

    expect(plan.canRun).toBe(true);
    expect(plan.steps.map((step) => step.action)).toEqual(['analyze-dataset', 'export-dataset']);
    expect(plan.steps[0].args).toMatchObject({ datasetId: 'ds-1', kind: 'report', reportPresetId: 'lead-list' });
    expect(plan.steps[1].args).toMatchObject({ datasetId: 'ds-1', format: 'csv' });
  });

  it('asks for the exact missing setup when a scrape cannot run yet', () => {
    const plan = planIntent('scrape reddit hiring posts', {
      keys: {},
      recipes: [],
      datasets: [],
      intelligence: buildStudioIntelligence({ keys: {}, recipes: [], datasets: [] }),
    });

    expect(plan.canRun).toBe(false);
    expect(plan.missing).toEqual([
      'Save APIFY_API_TOKEN in Settings.',
      'Create or save a recipe before asking the app to scrape.',
    ]);
  });

  it('profiles social, product, and review datasets with matching report routes', () => {
    expect(profileDataset({ id: 'social', name: 'Subreddit pulse', platform: 'reddit' }, {
      items: [{ id: 'p1', type: 'post', author: 'ana', text: 'People keep asking about agents.', url: 'https://reddit.com/r/x' }],
    })).toMatchObject({ kind: 'social-posts', reportPresetId: 'subreddit-pulse', warnings: [] });

    expect(profileDataset({ id: 'products', name: 'Competitor product prices' }, {
      items: [{ sku: 'a1', productName: 'AI plan', price: 29, url: 'https://example.com/p' }],
    })).toMatchObject({ kind: 'ecommerce-products', reportPresetId: 'competitive-report' });

    expect(profileDataset({ id: 'reviews', name: 'Review scrape' }, {
      items: [{ rating: 2, reviewText: 'Slow support', text: 'Slow support', url: 'https://example.com/r' }],
    })).toMatchObject({ kind: 'reviews', reportPresetId: 'market-scan' });
  });

  it('keeps studio intelligence alive when a dataset payload cannot be read', () => {
    const result = buildStudioIntelligence({
      datasets: [{ id: 'broken', name: 'Broken dataset', itemCount: 8 }],
    }, () => {
      throw new Error('bad json');
    });

    expect(result.datasetProfiles[0]).toMatchObject({
      datasetId: 'broken',
      kind: 'table',
      health: { tone: 'warning' },
      warnings: ['bad json'],
    });
  });

  it('plans scrape, tag, thread, card, and export variants without duplicate steps', () => {
    const intelligenceState = buildStudioIntelligence(state, () => payload);
    const baseState = { ...state, intelligence: intelligenceState };

    expect(planIntent('run the recipe', baseState)).toMatchObject({
      canRun: true,
      steps: [{ action: 'run-recipe', args: { recipeId: 'recipe-1' } }],
    });

    const plan = planIntent('tag and thread this dataset, export jsonl, and make a kanban card', baseState);
    expect(plan.steps.map((step) => step.action)).toEqual([
      'analyze-dataset',
      'analyze-dataset',
      'export-dataset',
      'create-card',
    ]);
    expect(plan.steps[2].args).toMatchObject({ format: 'jsonl' });
  });

  it('chooses report presets from user intent before falling back to the profile', () => {
    const intelligenceState = buildStudioIntelligence(state, () => payload);
    const baseState = { ...state, intelligence: intelligenceState };

    expect(planIntent('make a competitor positioning report', baseState).steps[0].args.reportPresetId).toBe('competitive-report');
    expect(planIntent('build account outreach intelligence', baseState).steps[0].args.reportPresetId).toBe('account-intelligence');
    expect(planIntent('summarize the reddit community', baseState).steps[0].args.reportPresetId).toBe('subreddit-pulse');
    expect(planIntent('analyze this', baseState).steps[0].args.reportPresetId).toBe('lead-list');
  });

  it('plans against the selected dataset instead of always using the first dataset', () => {
    const twoDatasetState = {
      ...state,
      datasets: [
        state.datasets[0],
        { id: 'ds-2', name: 'Competitor product prices', platform: 'web', itemCount: 1 },
      ],
    };
    const intelligenceState = buildStudioIntelligence(twoDatasetState, (dataset) => (dataset.id === 'ds-2'
      ? { items: [{ sku: 'a1', productName: 'AI plan', price: 29, url: 'https://example.com/p' }] }
      : payload));
    const plan = planIntent('analyze this', {
      ...twoDatasetState,
      intelligence: intelligenceState,
      selectedDatasetId: 'ds-2',
    });

    expect(plan.targetDatasetId).toBe('ds-2');
    expect(plan.steps[0].args).toMatchObject({ datasetId: 'ds-2', reportPresetId: 'competitive-report' });
    expect(plan.profile).toMatchObject({ datasetId: 'ds-2', kind: 'ecommerce-products' });
  });

  it('falls back to the next useful action for vague commands', () => {
    const intelligenceState = buildStudioIntelligence(state, () => payload);

    expect(planIntent('what should I do next', { ...state, intelligence: intelligenceState }).steps.map((step) => step.action)).toEqual([
      'analyze-dataset',
      'analyze-dataset',
    ]);
    expect(planIntent('what should I do next', { keys: { APIFY_API_TOKEN: true }, recipes: state.recipes, datasets: [] }).steps[0].action).toBe('run-recipe');
    expect(planIntent('what should I do next', { keys: {}, recipes: [], datasets: [] }).missing).toEqual(['Create a recipe or run a dataset first.']);
  });

  it('builds a prioritized workspace action queue from setup and dataset state', () => {
    expect(buildWorkPlan({ keys: {}, recipes: [], datasets: [] }).map((item) => item.id)).toEqual([
      'connect-apify',
      'save-recipe',
    ]);

    expect(buildWorkPlan({
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: [],
    })[0]).toMatchObject({
      id: 'run-first-scrape',
      action: 'run-recipe',
      args: { recipeId: 'recipe-1' },
    });

    const intelligenceState = buildStudioIntelligence(state, () => payload);
    expect(intelligenceState.workPlan.map((item) => item.id)).toEqual([
      'generate-report',
      'tag-dataset',
      'create-card',
    ]);
    expect(intelligenceState.operatorBrief).toContain('RevOps hiring leads');
  });

  it('builds action queues and suggestions for the selected dataset', () => {
    const twoDatasetState = {
      ...state,
      datasets: [
        state.datasets[0],
        { id: 'ds-2', name: 'Competitor product prices', platform: 'web', itemCount: 1 },
      ],
      selectedDatasetId: 'ds-2',
    };
    const intelligenceState = buildStudioIntelligence(twoDatasetState, (dataset) => (dataset.id === 'ds-2'
      ? { items: [{ sku: 'a1', productName: 'AI plan', price: 29, url: 'https://example.com/p' }] }
      : payload));

    expect(buildWorkPlan(twoDatasetState, intelligenceState.datasetProfiles, intelligenceState.readiness)[0]).toMatchObject({
      id: 'generate-report',
      args: { datasetId: 'ds-2', reportPresetId: 'competitive-report' },
    });
    expect(suggestCommands(twoDatasetState, intelligenceState.datasetProfiles)[0]).toMatchObject({
      id: 'competitive-report',
    });
    expect(intelligenceState.workPlansByDataset['ds-2'][0]).toMatchObject({
      args: { datasetId: 'ds-2', reportPresetId: 'competitive-report' },
    });
    expect(intelligenceState.suggestedCommandsByDataset['ds-2'][0]).toMatchObject({
      id: 'competitive-report',
    });
    expect(intelligenceState.nextActions[0]).toMatchObject({
      args: { datasetId: 'ds-2', reportPresetId: 'competitive-report' },
    });
  });

  it('reroutes empty datasets away from Codex analysis work', () => {
    const emptyState = {
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: [{ id: 'ds-empty', name: 'Empty run', platform: 'reddit', itemCount: 0 }],
      analyses: [],
      cards: [],
    };
    const intelligenceState = buildStudioIntelligence(emptyState, () => ({ items: [] }));

    expect(intelligenceState.workPlan.map((item) => item.id)).toEqual([
      'rerun-empty-dataset',
      'inspect-dataset-health',
    ]);
    expect(planIntent('what should I do next', { ...emptyState, intelligence: intelligenceState }).steps).toEqual([
      expect.objectContaining({ action: 'run-recipe', args: { recipeId: 'recipe-1' } }),
    ]);
    expect(planIntent('make a report', { ...emptyState, intelligence: intelligenceState })).toMatchObject({
      canRun: false,
      missing: ['Run the recipe again before asking Codex to analyze an empty dataset.'],
    });
  });

  it('suggests contextual command chips for setup, scraping, and dataset work', () => {
    expect(suggestCommands({ keys: {}, recipes: [], datasets: [] }).map((item) => item.command)).toEqual([
      'scrape reddit posts about my market',
      'create a lead sheet from the latest dataset',
    ]);

    expect(suggestCommands({
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: [],
    })[0]).toMatchObject({
      id: 'run-latest-recipe',
      command: 'run the latest recipe',
    });

    const intelligenceState = buildStudioIntelligence(state, () => payload);
    expect(intelligenceState.suggestedCommands.map((item) => item.command)).toEqual([
      'make me a lead sheet from the latest data',
      'tag and thread this dataset',
      'export csv and create a kanban card',
    ]);
  });

  it('builds a first-run setup checklist with one current step', () => {
    expect(buildSetupSteps({ keys: {}, recipes: [], datasets: [], analyses: [] }).map((step) => step.status)).toEqual([
      'current',
      'next',
      'next',
      'next',
    ]);

    const ready = buildSetupSteps({
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: state.datasets,
      analyses: [{ id: 'report-1', status: 'succeeded' }],
    });
    expect(ready.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(ready.map((step) => step.view)).toEqual(['settings', 'automation', 'automation', 'reports']);
  });

  it('summarizes setup readiness into percent, label, and next action', () => {
    const firstRunSteps = buildSetupSteps({ keys: {}, recipes: [], datasets: [], analyses: [] });
    expect(buildReadinessSummary(firstRunSteps)).toMatchObject({
      percent: 0,
      doneCount: 0,
      total: 4,
      label: 'Needs setup',
      nextView: 'settings',
      currentStep: { id: 'token' },
    });

    const nearlyReady = buildStudioIntelligence({
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: state.datasets,
      analyses: [],
    }, () => payload);
    expect(nearlyReady.readiness).toMatchObject({
      percent: 75,
      doneCount: 3,
      label: 'Almost ready',
      nextView: 'reports',
      currentStep: { id: 'analysis' },
    });

    const ready = buildReadinessSummary(buildSetupSteps({
      keys: { APIFY_API_TOKEN: true },
      recipes: state.recipes,
      datasets: state.datasets,
      analyses: [{ id: 'report-1', status: 'succeeded' }],
    }));
    expect(ready).toMatchObject({
      percent: 100,
      label: 'Ready',
      currentStep: null,
      nextView: 'dashboard',
    });
  });
});
