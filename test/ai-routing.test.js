import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createAiRouting } = require('../src/main/ai-routing.js');
const { createAiCatalog } = require('../src/main/ai-catalog.js');
const research = require('../src/shared/research-program.js');

// Which connection, model and effort each AI task resolves to (src/main/ai-routing.js), from a run's snapshot down to
// the studio defaults, and the first routing a studio saved before Model routing gets (behavior-identical).
const roots = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
function catalogWith({ openrouter = [], codex = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-routing-')); roots.push(root);
  if (openrouter.length) { fs.mkdirSync(path.join(root, 'ai-catalog')); fs.writeFileSync(path.join(root, 'ai-catalog', 'openrouter-models.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), models: openrouter })); }
  const codexHome = path.join(root, 'codex'); fs.mkdirSync(codexHome);
  if (codex) fs.writeFileSync(path.join(codexHome, 'models_cache.json'), JSON.stringify(codex));
  return createAiCatalog({ dataDir: root, codexHome, fetchImpl: () => { throw new Error('no network in tests'); } });
}
const routingFor = (settings = {}, { programs = [], catalog = catalogWith(), isReady } = {}) => createAiRouting({ getSettings: () => settings, catalog, programs: () => programs, ...(isReady ? { isReady } : {}) });
const pick = (task) => ({ route: task.route, model: task.model, effort: task.effort });

describe('task resolution', () => {
  it('reproduces today’s models for a studio that never saved routing', () => {
    const routing = routingFor({ aiProvider: 'auto', aiModel: 'claude-opus-5-5' });
    for (const stage of research.RESEARCH_STAGES) {
      const task = routing.resolve(stage === 'reports' ? 'reports.trends-report' : `research.${stage}`);
      expect(pick(task)).toEqual({ route: 'auto', model: research.DEFAULT_RESEARCH_AI.models[stage], effort: research.DEFAULT_RESEARCH_AI.effort[stage] });
    }
    expect(pick(routing.resolve('assistant.ask-ai'))).toEqual({ route: 'auto', model: 'claude-opus-5-5', effort: 'medium' });
    expect(pick(routing.resolve('create.drafts'))).toEqual({ route: 'auto', model: 'claude-opus-5-5', effort: '' });
    expect(pick(routing.resolve('assets.blogshort'))).toEqual({ route: 'auto', model: 'claude-fable-5-1', effort: 'high' });
    expect(pick(routing.resolve('pictures.kit-brief'))).toEqual({ route: 'auto', model: 'claude-fable-5-1', effort: 'medium' });
    expect(routing.resolve('pictures.ask-ai')).toMatchObject({ route: 'openai', model: 'gpt-image-2.5-flare', quality: 'medium', metered: true, price: { basis: 'unit', unitUsd: 0.06 } });
    expect(routing.resolve('video.social-clip')).toMatchObject({ route: 'fal', model: 'bytedance/seedance-2.0/fast/text-to-video', video: { durationSeconds: 8, resolution: '720p', aspectRatio: '9:16', sound: false, input: 'text' } });
    // The settings default model follows Ask AI and the data tools.
    expect(routingFor({ aiModel: 'claude-sonnet-5-5' }).resolve('data.tag-items').model).toBe('claude-sonnet-5-5');
  });
  it('resolves in order: run snapshot, program choice, studio choice, inherit chain, kind default', () => {
    const settings = { aiRouting: { defaults: { text: { route: 'claude-api', model: 'claude-sonnet-5-5' } }, tasks: { 'reports.trends-report': { model: 'claude-opus-5-5', effort: 'xhigh' }, 'research.tagging': { effort: 'medium' } } } };
    const routing = routingFor(settings);
    // '@text' takes the studio's text route; an inherited task follows its parent's studio choice.
    expect(routing.resolve('reports.editorial-toolkit')).toMatchObject({ route: 'claude-api', model: 'claude-opus-5-5', effort: 'xhigh', source: 'inherited:reports.trends-report', effortSource: 'explicit' });
    expect(routing.resolve('assets.newsletter')).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(routing.resolve('research.tagging')).toMatchObject({ model: 'claude-fable-5-1', effort: 'medium', source: 'studio' });
    // A program's own choice wins for its runs; a legacy program's values that equal the shipped defaults aren't choices.
    const program = { ai: { overrides: { tagging: { model: 'claude-haiku-5-5', effort: 'low' } } } };
    expect(routing.resolve('research.tagging', { program })).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low', source: 'program' });
    const legacy = { ai: { models: { ...research.DEFAULT_RESEARCH_AI.models, discovery: 'claude-sonnet-5-5' }, effort: { ...research.DEFAULT_RESEARCH_AI.effort } } };
    expect(routing.programOverrides(legacy)).toEqual({ discovery: { model: 'claude-sonnet-5-5' } });
    expect(routing.resolve('research.discovery', { program: legacy })).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(routing.resolve('research.synthesis', { program: legacy })).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    // A started run keeps its snapshot, whatever the studio says later.
    const snapshot = routing.snapshot(['research.tagging'], { program });
    const later = routingFor({ aiRouting: { defaults: { text: { route: 'codex', model: '' } }, tasks: {} } });
    expect(later.resolve('research.tagging', { run: { ai: { routing: snapshot } } })).toEqual(snapshot['research.tagging']);
  });
  it('maps registry defaults that don’t fit the route and reports explicit choices that don’t', () => {
    // Codex: today’s “Codex ignores per-stage models”: default models become Codex default and default efforts drop.
    const codex = routingFor({ aiProvider: 'codex', aiModel: 'claude-opus-5-5' });
    expect(pick(codex.resolve('research.discovery'))).toEqual({ route: 'codex', model: '', effort: '' });
    expect(codex.resolve('research.discovery')).toMatchObject({ metered: false, price: { basis: 'none' } });
    const picked = routingFor({ aiRouting: { defaults: { text: { route: 'codex', model: '' } }, tasks: { 'research.tagging': { effort: 'high' } } } }, { catalog: catalogWith({ codex: { models: [{ slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] } }) });
    expect(picked.resolve('research.tagging')).toMatchObject({ route: 'codex', model: '', effort: 'high', effortSource: 'explicit' });
    // OpenRouter: a Claude default maps to its OpenRouter id only when OpenRouter lists it.
    const listed = catalogWith({ openrouter: [{ id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', route: 'openrouter', kind: 'text', efforts: ['low', 'medium', 'high'], structured: 'native', inputUsdPerMTok: 4, outputUsdPerMTok: 20 }] });
    const onOpenRouter = routingFor({ aiRouting: { defaults: { text: { route: 'openrouter', model: 'anthropic/claude-opus-5.5' } }, tasks: {} } }, { catalog: listed });
    expect(onOpenRouter.resolve('research.discovery')).toMatchObject({ route: 'openrouter', model: 'anthropic/claude-opus-5.5', effort: 'medium', price: { basis: 'tokens', inputUsdPerMTok: 4, source: 'openrouter' } });
    const fable = onOpenRouter.resolve('research.tagging');
    expect(fable.problem).toMatch(/can’t run on OpenRouter|Choose a model/);
    // An explicit pair that can't run is kept and named by validate() with its field.
    const wrong = routingFor({});
    expect(() => wrong.validate({ defaults: { text: { route: 'auto', model: 'claude-opus-5-5' } }, tasks: { 'research.tagging': { route: 'codex', model: 'claude-opus-5-5' } } })).toThrow(expect.objectContaining({ field: 'tasks.research.tagging.model' }));
    expect(() => wrong.validate({ tasks: { 'video.social-clip': { durationSeconds: 99 } } })).toThrow(expect.objectContaining({ field: 'tasks.video.social-clip.durationSeconds' }));
    expect(() => wrong.validate({ tasks: { 'nope.task': {} } })).toThrow(expect.objectContaining({ field: 'tasks.nope.task' }));
    expect(() => wrong.validate({ tasks: { 'assistant.ask-ai': { model: 'claude-haiku-4-5' } } })).not.toThrow();
    // A program choice without a route uses the studio's Claude route when the task's route can't run it.
    const codexStudio = routingFor({ aiRouting: { defaults: { text: { route: 'codex', model: '' } }, tasks: {} } });
    expect(codexStudio.resolve('research.tagging', { program: { ai: { overrides: { tagging: { model: 'claude-haiku-5-5', effort: 'low' } } } } })).toMatchObject({ route: 'auto', model: 'claude-haiku-5-5', effort: 'low' });
  });
  it('clamps effort to what the model offers and picks the cheapest strong reader for lite quick scans', () => {
    const routing = routingFor({ aiRouting: { tasks: { 'research.tagging': { model: 'claude-haiku-4-5', effort: 'high' } } } });
    expect(routing.resolve('research.tagging')).toMatchObject({ model: 'claude-haiku-4-5', effort: '', note: expect.stringContaining('doesn’t take an effort level') });
    const lite = routingFor({}).resolve('quickScans.discovery', { lite: true });
    expect(lite).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
  });
  it('resolves runs made before routing from their own models', () => {
    const routing = routingFor({ aiProvider: 'claude-api' });
    const run = { ai: { models: { ...research.DEFAULT_RESEARCH_AI.models, tagging: 'claude-sonnet-5-5' }, effort: research.DEFAULT_RESEARCH_AI.effort } };
    expect(routing.resolve('research.tagging', { run })).toMatchObject({ route: 'claude-api', model: 'claude-sonnet-5-5', effort: 'low', source: 'legacy' });
    expect(routing.resolve('reports.trends-report', { run: { ai: { model: 'claude-opus-5-5', effort: 'high' } } })).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', source: 'legacy' });
    expect(routing.resolve('pictures.kit-brief', { run: { ai: { model: 'claude-fable-5-1', effort: 'high' } } })).toMatchObject({ model: 'claude-fable-5-1', effort: 'medium' });
    expect(routing.resolve('research.tagging', { run: { ai: { route: 'codex', models: {} } } })).toMatchObject({ route: 'codex', model: '', effort: '' });
    expect(routing.resolve('pictures.kit-image', { run: { ai: { model: 'claude-fable-5-1' } } })).toMatchObject({ route: 'openai', model: 'gpt-image-2.5-flare', quality: 'medium' });
  });
});

describe('migration and presets', () => {
  it('seeds every channel asset with the newest program’s report model, as kits used to follow it', () => {
    const programs = [{ id: 'old', updatedAt: '2026-09-01', ai: { models: { reports: 'claude-opus-5-5' }, effort: { reports: 'high' } } }, { id: 'new', updatedAt: '2026-10-01', ai: { models: { reports: 'claude-sonnet-5-5' }, effort: { reports: 'medium' } } }];
    const routing = routingFor({ aiProvider: 'claude', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 2 }, { programs });
    const migrated = routing.current();
    expect(migrated).toMatchObject({ preset: 'custom', defaults: { text: { route: 'claude', model: 'claude-opus-5-5' } }, tasks: { 'assets.default': { model: 'claude-sonnet-5-5', effort: 'medium' } }, maxBudgetUsd: 2 });
    expect(routing.resolve('assets.pr')).toMatchObject({ route: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(routing.resolve('pictures.kit-brief')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(routingFor({}, { programs: [{ id: 'same', ai: research.DEFAULT_RESEARCH_AI }] }).current()).toMatchObject({ preset: 'balanced', tasks: {} });
  });
  it('builds presets from ready connections and previews their effect before anything is saved', () => {
    const routing = routingFor({});
    const cheap = routing.presetDraft('lowest-cost', { ready: (route) => route !== 'openrouter' });
    expect(cheap.tasks['research.tagging']).toEqual({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(cheap.tasks['video.social-clip']).toEqual({ durationSeconds: 5 });
    expect(cheap.defaults.image.quality).toBe('low');
    const best = routing.presetDraft('highest-quality');
    expect(routing.resolve('research.synthesis', { routing: best })).toMatchObject({ model: 'claude-fable-5-1', effort: 'xhigh' });
    const preview = routing.preview({ preset: 'lowest-cost' });
    expect(preview.changedCount).toBeGreaterThan(5);
    expect(preview.examples.researchRunUsd).toBeLessThan(routing.preview().examples.researchRunUsd);
    expect(preview.tasks.find((row) => row.taskId === 'video.social-clip')).toMatchObject({ unit: 'clip', typicalUsd: 1.21 });
    expect(routing.preview().tasks).toHaveLength(36);
  });
  it('says which tasks a piece of work uses before it spends', () => {
    const routing = routingFor({});
    expect(routing.taskIdsFor('createAssetKit', { deliverableIds: ['blogshort', 'social'], pictures: true, video: true })).toEqual(['assets.blogshort', 'assets.social', 'pictures.kit-brief', 'pictures.kit-image', 'video.brief', 'video.social-clip']);
    expect(routing.taskIdForPrompt({ id: 'assets.evidence-report', ai: { modelSource: 'kit' } })).toBe('assets.default');
    expect(routing.taskIdForPrompt({ id: 'pictures.variations' })).toBe('pictures.kit-image');
    expect(routing.taskIdForPrompt({ id: 'video.clip', ai: { taskId: 'video.social-clip' } })).toBe('video.social-clip');
  });
});
