import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import v5 from '../src/shared/v5-core.js';
import validation from '../src/shared/validation.js';

// What remains of the v5 module after Workflows replaced missions: the event log helpers, Scrapers' recipe versions and
// the dataset profile and evidence index.
const { appendEvent, buildDatasetProfileV2, buildEvidenceIndex, createEvent, projectEvents, searchEvidence } = v5;
const { validateRecipeVersionPayload } = validation;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const requireFromTest = createRequire(import.meta.url);

const fixedNow = () => '2026-06-29T12:00:00.000Z';

describe('V5 event log and recipe versions', () => {
  it('projects recipe versions from a legacy import and later saves, newest first, ignoring retired mission events', () => {
    const events = [
      createEvent('legacy-imported', { data: { recipes: [{ id: 'recipe-1', name: 'Competitor products', input: { q: 'pricing' }, mapper: {} }] } }, { now: fixedNow }),
      createEvent('mission-saved', { mission: { id: 'mission-1', name: 'Old mission' } }, { now: fixedNow }),
      createEvent('recipe-version-saved', { recipeId: 'recipe-1', version: { version: 2, name: 'Competitor products', input: { q: 'pricing' }, mapper: { text: 'title' } } }, { now: fixedNow }),
      createEvent('job-started', { id: 'job-1', missionId: 'mission-1', kind: 'codex' }, { now: fixedNow }),
    ];
    const projection = projectEvents(events, { now: fixedNow });
    expect(Object.keys(projection)).toEqual(['version', 'projectedAt', 'recipeVersions']);
    expect(projection.recipeVersions['recipe-1'].map((row) => row.version)).toEqual([2, 1]);
    expect(projection.recipeVersions['recipe-1'][0]).toMatchObject({ version: 2, mapper: { text: 'title' } });
    expect(projectEvents([{ ...createEvent('recipe-version-saved', { recipeId: 'r', version: { version: 9 } }), version: 99 }]).recipeVersions).toEqual({});
  });

  it('appends events as jsonl without corrupting previous records, and reads a missing file as empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apify-v5-events-'));
    try {
      const filePath = path.join(dir, 'events.jsonl');
      expect(v5.readEvents(filePath)).toEqual([]);
      appendEvent(filePath, createEvent('recipe-version-saved', { recipeId: 'a', version: { version: 1 } }, { now: fixedNow }));
      appendEvent(filePath, createEvent('recipe-version-saved', { recipeId: 'b', version: { version: 1 } }, { now: fixedNow }));
      expect(v5.readEvents(filePath).map((row) => row.payload.recipeId)).toEqual(['a', 'b']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('validates a saved recipe version before it touches the log', () => {
    expect(validateRecipeVersionPayload({ recipeId: 'recipe-1', version: { version: 3, mapper: { text: 'body' } } })).toMatchObject({ recipeId: 'recipe-1', version: { version: 3 } });
  });
});

describe('Dataset profile and evidence', () => {
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

});

describe('V5 packaging', () => {
  it('copies the v5 module into packaged Electron output', () => {
    execFileSync(process.execPath, [path.join(projectRoot, 'scripts/copy-main-modules.mjs')], { stdio: 'pipe' });
    const packagedPath = path.join(projectRoot, 'out/shared/v5-core.js');
    expect(fs.existsSync(packagedPath)).toBe(true);
    delete requireFromTest.cache[requireFromTest.resolve(packagedPath)];
    const packaged = requireFromTest(packagedPath);
    expect(typeof packaged.projectEvents).toBe('function');
    expect(typeof packaged.buildEvidenceIndex).toBe('function');
  });
});
