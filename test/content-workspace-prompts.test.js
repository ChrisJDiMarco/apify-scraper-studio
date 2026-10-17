import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import fixture from './helpers/research-ai-fixture.js';
const { createContentWorkspace } = workspaceModule;
const { researchOutput } = fixture;
const template = require('../src/shared/prompt-template');

// Prompt Library through the content workspace (SPEC-2 §A): saved versions, run snapshots, previews, test runs, retries.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const sourceRows = (count) => Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards take too much manual work.`, url: `https://x.com/person${i}/status/${i + 1}`, publishedAt: '2026-09-20T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
const program = { id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 } };
function contentOutput(request) {
  const sectionIds = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find((d) => d.kind === 'text' && JSON.stringify(d.sections.map((s) => s.id)) === JSON.stringify(sectionIds));
  return { title: 'Reporting workflow evidence', summary: 'The sample describes manual reporting work.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'Text.', items: section.minItems ? Array.from({ length: section.minItems }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Short item.', evidenceIds: [], productIds: [] })) : [], evidenceIds: [], productIds: [] })), caveats: [] };
}
function harness({ role = 'admin', aiProvider = 'claude', fail = () => false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-workspace-prompts-')); roots.push(root);
  const calls = []; const jobs = []; const items = sourceRows(12); const caller = { role };
  const runAI = async (request) => {
    calls.push(request);
    if (fail(request)) throw Object.assign(new Error('Fixture failure.'), { costUsd: 0 });
    return { output: researchOutput(request) || contentOutput(request), receipt: { costUsd: 0.02, requestedModel: request.model || 'claude-opus-5-5' } };
  };
  const api = createContentWorkspace({ root, runAI, getDatasets: () => [{ id: 'dataset-a', name: 'Example source', platform: 'x', itemCount: items.length }], readDataset: async () => ({ items }), actor: () => ({ id: 'id-sam', name: 'Sam' }), getCallerRole: () => caller.role, trackJob: (job) => { const row = { ...job, status: 'running' }; jobs.push(row); return { finish: (patch) => Object.assign(row, patch), fail: () => { row.status = 'failed'; }, cancelled: () => false }; }, capabilities: () => ({ aiProvider, textModel: 'claude-opus-5-5' }) });
  return { api, root, calls, jobs, caller };
}
const input = (h, runId) => JSON.parse(fs.readFileSync(path.join(h.root, 'runs', runId, 'input.json'), 'utf8'));
const EMPTY = 'Return an empty list when nothing in this batch is a real trend.';
const OUTLIER = 'OUTLIER RULE: When a viral post has nothing to do with {{outlier}}, set themeId to null and confidence to 0.0.';

describe('Prompt Library in the content workspace', () => {
  it('lists every prompt for the edition and reads one with its model and history', async () => {
    const h = harness();
    const list = h.api.listPrompts();
    expect(list.groups.map((group) => group.label)).toEqual(['Research', 'Reports', 'Channel assets', 'Pictures', 'Video', 'Assistant', 'Data tools', 'Behind every call']);
    expect(list.prompts.find((row) => row.id === 'research.discovery')).toMatchObject({ name: 'Find candidate trends', version: 0, custom: false, locked: false, editable: true });
    expect(list.prompts.find((row) => row.id === 'system.claude')).toMatchObject({ editable: false });
    const read = await h.api.readPrompt({ id: 'research.discovery' });
    expect(read).toMatchObject({ version: 0, locked: false, lockedForYou: false, model: 'claude-opus-5-5', effort: 'medium', route: 'claude', metered: true, testable: true, history: [] });
    expect(read.blocks).toEqual(read.defaults);
    expect(Object.keys(read.blocks)).toEqual(['role', 'rules', 'criteria', 'fields', 'empty']);
    await expect(h.api.readPrompt({ id: 'nope' })).rejects.toMatchObject({ status: 404 });
  });

  it('previews for free with the editable spans marked and the draft checked', async () => {
    const h = harness();
    const preview = await h.api.previewPrompt({ id: 'research.discovery', blocks: { empty: EMPTY }, sample: 'bundled' });
    expect(preview.text).toContain(EMPTY); expect(preview.text).not.toMatch(/[\uE000-\uE002]/);
    expect(preview.segments.map((segment) => segment.blockId)).toEqual(['role', 'rules', 'criteria', 'fields', 'empty']);
    const empty = preview.segments.find((segment) => segment.blockId === 'empty');
    expect(preview.text.slice(empty.start, empty.end)).toBe(EMPTY);
    expect(preview).toMatchObject({ chars: preview.text.length, sample: 'bundled', problems: [], kind: 'text' });
    expect(preview.tokens).toBeGreaterThan(0); expect(preview.estimateUsd).toBeGreaterThan(0);
    expect((await h.api.previewPrompt({ id: 'research.discovery', blocks: { fields: 'x' } })).problems.length).toBeGreaterThan(0);
    // No run yet: "Latest run" falls back to the bundled sample and says so.
    expect((await h.api.previewPrompt({ id: 'research.synthesis', sample: 'latest' })).sampleLabel).toMatch(/no recent run has this yet/);
    expect(h.calls).toHaveLength(0);
  });

  it('saves versions credited to the caller, refuses stale versions and keeps locked prompts for admins', async () => {
    const h = harness({ role: 'editor' });
    const saved = await h.api.savePromptVersion({ id: 'research.discovery', blocks: { empty: EMPTY }, expectedVersion: 0, note: 'Plainer empty rule' });
    expect(saved).toMatchObject({ version: 1, changed: true, prompt: { custom: true, version: 1, updatedBy: { name: 'Sam', role: 'editor' } } });
    expect(saved.detail.history[0]).toMatchObject({ source: 'library', note: 'Plainer empty rule', by: { id: 'id-sam', name: 'Sam', role: 'editor' } });
    await expect(h.api.savePromptVersion({ id: 'research.discovery', blocks: { empty: 'Return nothing.' }, expectedVersion: 0, note: 'Two' })).rejects.toMatchObject({ status: 409, code: 'promptConflict' });
    await expect(h.api.setPromptLock({ id: 'research.discovery', locked: true })).rejects.toMatchObject({ status: 403 });
    h.caller.role = 'admin'; expect((await h.api.setPromptLock({ id: 'research.discovery', locked: true })).locked).toBe(true);
    h.caller.role = 'editor';
    expect((await h.api.readPrompt({ id: 'research.discovery' })).lockedForYou).toBe(true);
    await expect(h.api.savePromptVersion({ id: 'research.discovery', blocks: { empty: 'Return nothing.' }, expectedVersion: 1, note: 'Two' })).rejects.toMatchObject({ status: 403, code: 'promptLocked' });
    await expect(h.api.revertPrompt({ id: 'research.discovery', toVersion: 0, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
    h.caller.role = 'admin';
    const reverted = await h.api.revertPrompt({ id: 'research.discovery', toVersion: 0, expectedVersion: 1, note: '' });
    expect(reverted).toMatchObject({ version: 2, detail: { customized: [], history: [{ source: 'restore', revertOf: 0 }, { version: 1 }] } });
    expect(h.api.diffPromptVersions({ id: 'research.discovery', from: 1, to: 2 }).blocks.map((block) => block.blockId)).toEqual(['empty']);
    // The Inbox reads the latest saves from state.
    expect(h.api.publicState().promptChanges.map((row) => [row.promptId, row.version, row.byName, row.source])).toEqual([['research.discovery', 2, 'Sam', 'restore'], ['research.discovery', 1, 'Sam', 'library']]);
  });

  it('gives a research run its own copy of the prompts, so an edit while it waits for review changes nothing', async () => {
    const h = harness();
    await h.api.savePromptVersion({ id: 'research.discovery', blocks: { empty: EMPTY }, expectedVersion: 0, note: 'Plainer empty rule' });
    const saved = h.api.saveResearchProgram(program);
    const started = h.api.startResearchRun({ programId: saved.id, datasetIds: ['dataset-a'] }); await h.api.waitForIdle();
    const run = h.api.readStudioRun({ runId: started.id });
    expect(run.status).toBe('awaiting-review');
    expect(Object.keys(input(h, run.id).prompts)).toEqual(['research.discovery', 'research.synthesis', 'research.matching', 'research.tagging', 'reports.trends-report', 'reports.editorial-toolkit', 'system.repair']);
    expect(run.prompts['research.discovery']).toEqual({ version: 1, custom: true }); expect(run.prompts['research.tagging']).toEqual({ version: 0, custom: false });
    expect(h.calls.find((call) => call.schema.properties.candidates).prompt).toContain(EMPTY);
    // A later edit to tagging doesn't reach this run.
    await h.api.savePromptVersion({ id: 'research.tagging', blocks: { outlier: OUTLIER }, expectedVersion: 0, note: 'Shorter outlier rule' });
    h.api.approveResearchThemes({ runId: run.id, themes: run.themes.map((theme) => theme.id) }); h.api.continueResearchRun({ runId: run.id }); await h.api.waitForIdle();
    const tagging = h.calls.filter((call) => call.schema.properties.assignments);
    expect(tagging.length).toBeGreaterThan(0); expect(tagging.every((call) => !call.prompt.includes('When a viral post has nothing to do with'))).toBe(true);
    const done = h.api.readStudioRun({ runId: run.id });
    expect(done.status).toBe('succeeded');
    // Its report runs write with the research run's copy.
    const child = h.api.readStudioRun({ runId: done.reportRunIds[0].runId });
    expect(Object.keys(input(h, child.id).prompts)).toEqual(['reports.trends-report', 'reports.editorial-toolkit', 'system.repair']);
    expect(child.prompts['reports.trends-report']).toEqual({ version: 0, custom: false });
    // "Latest run" previews now read this run.
    expect((await h.api.previewPrompt({ id: 'research.discovery', sample: 'latest' }))).toMatchObject({ sample: 'latest', sampleLabel: expect.stringMatching(/X posts from “Weekly research”/) });
    expect((await h.api.previewPrompt({ id: 'reports.editorial-toolkit', sample: 'latest' })).sampleLabel).toMatch(/^The trends report for/);
  }, 30000); // a research run and its reports; slow when the suite runs in parallel.

  it('snapshots Create content and channel asset prompts, and refreshes them on a retry only when asked', async () => {
    let failing = true;
    const h = harness({ fail: (request) => failing && Boolean(request.schema?.properties?.sections) });
    const source = { kind: 'text', title: 'Pasted', text: 'Reporting friction is up across teams this week, according to the sample.' };
    const first = h.api.createContentRun({ source, deliverableIds: ['social'], maxBudgetUsd: 1 }); await h.api.waitForIdle();
    expect(Object.keys(input(h, first.id).prompts)).toEqual(['assets.shared', 'assets.social']);
    expect(h.api.readStudioRun({ runId: first.id }).status).toBe('failed');
    await h.api.savePromptVersion({ id: 'assets.social', blocks: { instruction: 'Write a LinkedIn post, a 5 to 7 post X thread and a Facebook post, in plain words.' }, expectedVersion: 0, note: 'Plain words' });
    failing = false; h.calls.length = 0;
    h.api.retryStudioRun({ runId: first.id }); await h.api.waitForIdle();
    expect(h.calls.some((call) => call.prompt.includes('in plain words.'))).toBe(false);
    failing = true; const second = h.api.createContentRun({ source, deliverableIds: ['social'], maxBudgetUsd: 1 }); await h.api.waitForIdle();
    await h.api.savePromptVersion({ id: 'assets.social', blocks: { instruction: 'Write a LinkedIn post, a 5 to 7 post X thread and a Facebook post, in plain words, for busy readers.' }, expectedVersion: 1, note: 'Busy readers' });
    failing = false; h.calls.length = 0;
    h.api.retryStudioRun({ runId: second.id, refreshPrompts: true }); await h.api.waitForIdle();
    expect(h.calls.some((call) => call.prompt.includes('for busy readers.'))).toBe(true);
    expect(h.api.readStudioRun({ runId: second.id }).prompts['assets.social']).toEqual({ version: 2, custom: true });
    // A kit prices and writes from one snapshot of the chosen assets' prompts.
    const plan = h.api.planAssetKit({ source, deliverableIds: ['social', 'blogshort'] });
    expect(plan.estimate.totalUsd).toBeGreaterThan(0);
    const made = h.api.createAssetKit({ source, deliverableIds: ['social', 'blogshort'] }); await h.api.waitForIdle();
    expect(Object.keys(input(h, made.id).prompts)).toEqual(['assets.shared', 'assets.blogshort', 'assets.social', 'system.repair']);
    expect(h.api.readStudioRun({ runId: made.id }).prompts['assets.social']).toEqual({ version: 2, custom: true });
  }, 30000); // content runs, an asset kit and a retry; slow when the suite runs in parallel.

  it('runs a confirmed test with the stage’s own checks and records it, refusing a stale estimate', async () => {
    const h = harness();
    const estimate = await h.api.estimatePromptTest({ id: 'research.matching', sample: 'bundled' });
    expect(estimate).toMatchObject({ available: true, kind: 'text', model: 'claude-opus-5-5', effort: 'medium', route: 'claude', metered: true, sample: 'bundled' });
    expect(estimate.capUsd).toBe(Math.min(5, Math.max(0.5, Math.ceil(estimate.estimateUsd * 3 * 100) / 100)));
    await expect(h.api.testPrompt({ id: 'research.matching', sample: 'bundled', fingerprint: 'stale' })).rejects.toMatchObject({ status: 409, code: 'promptTestChanged' });
    await expect(h.api.testPrompt({ id: 'research.matching', sample: 'bundled', blocks: { returns: 'Return matches.' }, fingerprint: (await h.api.estimatePromptTest({ id: 'research.matching', sample: 'bundled', blocks: { returns: 'Return matches.' } })).fingerprint })).rejects.toMatchObject({ status: 400, code: 'promptInvalid' });
    expect(h.calls).toHaveLength(0);
    const result = await h.api.testPrompt({ id: 'research.matching', sample: 'bundled', fingerprint: estimate.fingerprint });
    expect(result).toMatchObject({ ok: true, status: 'passed', problems: [], receipt: { costUsd: 0.02, route: 'claude', metered: true } });
    expect(h.calls).toHaveLength(1); expect(h.calls[0]).toMatchObject({ jobId: result.testId, maxBudgetUsd: estimate.capUsd, model: 'claude-opus-5-5', effort: 'medium' });
    expect(h.jobs).toEqual([expect.objectContaining({ id: result.testId, kind: 'prompt-test', cancellable: true, status: 'succeeded' })]);
    expect((await h.api.readPrompt({ id: 'research.matching' }))).toMatchObject({ version: 0, tests: [{ id: result.testId, ok: true, costUsd: 0.02 }] });
    expect(fs.existsSync(path.join(h.root, 'prompt-tests', result.testId))).toBe(false);
    expect(h.api.promptTestModels({ id: 'research.matching' })).toEqual(['claude-opus-5-5']);
    expect(h.api.promptTestModels({ id: 'pictures.kit-image' })).toEqual([]);
  });

  it('says when a test can’t run, and that Codex isn’t metered', async () => {
    const h = harness({ aiProvider: 'codex' });
    expect(await h.api.estimatePromptTest({ id: 'pictures.kit-image', sample: 'bundled' })).toMatchObject({ available: false, kind: 'image', estimateUsd: 0.06 });
    expect(await h.api.estimatePromptTest({ id: 'system.claude' })).toMatchObject({ available: false, kind: 'none' });
    expect(await h.api.estimatePromptTest({ id: 'research.tagging', sample: 'bundled' })).toMatchObject({ available: true, route: 'codex', metered: false, capUsd: 0, note: expect.stringMatching(/Your Codex plan \(not metered\)/) });
  });

  it('hands the host each prompt’s saved text for the callers that build prompts live', async () => {
    const h = harness();
    expect(h.api.promptEffective('assistant.ask-datasets')).toMatchObject({ version: 0, custom: false, blocks: template.defaultsFor('assistant.ask-datasets', 'general') });
    await h.api.savePromptVersion({ id: 'assistant.ask-datasets', blocks: { instructions: 'Answer only from the sample and cite every itemId you use.' }, expectedVersion: 0, note: 'Shorter' });
    expect(h.api.promptEffective('assistant.ask-datasets')).toMatchObject({ version: 1, custom: true, blocks: { instructions: 'Answer only from the sample and cite every itemId you use.' } });
    expect(h.api.promptEffective('nope')).toEqual({ version: 0, custom: false, blocks: null });
  });
});
