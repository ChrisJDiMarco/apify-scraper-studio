import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import setupModule from '../src/shared/setup-bundle.js';
import content from '../src/shared/content-studio.js';
import schedules from '../src/shared/research-schedule.js';
import fixture from './helpers/research-ai-fixture.js';
const { createContentWorkspace } = workspaceModule;
const { buildSetupBundle, validateSetupBundle, summarizeSetupBundle, attachSetupSecrets, SETUP_LIMITS } = setupModule;
const CADENCE = Object.keys(schedules.DEFAULT_RESEARCH_SCHEDULE);
const TOKEN = 'apify_api_SETUPTEST0123456789abcdef';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const REGISTRY = `Product & Solution Registry

1. SEO Toolkit
URL: https://www.example.com/seo/
The SEO Toolkit is a fixture toolkit for keyword research, site audits and content planning work.
Tool Name | Core Function | Key Tags
Keyword Magic Tool | Builds keyword lists from a seed term | keywords, volume
Site Audit | Crawls a site and lists technical issues | crawl, health

2. Enterprise AIO
URL: https://www.example.com/enterprise/aio/
Enterprise AIO is a fixture enterprise product that tracks brand visibility inside AI answers for large teams.
`;
// The n8n Taxonomy Lookup tab layout (trailing unnamed monthly columns).
const TAXONOMY_ROWS = [['Category', 'Article Count', '% Share', 'Velocity', 'Last 6Mo', '6Mo Rate', 'Saturation', 'Zone', 'Top Keywords', 'Top Phrases', 'Timeline', 'Gap Analysis Notes', 'Editorial Action', '', '', ''],
  ['AI Search / GEO', '151', '11.30%', 'ACCELERATING', '126', 'HIGH', 'HIGH', 'SATURATED', 'search, chatgpt, llm', 'llm optimization', '2025:113', 'Refresh angles.', 'Cross-check titles.', '42', '14', '10'],
  ['Analytics & Measurement', '69', '5.10%', 'DORMANT', '8', 'LOW', 'MEDIUM', 'OPEN', 'analytics, attribution', 'google analytics', '2025:27', 'Open territory.', 'Fast-track.', '2', '2', '0'],
  ['Local SEO', '56', '4.20%', 'SLOWING', '16', 'MED', 'MEDIUM', 'MODERATE', 'local, reviews', 'local seo', '2025:39', '', 'Title-level check.', '4', '0', '4']];
const weeklyProgram = (extra = {}) => ({ id: 'program-weekly', name: 'Weekly SEO listening', query: 'AI search', sourceGroups: [{ sourceId: 'x', platform: 'x', targets: ['searchpat', '@answer_dev'] }, { sourceId: 'linkedin-profile', platform: 'linkedin', targets: ['https://www.linkedin.com/in/pat-rivera-seo/'] }, { sourceId: 'reddit', platform: 'reddit', targets: ['r/SEO', 'bigseo'] }, { sourceId: 'linkedin-search', platform: 'linkedin', targets: ['ai overviews'], enabled: false }], budgets: { collectionUsd: 4, aiUsd: 12 }, targetPerPlatform: 500, schedule: { frequency: 'weekly', enabled: true, time: '07:30', timeZone: 'America/New_York', weekday: 2, dayOfMonth: 1, lookbackDays: 7 }, ...extra });
const manualProgram = (extra = {}) => ({ id: 'program-manual', name: 'Agency pulse', sourceGroups: [{ sourceId: 'reddit', platform: 'reddit', targets: ['agency'] }], budgets: { collectionUsd: 1, aiUsd: 5 }, ...extra });
const sourceRows = count => Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards take too much manual work.`, url: `https://x.com/person${i}/status/${i + 1}`, publishedAt: '2026-09-20T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
const errorOf = action => { try { action(); } catch (error) { return error; } throw new Error('Expected the call to throw.'); };

function harness({ time = '2026-10-08T12:00:00Z', state } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-bundle-test-')); roots.push(root);
  const stateFile = path.join(root, 'state.json'); if (state) fs.writeFileSync(stateFile, JSON.stringify(state));
  let now = time; const emit = vi.fn(); const items = sourceRows(5);
  const runAI = vi.fn(async request => ({ output: fixture.researchOutput(request), receipt: { costUsd: 0.001, provider: 'fixture', paid: false } }));
  const deps = { root, runAI, emit, clock: () => new Date(now), getDatasets: () => [{ id: 'dataset-a', name: 'Example source', platform: 'x', itemCount: items.length }], readDataset: async id => ({ id, items }) };
  return { root, stateFile, deps, emit, runAI, api: createContentWorkspace(deps), setTime: value => { now = value; }, raw: () => (fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : ''), stored: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
}
// The owner's Mac: Semrush knowledge, a two-product registry, the taxonomy tab, an ICP document and
// two programs (one on a weekly schedule), plus a program in the other workspace that must stay home.
function configureOwner(h) {
  h.api.saveResearchProgram({ id: 'program-general', name: 'Brand pulse', sourceGroups: [{ platform: 'x', targets: ['brandpulse'] }], workspaceId: 'general' });
  h.api.selectContentWorkspace('semrush');
  h.api.saveContentWorkspace({ id: 'semrush', name: 'Semrush workspace', knowledge: { ...content.SEMRUSH_KNOWLEDGE_PRESET, audience: 'In-house SEO leads.', icp: 'SEO leads at companies with 200+ people.' } });
  h.api.importProductRegistry({ workspaceId: 'semrush', text: REGISTRY, enterpriseProducts: ['Enterprise AIO'] });
  h.api.saveWorkspaceTaxonomy({ workspaceId: 'semrush', rows: TAXONOMY_ROWS, sourceName: 'Golden Thread.xlsx · Taxonomy Lookup' });
  h.api.saveReferenceDoc({ workspaceId: 'semrush', doc: { kind: 'icp', title: 'ICP', text: 'Our ideal customer is an in-house SEO lead.', source: { kind: 'paste', name: '' } } });
  h.api.saveResearchProgram({ ...weeklyProgram(), workspaceId: 'semrush' });
  h.api.saveResearchProgram({ ...manualProgram(), workspaceId: 'semrush' });
  return h;
}
// What travels between machines: everything but record IDs, timestamps and schedule bookkeeping.
function portable(stored, workspaceId) {
  const w = stored.workspaces.find(row => row.id === workspaceId);
  return {
    knowledge: w.knowledge, products: w.products, enterpriseProducts: w.enterpriseProducts, taxonomy: w.taxonomy, referenceDocs: w.referenceDocs.map(({ id: _id, updatedAt: _at, ...doc }) => doc),
    programs: stored.programs.filter(row => row.workspaceId === workspaceId).map(({ updatedAt: _at, workspaceId: _owner, schedule, ...program }) => ({ ...program, schedule: Object.fromEntries(CADENCE.map(key => [key, schedule[key]])) })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
const minimal = (extra = {}) => ({ kind: 'scraper-studio-setup', version: 1, workspace: { editionId: 'general', name: 'Brand', knowledge: {} }, ...extra });

describe('setup bundle format', () => {
  it('builds a deterministic bundle without record IDs, timestamps or run bookkeeping', () => {
    const knowledge = content.validateBrandKnowledge({ name: 'Acme', audience: 'Marketers' }, { editionId: 'general' });
    const workspace = { id: 'workspace-1', name: 'Acme', editionId: 'general', knowledge, products: [], referenceDocs: [{ id: 'doc-1', kind: 'positioning', title: 'Positioning', text: 'We help marketers.', source: null, updatedAt: '2026-10-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    const stored = { ...weeklyProgram(), workspaceId: 'workspace-1', updatedAt: '2026-10-01T00:00:00.000Z', schedule: { ...weeklyProgram().schedule, nextRunAt: '2026-10-13T11:30:00.000Z', lastRunAt: '2026-10-06T11:30:02.000Z', lastRunId: 'research-1', lastStatus: 'succeeded', lastError: '', lastScheduledFor: '2026-10-06T11:30:00.000Z', skippedAt: '', skippedReason: '' } };
    const bundle = buildSetupBundle({ workspace, programs: [stored, manualProgram()], exportedAt: '2026-10-08T12:00:00.000Z', appVersion: '0.1.0' });
    expect(Object.keys(bundle)).toEqual(['kind', 'version', 'exportedAt', 'app', 'workspace', 'programs']);
    expect(Object.keys(bundle.workspace)).toEqual(['editionId', 'name', 'knowledge', 'products', 'enterpriseProducts', 'taxonomy', 'referenceDocs']);
    expect(bundle).toMatchObject({ kind: 'scraper-studio-setup', version: 1, exportedAt: '2026-10-08T12:00:00.000Z', app: { version: '0.1.0' }, workspace: { editionId: 'general', name: 'Acme', knowledge, enterpriseProducts: null, taxonomy: null, referenceDocs: [{ kind: 'positioning', title: 'Positioning', text: 'We help marketers.', source: null }] } });
    // Name order, the owner's cadence (still enabled in the file) and no machine-specific state.
    expect(bundle.programs.map(program => program.id)).toEqual(['program-manual', 'program-weekly']);
    expect(bundle.programs[1].schedule).toEqual(weeklyProgram().schedule);
    const text = JSON.stringify(bundle);
    for (const value of ['workspace-1', 'doc-1', 'research-1', 'nextRunAt', 'lastRunId', 'updatedAt', 'createdAt', 'workspaceId']) expect(text).not.toContain(value);
    expect(buildSetupBundle({ workspace, programs: [manualProgram(), stored], exportedAt: '2026-10-08T12:00:00.000Z', appVersion: '0.1.0' })).toEqual(bundle);
    expect(() => buildSetupBundle({ workspace, programs: [{ ...manualProgram(), sourceGroups: [{ platform: 'x', targets: [] }] }] })).toThrow('Program 1 (“Agency pulse”): Add targets to each enabled source group.');
  });
  it('re-validates every part through the app validators and ignores unknown keys', () => {
    const input = minimal({ exportedAt: '2026-10-08T12:00:00.000Z', extra: { anything: true }, app: { version: ' 0.1.0 ', build: 7 }, workspace: { editionId: 'general', name: '  Brand  ', id: 'workspace-x', brandDefaults: { colors: {} }, knowledge: { name: 'Acme', voice: '  Plain.  ', ownerExtension: { keep: true } }, products: [{ id: 'suite', name: 'Suite', url: 'https://example.com/suite', segment: 'self-serve' }], enterpriseProducts: ['Suite Enterprise', 'Suite Enterprise'], taxonomy: { categories: [{ category: 'Local SEO', zone: 'open', topKeywords: 'Local, Maps' }] }, referenceDocs: [{ id: 'doc-x', kind: 'icp', title: ' ICP ', text: ' Text ', updatedAt: 'x' }] }, programs: [{ ...manualProgram(), workspaceId: 'elsewhere', schedule: { frequency: 'daily', enabled: false, nextRunAt: 'x', lastRunId: 'y' } }] });
    const bundle = validateSetupBundle(JSON.stringify(input));
    expect(bundle).toEqual(validateSetupBundle(`\uFEFF${JSON.stringify(input, null, 2)}`));
    expect(Object.keys(bundle)).toEqual(['kind', 'version', 'exportedAt', 'app', 'workspace', 'programs']);
    expect(bundle.app).toEqual({ version: '0.1.0' });
    expect(bundle.workspace).toEqual({
      editionId: 'general', name: 'Brand', knowledge: content.validateBrandKnowledge({ name: 'Acme', voice: 'Plain.' }, { editionId: 'general' }),
      products: [{ id: 'suite', editionId: 'general', name: 'Suite', segment: 'self-serve', url: 'https://example.com/suite', description: '', affiliateEligible: false, capabilities: [], tools: [] }],
      enterpriseProducts: ['Suite Enterprise'], taxonomy: { categories: [expect.objectContaining({ category: 'Local SEO', zone: 'OPEN', topKeywords: ['local', 'maps'] })], source: null }, referenceDocs: [{ kind: 'icp', title: 'ICP', text: 'Text', source: null }],
    });
    expect(bundle.programs[0].schedule).toEqual({ ...schedules.DEFAULT_RESEARCH_SCHEDULE, frequency: 'daily' });
    expect(Object.keys(bundle.programs[0])).not.toContain('workspaceId');
    expect(validateSetupBundle(minimal({ workspace: { ...minimal().workspace, taxonomy: { categories: [] } } })).workspace.taxonomy).toBeNull();
  });
  it('refuses anything but a readable version-1 setup file, with messages that do not quote the file', () => {
    const cases = [
      [undefined, 'Choose a Scraper Studio setup file.'], ['', 'Choose a Scraper Studio setup file.'],
      ['{"kind":"scraper-studio-setup","secrets":{"APIFY_API_TOKEN":"' + TOKEN + '"', 'This file is not a readable setup file. Export it again from Scraper Studio.'],
      ['[]', 'This is not a Scraper Studio setup file.'], [{ kind: 'apify-scraper-studio-state', version: 1 }, 'This is not a Scraper Studio setup file.'],
      [minimal({ version: '1' }), 'This setup file has no valid format version. Export it again from Scraper Studio.'], [minimal({ version: 0 }), /no valid format version/],
      [minimal({ version: 2 }), 'This setup file uses format 2 from a newer Scraper Studio. Update the app, then import it again.'],
      [minimal({ workspace: undefined }), 'This setup file has no workspace section.'], [minimal({ workspace: { editionId: 'enterprise', name: 'X', knowledge: {} } }), 'This setup file is for a workspace edition this app does not have. Update Scraper Studio, then import it again.'],
      [minimal({ workspace: { editionId: 'general', name: 'X' } }), 'This setup file has no brand knowledge section.'],
      [minimal({ workspace: { editionId: 'semrush', name: 'X', knowledge: { editionId: 'general' } } }), 'Brand knowledge: This knowledge belongs to a different workspace edition.'],
      [minimal({ workspace: { ...minimal().workspace, products: [{ id: 'one', name: 'One', url: 'http://insecure.example.com' }] } }), /^Product registry: /],
      [minimal({ workspace: { ...minimal().workspace, referenceDocs: [{ kind: 'memo', title: 'Memo', text: 'Text' }] } }), 'Reference document 1 (“Memo”): Choose one of these kinds: icp, positioning, registry, ai-visibility, other.'],
      [minimal({ exportedAt: 'yesterday' }), 'exportedAt must be a date and time.'],
      [minimal({ programs: [manualProgram(), manualProgram({ name: 'Copy' })] }), 'Program 2 (“Copy”): Another program in this file has the same ID.'],
      [minimal({ programs: [manualProgram({ id: 'agency pulse' })] }), 'Program 1 (“Agency pulse”): Program IDs may use only letters, numbers, hyphens and underscores.'],
    ];
    for (const [input, message] of cases) { const error = errorOf(() => validateSetupBundle(input)); expect(error.message).toEqual(typeof message === 'string' ? message : expect.stringMatching(message)); expect(error.message).not.toContain(TOKEN); }
    expect(errorOf(() => validateSetupBundle(minimal({ programs: [manualProgram({ id: 'agency pulse' })] }))).field).toBe('programs.0.id');
  });
  it('enforces size and count limits on the whole file and on its parts', () => {
    const large = `Setup files are limited to ${SETUP_LIMITS.characters.toLocaleString('en-US')} characters. Share fewer programs or shorter reference documents.`;
    expect(() => validateSetupBundle(minimal({ padding: 'x'.repeat(SETUP_LIMITS.characters) }))).toThrow(large);
    const doc = (index, text = 'Text') => ({ kind: 'other', title: `Doc ${index}`, text });
    expect(() => validateSetupBundle(minimal({ workspace: { ...minimal().workspace, referenceDocs: Array.from({ length: 21 }, (_, i) => doc(i)) } }))).toThrow('workspace.referenceDocs must be a list of up to 20 entries.');
    expect(() => validateSetupBundle(minimal({ workspace: { ...minimal().workspace, referenceDocs: [doc(1, 'x'.repeat(300001))] } }))).toThrow('Reference document 1 (“Doc 1”): text must be 300,000 characters or fewer.');
    expect(validateSetupBundle(minimal({ workspace: { ...minimal().workspace, referenceDocs: [doc(1, 'x'.repeat(300000))] } })).workspace.referenceDocs[0].text).toHaveLength(300000);
    expect(() => validateSetupBundle(minimal({ programs: Array.from({ length: 51 }, (_, i) => manualProgram({ id: `program-${i}` })) }))).toThrow('programs must be a list of up to 50 entries.');
    expect(() => validateSetupBundle(minimal({ workspace: { ...minimal().workspace, enterpriseProducts: Array.from({ length: 21 }, (_, i) => `Product ${i}`) } }))).toThrow('workspace.enterpriseProducts must be a list of up to 20 entries.');
    expect(() => validateSetupBundle(minimal({ workspace: { ...minimal().workspace, name: 'x'.repeat(161) } }))).toThrow('workspace.name must be 160 characters or fewer.');
    expect(() => validateSetupBundle(minimal({ workspace: { ...minimal().workspace, knowledge: { positioning: 'x'.repeat(12001) } } }))).toThrow(/^Brand knowledge: brandKnowledge.positioning must be 12000 characters or fewer/);
  });
  it('accepts only known secret names with single-line text values and never echoes them', () => {
    expect(validateSetupBundle(minimal({ secrets: { APIFY_API_TOKEN: ` ${TOKEN}\n` } })).secrets).toEqual({ APIFY_API_TOKEN: TOKEN });
    expect(validateSetupBundle(minimal({ secrets: { APIFY_API_TOKEN: '   ' } }))).not.toHaveProperty('secrets');
    expect(validateSetupBundle(minimal({ secrets: null }))).not.toHaveProperty('secrets');
    const refused = [
      [{ APIFY_API_TOKEN: TOKEN, OPENAI_API_KEY: 'sk-live-secret-value' }, 'A setup file can carry only these keys: APIFY_API_TOKEN.'],
      [{ [TOKEN]: 'value' }, 'A setup file can carry only these keys: APIFY_API_TOKEN.'],
      [{ APIFY_API_TOKEN: `${TOKEN} extra` }, `secrets.APIFY_API_TOKEN must be a single-line key of up to ${SETUP_LIMITS.secretCharacters} characters.`],
      [{ APIFY_API_TOKEN: `${TOKEN}${'x'.repeat(SETUP_LIMITS.secretCharacters)}` }, /single-line key/], [{ APIFY_API_TOKEN: 12345 }, /single-line key/],
      [TOKEN, 'secrets must name each key, for example { "APIFY_API_TOKEN": "…" }.'],
    ];
    for (const [secrets, message] of refused) {
      const error = errorOf(() => validateSetupBundle(minimal({ secrets })));
      expect(error.message).toEqual(typeof message === 'string' ? message : expect.stringMatching(message));
      for (const value of [TOKEN, 'sk-live-secret-value', '12345']) expect(error.message).not.toContain(value);
    }
  });
  it('attaches the host’s secrets as the last key, checked, and drops empty values', () => {
    const bundle = validateSetupBundle(minimal());
    const shared = attachSetupSecrets({ ...bundle, secrets: { APIFY_API_TOKEN: 'apify_api_previous' } }, { APIFY_API_TOKEN: TOKEN });
    expect(Object.keys(shared).at(-1)).toBe('secrets'); expect(shared.secrets).toEqual({ APIFY_API_TOKEN: TOKEN });
    expect(validateSetupBundle(JSON.stringify(shared, null, 2)).secrets).toEqual({ APIFY_API_TOKEN: TOKEN });
    expect(attachSetupSecrets(shared, { APIFY_API_TOKEN: '' })).toEqual(bundle);
    expect(attachSetupSecrets(bundle)).toEqual(bundle);
    expect(() => attachSetupSecrets(bundle, { APIFY_API_TOKEN: 'two words' })).toThrow(/single-line key/);
  });
  it('summarizes names and counts only, with readable schedules and spending warnings', () => {
    const programs = [
      weeklyProgram({ id: 'program-daily', name: 'Daily', schedule: { frequency: 'daily', enabled: false, time: '09:00', timeZone: 'UTC' } }),
      weeklyProgram({ id: 'program-monthly', name: 'Monthly', autoApproveThemes: true, budgets: { collectionUsd: 5, aiUsd: 30 }, schedule: { frequency: 'monthly', enabled: true, time: '06:00', timeZone: 'Europe/London', dayOfMonth: 15 } }),
      manualProgram(),
    ];
    const { summary, warnings } = summarizeSetupBundle(JSON.stringify(minimal({ app: { version: '0.1.0' }, programs, secrets: { APIFY_API_TOKEN: TOKEN } })));
    expect(summary.programs.map(program => [program.name, program.schedule.label, program.schedule.enabledInFile, program.schedule.arrivesPaused])).toEqual([['Daily', 'Daily at 09:00 UTC', false, true], ['Monthly', 'Monthly on day 15 at 06:00 Europe/London', true, true], ['Agency pulse', 'Manual runs only', false, false]]);
    expect(summary.programs[0]).toMatchObject({ sources: { x: 2, linkedin: 1, reddit: 2 }, targets: { enabled: 5, total: 6 }, sourceGroups: { enabled: 3, total: 4 }, budgets: { collectionUsd: 4, aiUsd: 12 }, targetPerPlatform: 500, query: 'AI search' });
    expect(summary.programs[0]).not.toHaveProperty('action');
    expect(summary).toMatchObject({ appVersion: '0.1.0', secrets: ['APIFY_API_TOKEN'], workspace: { name: 'Brand', editionLabel: 'Your brand', brandName: 'Your brand', knowledgeFields: [], products: { total: 0 }, taxonomy: null, referenceDocs: [] } });
    expect(summary).not.toHaveProperty('target');
    expect(summary.changes).toEqual(['2 schedules arrive paused; nothing runs until someone turns them on.']);
    expect(warnings).toEqual(['“Monthly” approves themes automatically, so a run continues to tagging and reports without stopping for review, spending up to its $30.00 AI budget.', 'This file contains APIFY_API_TOKEN. Treat it like a password: anyone with the file can use that key.']);
    expect(JSON.stringify({ summary, warnings })).not.toContain(TOKEN);
  });
});

describe('sharing a workspace setup between installs', () => {
  it('round-trips a configured workspace onto a fresh install with schedules paused and program IDs stable', () => {
    const owner = configureOwner(harness());
    const file = JSON.stringify(owner.api.exportSetup({ workspaceId: 'semrush', appVersion: '0.1.0' }), null, 2);
    const tester = harness({ time: '2026-10-09T08:00:00Z' });
    expect(tester.api.publicState().activeWorkspaceId).toBe('general');
    const result = tester.api.importSetup({ bundle: file });
    expect(result).toMatchObject({ workspaceId: 'semrush', programIds: ['program-manual', 'program-weekly'], state: { activeWorkspaceId: 'semrush' } });
    expect(result.summary.changes).toEqual(['Replaces the brand knowledge, product registry, taxonomy and reference documents of “Semrush workspace”.', 'Adds 2 programs.', '1 schedule arrives paused; nothing runs until someone turns it on.']);
    expect(tester.emit).toHaveBeenCalledTimes(1);
    const ownerView = portable(owner.stored(), 'semrush'); const testerView = portable(tester.stored(), 'semrush');
    expect(testerView).toEqual({ ...ownerView, programs: ownerView.programs.map(program => ({ ...program, schedule: { ...program.schedule, enabled: false } })) });
    expect(testerView.taxonomy.categories).toHaveLength(3); expect(testerView.products.map(product => product.segment)).toEqual(['self-serve', 'enterprise']);
    const stored = tester.stored(); const semrush = stored.workspaces.find(w => w.id === 'semrush');
    expect(stored.activeWorkspaceId).toBe('semrush');
    expect(semrush.referenceDocs.map(doc => doc.kind)).toEqual(['icp', 'registry']);
    const ownerDocIds = owner.stored().workspaces.find(w => w.id === 'semrush').referenceDocs.map(doc => doc.id);
    for (const doc of semrush.referenceDocs) { expect(doc.id).toMatch(/^doc-[0-9a-f-]{36}$/); expect(ownerDocIds).not.toContain(doc.id); expect(doc.updatedAt).toBe('2026-10-09T08:00:00.000Z'); }
    expect(stored.programs.find(p => p.id === 'program-weekly').schedule).toMatchObject({ frequency: 'weekly', time: '07:30', enabled: false, nextRunAt: '', lastRunId: '', lastRunAt: '' });
    expect(stored.programs.map(p => p.id)).not.toContain('program-general');
    expect(stored.workspaces.find(w => w.id === 'general').knowledge).toEqual(content.validateBrandKnowledge({}, { editionId: 'general' }));
    // Nothing is due, however much time passes, until the tester turns a schedule on.
    tester.setTime('2027-01-01T00:00:00Z'); expect(tester.api.checkDueResearchSchedules()).toEqual([]);
    // Importing the same file again updates in place: no duplicate programs or documents.
    const again = tester.api.importSetup({ bundle: file });
    expect(again.summary.changes).toContain('Updates 2 programs.');
    expect(again.warnings).toContain('Importing replaces what “Semrush workspace” has now: 2 products, a taxonomy of 3 categories and 2 reference documents.');
    expect(portable(tester.stored(), 'semrush')).toEqual(testerView);
    expect(tester.stored().programs).toHaveLength(2); expect(tester.stored().workspaces).toHaveLength(2);
  });
  it('re-importing pauses a schedule the tester turned on and keeps this machine’s run history', () => {
    const file = JSON.stringify(configureOwner(harness()).api.exportSetup());
    const tester = harness(); tester.api.importSetup({ bundle: file });
    const live = tester.api.saveResearchProgram({ ...tester.api.publicState().programs.find(p => p.id === 'program-weekly'), schedule: { ...weeklyProgram().schedule, enabled: true } });
    expect(live.schedule.nextRunAt).toBeTruthy();
    const stored = tester.stored();
    Object.assign(stored.programs.find(p => p.id === 'program-weekly').schedule, { lastRunAt: '2026-10-06T11:30:02.000Z', lastRunId: 'research-earlier', lastStatus: 'succeeded', lastScheduledFor: '2026-10-06T11:30:00.000Z' });
    fs.writeFileSync(tester.stateFile, JSON.stringify(stored));
    const restarted = createContentWorkspace(tester.deps); restarted.importSetup({ bundle: file });
    expect(restarted.publicState().programs.find(p => p.id === 'program-weekly').schedule).toMatchObject({ enabled: false, nextRunAt: '', lastRunAt: '2026-10-06T11:30:02.000Z', lastRunId: 'research-earlier', lastStatus: 'succeeded', lastScheduledFor: '2026-10-06T11:30:00.000Z' });
  });
  it('previews counts, schedules and key names without changing anything', () => {
    const owner = configureOwner(harness());
    const file = JSON.stringify(attachSetupSecrets(owner.api.exportSetup({ appVersion: '0.1.0' }), { APIFY_API_TOKEN: TOKEN }), null, 2);
    const tester = harness(); const before = tester.raw();
    const preview = tester.api.previewSetup({ bundle: file });
    expect(tester.raw()).toBe(before); expect(tester.emit).not.toHaveBeenCalled(); expect(tester.api.publicState().activeWorkspaceId).toBe('general');
    expect(JSON.stringify(preview)).not.toContain(TOKEN);
    expect(preview.summary).toMatchObject({
      exportedAt: '2026-10-08T12:00:00.000Z', appVersion: '0.1.0', secrets: ['APIFY_API_TOKEN'], target: { workspaceId: 'semrush', name: 'Semrush workspace', action: 'replace' },
      workspace: { name: 'Semrush workspace', editionId: 'semrush', brandName: 'Semrush', products: { total: 2, enterprise: ['Enterprise AIO'], selfServe: ['SEO Toolkit'], general: [] }, enterpriseProducts: ['Enterprise AIO'], taxonomy: { categories: 3, source: 'Golden Thread.xlsx · Taxonomy Lookup' }, referenceDocs: [{ kind: 'icp', title: 'ICP', characters: 43 }, { kind: 'registry', title: 'Product & Solution Registry', characters: REGISTRY.trim().length }] },
    });
    expect(preview.summary.programs).toEqual([
      expect.objectContaining({ id: 'program-manual', action: 'add', sources: { x: 0, linkedin: 0, reddit: 1 }, schedule: expect.objectContaining({ frequency: 'manual', arrivesPaused: false }) }),
      expect.objectContaining({ id: 'program-weekly', action: 'add', sources: { x: 2, linkedin: 1, reddit: 2 }, targets: { enabled: 5, total: 6 }, budgets: { collectionUsd: 4, aiUsd: 12 }, targetPerPlatform: 500, schedule: expect.objectContaining({ frequency: 'weekly', label: 'Weekly on Tuesday at 07:30 America/New_York', enabledInFile: true, arrivesPaused: true }) }),
    ]);
    expect(preview.summary.changes).toEqual(['Replaces the brand knowledge, product registry, taxonomy and reference documents of “Semrush workspace”.', 'Adds 2 programs.', '1 schedule arrives paused; nothing runs until someone turns it on.']);
    expect(preview.warnings).toEqual(['This file contains APIFY_API_TOKEN. Treat it like a password: anyone with the file can use that key.']);
  });
  it('imports a file that carries a key without storing the key, leaving it for the host', () => {
    const owner = configureOwner(harness());
    const file = JSON.stringify(attachSetupSecrets(owner.api.exportSetup(), { APIFY_API_TOKEN: TOKEN }), null, 2);
    const tester = harness(); const result = tester.api.importSetup({ bundle: file });
    expect(result.summary.secrets).toEqual(['APIFY_API_TOKEN']);
    expect(JSON.stringify(result)).not.toContain(TOKEN); expect(tester.raw()).not.toContain(TOKEN);
    expect(validateSetupBundle(file).secrets).toEqual({ APIFY_API_TOKEN: TOKEN });
  });
  it('rejects malformed, oversized and wrong-kind files with readable errors and changes nothing', () => {
    const bundle = configureOwner(harness()).api.exportSetup();
    const tester = harness(); tester.api.saveResearchProgram({ ...manualProgram({ id: 'program-local', name: 'Local program' }), workspaceId: 'general' }); const before = tester.raw(); tester.emit.mockClear();
    const cases = [
      ['{"kind":"scraper-studio-setup","secrets":{"APIFY_API_TOKEN":"' + TOKEN + '"', /not a readable setup file/],
      [JSON.stringify({ kind: 'apify-scraper-studio-state', version: 1, workspaces: [] }), /not a Scraper Studio setup file/],
      [JSON.stringify({ ...bundle, version: 2 }), /format 2 from a newer Scraper Studio/],
      [JSON.stringify({ ...bundle, padding: 'x'.repeat(SETUP_LIMITS.characters) }), /limited to 25,000,000 characters/],
      [{ ...bundle, workspace: { ...bundle.workspace, referenceDocs: [{ kind: 'icp', title: 'Huge', text: 'x'.repeat(300001) }] } }, /Reference document 1 \(“Huge”\): text must be 300,000 characters or fewer/],
      [{ ...bundle, programs: [{ ...bundle.programs[0], sourceGroups: [{ platform: 'x', targets: ['not a handle!'] }] }] }, /Program 1 \(“Agency pulse”\): Enter a valid subreddit or account handle/],
      [{ ...bundle, secrets: { APIFY_API_TOKEN: 42 } }, /secrets.APIFY_API_TOKEN must be a single-line key/],
    ];
    for (const [input, message] of cases) for (const method of ['previewSetup', 'importSetup']) {
      const error = errorOf(() => tester.api[method]({ bundle: input }));
      expect(error.message).toMatch(message); expect(error.message).not.toContain(TOKEN);
    }
    expect(tester.raw()).toBe(before); expect(tester.emit).not.toHaveBeenCalled();
    // Unknown top-level keys are ignored, not refused.
    expect(tester.api.importSetup({ bundle: { ...bundle, notes: 'from the owner', future: { feature: true } } }).programIds).toEqual(['program-manual', 'program-weekly']);
  });
  it('refuses a program ID that belongs to another workspace instead of moving it', () => {
    const file = JSON.stringify(configureOwner(harness()).api.exportSetup());
    const tester = harness(); tester.api.saveResearchProgram({ ...manualProgram(), workspaceId: 'general' }); const before = tester.raw();
    for (const method of ['previewSetup', 'importSetup']) expect(() => tester.api[method]({ bundle: file })).toThrow('Program “Agency pulse” already belongs to “Your workspace”, so it cannot be imported into “Semrush workspace”. Nothing was imported.');
    expect(tester.raw()).toBe(before);
  });
  it('creates the workspace on an install without that edition and keeps programs it does not replace', () => {
    const file = JSON.stringify(configureOwner(harness()).api.exportSetup());
    const general = { id: 'general', name: 'Your workspace', editionId: 'general', knowledge: content.validateBrandKnowledge({}, { editionId: 'general' }), products: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const tester = harness({ state: { version: 1, activeWorkspaceId: 'general', workspaces: [general], programs: [], researchRuns: [], contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {} } });
    expect(tester.api.previewSetup({ bundle: file }).summary).toMatchObject({ target: { workspaceId: '', name: 'Semrush workspace', action: 'create' }, changes: ['Creates a new workspace, “Semrush workspace”, with this file’s brand knowledge, product registry, taxonomy and reference documents.', 'Adds 2 programs.', '1 schedule arrives paused; nothing runs until someone turns it on.'] });
    const result = tester.api.importSetup({ bundle: file });
    expect(result.workspaceId).toMatch(/^workspace-/);
    expect(tester.stored().workspaces.find(w => w.id === result.workspaceId)).toMatchObject({ name: 'Semrush workspace', editionId: 'semrush', brandDefaults: content.SEMRUSH_BRAND_2026, enterpriseProducts: ['Enterprise AIO'] });
    expect(tester.api.publicState()).toMatchObject({ activeWorkspaceId: result.workspaceId, programs: [expect.objectContaining({ id: 'program-manual' }), expect.objectContaining({ id: 'program-weekly' })] });
    // A program the tester added there survives the next import, which updates the shared ones.
    tester.api.saveResearchProgram({ ...manualProgram({ id: 'program-local', name: 'Local program' }), workspaceId: result.workspaceId });
    const again = tester.api.importSetup({ bundle: file });
    expect(again.workspaceId).toBe(result.workspaceId);
    expect(again.summary.changes).toEqual(['Replaces the brand knowledge, product registry, taxonomy and reference documents of “Semrush workspace”.', 'Updates 2 programs.', 'Keeps 1 other program already in that workspace.', '1 schedule arrives paused; nothing runs until someone turns it on.']);
    expect(tester.api.publicState().programs.map(p => p.id).sort()).toEqual(['program-local', 'program-manual', 'program-weekly']);
  });
  it('exports the selected workspace and only the programs it owns', () => {
    const owner = configureOwner(harness());
    const bundle = owner.api.exportSetup();
    expect(bundle.programs.map(p => p.id)).toEqual(['program-manual', 'program-weekly']);
    expect(bundle.programs.find(p => p.id === 'program-weekly').schedule).toEqual(weeklyProgram().schedule);
    expect(owner.stored().programs.find(p => p.id === 'program-weekly').schedule.nextRunAt).toBeTruthy();
    expect(bundle.workspace).toMatchObject({ editionId: 'semrush', name: 'Semrush workspace', enterpriseProducts: ['Enterprise AIO'] });
    expect(owner.api.exportSetup({ programIds: ['program-weekly'] }).programs.map(p => p.id)).toEqual(['program-weekly']);
    expect(owner.api.exportSetup({ programIds: [] }).programs).toEqual([]);
    expect(() => owner.api.exportSetup({ programIds: ['program-general'] })).toThrow('Record not found in the selected workspace.');
    expect(() => owner.api.exportSetup({ workspaceId: 'general' })).toThrow('Select the workspace that owns this record.');
    expect(() => owner.api.exportSetup({ programIds: 'program-weekly' })).toThrow('Choose up to 50 programs to share.');
    // An unset Enterprise list travels as the edition default it stands for.
    const fresh = harness(); fresh.api.selectContentWorkspace('semrush');
    expect(fresh.api.exportSetup().workspace.enterpriseProducts).toEqual(['Enterprise SEO', 'Enterprise SI (Site Intelligence)', 'Enterprise AIO']);
  });
  it('exports no runs, datasets, assets, themes, detections or delivery records', async () => {
    const h = harness();
    h.api.saveResearchProgram({ id: 'program-a', name: 'Weekly research', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 }, workspaceId: 'general' });
    const run = h.api.startResearchRun({ programId: 'program-a', datasetIds: ['dataset-a'] }); await h.api.waitForIdle();
    h.api.approveResearchThemes({ runId: run.id, themes: h.api.readStudioRun({ runId: run.id }).themes.map(theme => theme.id) }); h.api.continueResearchRun({ runId: run.id }); await h.api.waitForIdle();
    const exported = h.api.exportStudioRun({ runId: run.id }); const stored = h.stored();
    for (const key of ['researchRuns', 'contentRuns', 'themes', 'history', 'detections', 'assets', 'exports']) expect(stored[key].length).toBeGreaterThan(0);
    const bundle = h.api.exportSetup(); const file = JSON.stringify(bundle, null, 2);
    expect(Object.keys(bundle)).toEqual(['kind', 'version', 'exportedAt', 'app', 'workspace', 'programs']);
    expect(bundle).toMatchObject({ exportedAt: '2026-10-08T12:00:00.000Z', app: {}, workspace: { editionId: 'general', name: 'Your workspace', enterpriseProducts: [], taxonomy: null, referenceDocs: [] } });
    expect(bundle.programs.map(program => program.id)).toEqual(['program-a']);
    const recordIds = [run.id, exported.id, 'dataset-a', ...stored.contentRuns.map(row => row.id), ...stored.assets.map(row => row.id), ...stored.themes.map(row => row.id)];
    for (const value of recordIds) expect(file).not.toContain(value);
    expect(file).not.toMatch(/"(researchRuns|contentRuns|themes|detections|assets|exports|datasetOwners|receipts|googleDelivery|workspaceId|updatedAt)"/);
  });
});
