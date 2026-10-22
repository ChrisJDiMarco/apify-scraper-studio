import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SECTION_IDS, SPOT_SECTION, sectionId, sectionStatus, visibleSections } from '../src/renderer/src/settings-sections.js';

// The Settings section list: page order, which sections show, and the nav's status dot for each.
const ALL = { models: true, brandKnowledge: true, brandImages: true, monday: true, setupShare: true };
const ctx = (state = {}, extra = {}) => ({ state, web: false, has: ALL, ...extra });

describe('Settings sections', () => {
  it('lists unique sections in group order, each in a known group', () => {
    expect(new Set(SETTINGS_SECTION_IDS).size).toBe(SETTINGS_SECTION_IDS.length);
    const groups = SETTINGS_GROUPS.map((group) => group.id);
    const order = SETTINGS_SECTIONS.map((section) => groups.indexOf(section.group));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(SETTINGS_SECTION_IDS.indexOf('monday')).toBeGreaterThan(SETTINGS_SECTION_IDS.indexOf('google-sheets'));
  });

  it('hides sections that have nothing to show here', () => {
    expect(visibleSections(ctx()).map((section) => section.id)).toEqual(SETTINGS_SECTION_IDS);
    const web = visibleSections(ctx({}, { web: true }));
    expect(web.map((section) => section.id)).not.toContain('web-address');
    expect(web.find((section) => section.id === 'details').label).toBe('Studio details');
    expect(visibleSections(ctx()).find((section) => section.id === 'details').label).toBe('Files & workspace');
    const bare = visibleSections(ctx({}, { has: {} })).map((section) => section.id);
    for (const id of ['models', 'brand-knowledge', 'brand-images', 'monday', 'share']) expect(bare).not.toContain(id);
    expect(visibleSections(ctx()).find((section) => section.id === 'google-docs').collapsible).toBe(true);
  });

  it('puts Brand knowledge first under Brand, opened by its Advanced names too, with a dot for an empty one', () => {
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'brand-knowledge')).toMatchObject({ group: 'brand', label: 'Brand knowledge' });
    expect(SETTINGS_SECTION_IDS.indexOf('brand-knowledge')).toBe(SETTINGS_SECTION_IDS.indexOf('brand-images') - 1);
    expect(sectionId('knowledge')).toBe('brand-knowledge');
    expect(sectionId('brands')).toBe('brand-knowledge');
    expect(sectionId('brand')).toBe('brand-images'); // older links keep their section
    const studio = (knowledge) => ({ contentStudio: { activeWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'Main', editionId: 'semrush', knowledge }] } });
    expect(sectionStatus('brand-knowledge', ctx(studio({ name: 'Main', editionId: 'semrush', voice: '' })))).toEqual({ tone: 'attention', label: 'Not filled in' });
    expect(sectionStatus('brand-knowledge', ctx(studio({ name: 'Main', voice: 'Plain and direct.' })))).toEqual({ tone: 'ready', label: 'Saved' });
    expect(sectionStatus('brand-knowledge', ctx())).toEqual({ tone: 'attention', label: 'Not filled in' });
  });

  it('maps old names and help spots to sections', () => {
    expect(sectionId('images')).toBe('ai');
    expect(sectionId('Monday')).toBe('monday');
    expect(sectionId('nowhere')).toBe('');
    expect(SPOT_SECTION['settings.apify']).toBe('sources');
    expect(SPOT_SECTION['settings.images']).toBe('ai');
    expect(SPOT_SECTION['settings.model-routing']).toBe('models');
  });

  it('gives Source collection a dot for each state', () => {
    expect(sectionStatus('sources', ctx({ keys: {} }))).toEqual({ tone: 'attention', label: 'Not connected' });
    expect(sectionStatus('sources', ctx({ keys: { APIFY_API_TOKEN: true } }))).toEqual({ tone: 'ready', label: 'Connected' });
    expect(sectionStatus('sources', ctx({ keys: { APIFY_API_TOKEN: true }, keyProblems: { APIFY_API_TOKEN: 'mismatch' } })).tone).toBe('problem');
  });

  it('reads AI connections from the last check and unreadable keys', () => {
    expect(sectionStatus('ai', ctx({ settings: {} }))).toEqual({ tone: 'neutral', label: 'Not checked' });
    expect(sectionStatus('ai', ctx({ settings: { lastAiCheck: { ok: true, provider: 'auto' } } }))).toEqual({ tone: 'ready', label: 'Working' });
    expect(sectionStatus('ai', ctx({ settings: { lastAiCheck: { ok: false, provider: 'claude' } } }))).toEqual({ tone: 'problem', label: 'Not working' });
    expect(sectionStatus('ai', ctx({ settings: { lastAiCheck: { ok: true } }, keyProblems: { OPENROUTER_API_KEY: 'foreign' } })).tone).toBe('problem');
  });

  it('marks Monday.com, Google Sheets, brand images and the web address', () => {
    expect(sectionStatus('monday', ctx({ monday: {} }))).toEqual({ tone: 'neutral', label: 'Optional' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true } }))).toEqual({ tone: 'attention', label: 'Choose a board' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true, boardId: '123' } }))).toEqual({ tone: 'ready', label: 'Board linked' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true, boardId: '123', lastError: 'Board not found' } }))).toEqual({ tone: 'problem', label: 'Sync failed' });
    // The two-way sync's shape: a linked board, its problems, failed items and a pause.
    expect(sectionStatus('monday', ctx({ monday: { connected: true, link: { boardId: '9', problems: [], counts: { failed: 0 } } } }))).toEqual({ tone: 'ready', label: 'Board linked' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true, link: { boardId: '9', problems: ['The Owner column is gone.'], counts: {} } } }))).toEqual({ tone: 'attention', label: 'Needs a look' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true, link: { boardId: '9', problems: [], counts: { failed: 2 } } } }))).toEqual({ tone: 'problem', label: 'Sync failed' });
    expect(sectionStatus('monday', ctx({ monday: { connected: true, link: { boardId: '9', paused: { at: '2026-10-17' }, counts: {} } } }))).toEqual({ tone: 'problem', label: 'Sync paused' });
    expect(sectionStatus('google-sheets', ctx({ keys: { GOOGLE_SHEETS_WEBHOOK_URL: true }, sheetRuns: [{ status: 'failed' }] }))).toEqual({ tone: 'attention', label: 'Last run failed' });
    expect(sectionStatus('google-sheets', ctx({ keys: { GOOGLE_SHEETS_WEBHOOK_URL: true }, sheetRuns: [] }))).toEqual({ tone: 'ready', label: 'Bridge saved' });
    const studio = { activeWorkspaceId: 'w', workspaces: [{ id: 'w', brandImageSets: [{ images: [{}, {}] }, { images: [{}] }] }] };
    expect(sectionStatus('brand-images', ctx({ contentStudio: studio }))).toEqual({ tone: 'ready', label: '3 pictures' });
    expect(sectionStatus('web-address', ctx({ settings: { studioWebAddress: 'https://studio.example.com' } }))).toEqual({ tone: 'ready', label: 'Links on' });
  });

  it('flags diagnostics only when a key or data file needs attention', () => {
    expect(sectionStatus('diagnostics', ctx({}))).toBeNull();
    expect(sectionStatus('diagnostics', ctx({ keyProblems: { APIFY_API_TOKEN: 'mismatch' } }))).toEqual({ tone: 'problem', label: 'Needs attention' });
    expect(sectionStatus('diagnostics', ctx({ storeRecovery: [{ store: 'Settings', file: 'config.json', kept: 'config.json.bad-1' }] })).tone).toBe('problem');
    expect(sectionStatus('share', ctx({}))).toBeNull();
  });
});
