import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const legacyPositioning = 'Explain the practitioner problem and the relevant approved product fit. Treat this as editorial direction, not proof of product features, measured outcomes or corporate positioning claims.';
const legacyEditorialRules = 'Enterprise and self-serve products stay separate. Affiliate material uses only explicitly approved self-serve products. Comprehensive evidence reports quote X and LinkedIn sources directly; Reddit is summarized with links. Editorial toolkits contain both enterprise and self-serve angles, five product-agnostic headlines/subheads/hooks each, two Enterprise CTAs and three PLG CTAs. Search Engine Land copy is attributed journalism, not product advertising. PR research excludes Search Engine Land, MarTech, Backlinko, Exploding Topics and Search Engine Roundtable under the supplied workspace policy; no guessed contacts or prior articles.';
const legacyKnowledge = (extra = {}) => ({ ...content.SEMRUSH_KNOWLEDGE_PRESET, version: 'semrush-workflow-v1', positioning: legacyPositioning, editorialRules: legacyEditorialRules, ...extra });
function setup(knowledge = legacyKnowledge(), extraWorkspaces = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-migration-')); roots.push(root);
  const general = { id: 'general', editionId: 'general', name: 'Your brand', knowledge: { editionId: 'general', name: 'Owner brand', version: 'semrush-workflow-v1', positioning: legacyPositioning, editorialRules: legacyEditorialRules }, products: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const semrush = { id: 'semrush', editionId: 'semrush', name: 'Semrush workspace', knowledge, products: [{ id: 'approved-owner-product', name: 'Owner registry data' }], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const state = { version: 1, activeWorkspaceId: 'general', workspaces: [general, semrush, ...extraWorkspaces], programs: [{ id: 'program-keep', workspaceId: 'semrush', name: 'Existing SEL source program' }], researchRuns: [], contentRuns: [{ id: 'run-keep', workspaceId: 'semrush', type: 'content', jobs: [{ id: 'sel-image', status: 'succeeded' }] }], themes: [], history: [], assets: [{ id: 'asset-keep', workspaceId: 'semrush', deliverableId: 'sel-image' }], exports: [], datasetOwners: { 'dataset-keep': 'semrush' } };
  const stateFile = path.join(root, 'state.json'); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const runDir = path.join(root, 'runs', 'run-keep'); fs.mkdirSync(runDir, { recursive: true });
  const inputFile = path.join(runDir, 'input.json'); const inputBytes = JSON.stringify({ brandKnowledge: legacyKnowledge(), deliverableIds: ['sel-image'], source: { text: 'An existing immutable source snapshot.' } }); fs.writeFileSync(inputFile, inputBytes);
  const deps = { root, runAI: vi.fn(), generateImage: vi.fn(), collect: vi.fn(), emit: vi.fn() };
  const api = createContentWorkspace(deps);
  return { root, stateFile, inputFile, inputBytes, state, api, deps, stored: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
}

describe('Semrush 2026 saved-workspace migration', () => {
  it('persists unchanged legacy defaults before exposing the service without touching other records or providers', () => {
    const h = setup(); const saved = h.stored(); const semrush = saved.workspaces[1];
    expect(semrush.knowledge).toEqual(content.validateBrandKnowledge(content.SEMRUSH_KNOWLEDGE_PRESET, { editionId: 'semrush' }));
    expect(semrush.brandDefaults).toEqual(content.SEMRUSH_BRAND_2026);
    expect(semrush.products).toEqual(h.state.workspaces[1].products);
    expect(semrush.createdAt).toBe('2026-01-01'); expect(semrush.updatedAt).not.toBe('2026-01-01');
    expect(saved.workspaces[0]).toEqual(h.state.workspaces[0]); expect(saved.activeWorkspaceId).toBe('general');
    for (const key of ['programs', 'researchRuns', 'contentRuns', 'themes', 'history', 'assets', 'exports', 'datasetOwners']) expect(saved[key]).toEqual(h.state[key]);
    expect(fs.readFileSync(h.inputFile, 'utf8')).toBe(h.inputBytes);
    for (const key of ['runAI', 'generateImage', 'collect', 'emit']) expect(h.deps[key]).not.toHaveBeenCalled();
  });
  it.each(['positioning', 'editorialRules'])('preserves custom %s and all other owner fields while refreshing the other unchanged field', field => {
    const customValue = `${field === 'positioning' ? legacyPositioning : legacyEditorialRules} Owner-specific additions must remain.`;
    const custom = legacyKnowledge({ [field]: customValue, voice: 'Owner voice', name: 'Owner campaign name', productContext: '', ownerExtension: { keep: true } });
    const h = setup(custom); const saved = h.stored().workspaces[1].knowledge;
    expect(saved[field]).toBe(customValue);
    const other = field === 'positioning' ? 'editorialRules' : 'positioning';
    expect(saved[other]).toBe(content.SEMRUSH_KNOWLEDGE_PRESET[other]);
    expect(saved).toMatchObject({ voice: 'Owner voice', name: 'Owner campaign name', productContext: '', ownerExtension: { keep: true } });
  });
  it('preserves deliberately empty fields and entirely custom legacy-version knowledge', () => {
    const custom = legacyKnowledge({ positioning: '', editorialRules: 'Owner SEL rules: retain our separate editorial design.' });
    const h = setup(custom); const saved = h.stored().workspaces[1];
    expect(saved.knowledge).toEqual(custom); expect(saved.brandDefaults.version).toBe('semrush-brand-2026');
  });
  it.each(['owner-approved', 'future-preset-v5'])('does not rewrite knowledge identified by the %s version', version => {
    const custom = legacyKnowledge({ version }); const h = setup(custom);
    expect(h.stored().workspaces[1].knowledge).toEqual(custom);
    expect(h.stored().workspaces[1].brandDefaults.sources).toContain('https://brand.semrush.com/');
  });
  it('does not move cross-edition knowledge or add Semrush metadata to another workspace edition', () => {
    const crossEdition = legacyKnowledge({ editionId: 'general' });
    const editorial = { id: 'editorial', editionId: 'general', name: 'SEL desk', knowledge: { name: 'SEL', editionId: 'general', version: 'semrush-workflow-v1', editorialRules: legacyEditorialRules }, products: [] };
    const h = setup(crossEdition, [editorial]); const saved = h.stored();
    expect(saved.workspaces[1].knowledge).toEqual(crossEdition); expect(saved.workspaces[2]).toEqual(editorial);
  });
  it('is idempotent across restarts and retains current brand metadata after owner settings saves', () => {
    const h = setup(); const bytes = fs.readFileSync(h.stateFile, 'utf8');
    const restarted = createContentWorkspace(h.deps);
    expect(fs.readFileSync(h.stateFile, 'utf8')).toBe(bytes);
    restarted.selectContentWorkspace('semrush');
    const active = restarted.publicState().workspaces.find(w => w.id === 'semrush');
    const saved = restarted.saveContentWorkspace({ id: 'semrush', name: 'My Semrush campaign', knowledge: { ...active.knowledge, voice: 'Owner revised voice', version: 'owner-approved' }, products: [] });
    expect(saved.brandDefaults).toEqual(content.SEMRUSH_BRAND_2026);
    const reloaded = createContentWorkspace(h.deps).publicState().workspaces.find(w => w.id === 'semrush');
    expect(reloaded.knowledge.voice).toBe('Owner revised voice'); expect(reloaded.knowledge.version).toBe('owner-approved');
  });
});
