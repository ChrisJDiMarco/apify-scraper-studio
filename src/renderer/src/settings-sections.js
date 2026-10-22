// Settings sections: the one list the left nav, the page order, the status dots and #/settings/<section> links read.
// Pure ESM (no React), so tests and the nav share it.
//
// Adding a section: add an entry here (page order IS this order, grouped under SETTINGS_GROUPS) and a renderer with the
// same id in settings-view.jsx's RENDERERS. `when(ctx)` hides a section (ctx.has says which renderers exist);
// `collapsible` means the section renders as a <details>, which the nav opens when it jumps there; `spot` is the help
// spot (src/shared/help-spots.json) that lives in it.
//
// Monday.com: the section's component is `MondaySettings` from ./monday-settings.jsx (the Monday.com build owns that
// file). settings-view.jsx renders every section component with the common section props ({ state, meta, api, busy,
// role, layout, web, onSaveKey, onClearKey, onSaveSettings }). Its status dot reads state.monday ({ connected, link: {
// boardId, paused, problems, counts } }).
//
// Google Drive: `DriveSettings` from ./drive-settings.jsx (the folder sync: connect, folder, the studio-wide switch, Copy
// existing reports, the sync log). Its status dot reads state.driveSync (src/main/drive-sync.js publicState()).
export const SETTINGS_GROUPS = Object.freeze([
  { id: 'connect', label: 'Collection' },
  { id: 'ai', label: 'AI' },
  { id: 'brand', label: 'Brand' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'studio', label: 'Studio' },
]);

export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'sources', group: 'connect', label: 'Source collection', spot: 'settings.apify' },
  { id: 'ai', group: 'ai', label: 'AI connections', spot: 'settings.ai-connections' },
  { id: 'models', group: 'ai', label: 'Model routing', spot: 'settings.model-routing', when: (c) => Boolean(c.has?.models) },
  // Brand knowledge: the Advanced layout's whole page (Content › Brand knowledge), drawn here in the Simple layout only.
  // App passes its renderer when the layout is Simple and the role may open Brand knowledge (roles.json editBrand).
  { id: 'brand-knowledge', group: 'brand', label: 'Brand knowledge', when: (c) => Boolean(c.has?.brandKnowledge) },
  { id: 'brand-images', group: 'brand', label: 'Brand reference images', spot: 'settings.brand-images', when: (c) => Boolean(c.has?.brandImages) },
  { id: 'google-drive', group: 'integrations', label: 'Google Drive', spot: 'settings.google-drive' },
  { id: 'google-docs', group: 'integrations', label: 'Google Docs', spot: 'settings.google-docs', collapsible: true },
  { id: 'google-sheets', group: 'integrations', label: 'Google Sheets', spot: 'settings.google-sheets', collapsible: true },
  { id: 'monday', group: 'integrations', label: 'Monday.com', spot: 'settings.monday', when: (c) => Boolean(c.has?.monday) },
  { id: 'web-address', group: 'studio', label: 'Studio web address', spot: 'settings.web-address', when: (c) => !c.web },
  { id: 'share', group: 'studio', label: 'Share your setup', spot: 'settings.share', when: (c) => Boolean(c.has?.setupShare) },
  { id: 'diagnostics', group: 'studio', label: 'Connection diagnostics', spot: 'settings.diagnostics', collapsible: true },
  { id: 'details', group: 'studio', label: (c) => (c.web ? 'Studio details' : 'Files & workspace'), collapsible: true },
]);
export const SETTINGS_SECTION_IDS = Object.freeze(SETTINGS_SECTIONS.map((section) => section.id));

// Older names that still open the right section: links and help spots written before AI connections replaced
// "Writing & research" and "Image generation".
export const SECTION_ALIASES = Object.freeze({ writing: 'ai', claude: 'ai', images: 'ai', pictures: 'ai', 'ai-connections': 'ai', routing: 'models', 'model-routing': 'models', brand: 'brand-images', knowledge: 'brand-knowledge', brands: 'brand-knowledge', sheets: 'google-sheets', drive: 'google-drive', 'drive-sync': 'google-drive', docs: 'google-docs', address: 'web-address', setup: 'share' });
export const sectionId = (value) => { const id = String(value || '').trim().toLowerCase(); return SETTINGS_SECTION_IDS.includes(id) ? id : SECTION_ALIASES[id] || ''; };

// A help spot's section (settings.monday → monday), for Show me steps that point into Settings.
export const SPOT_SECTION = Object.freeze({
  ...Object.fromEntries(SETTINGS_SECTIONS.filter((section) => section.spot).map((section) => [section.spot, section.id])),
  'settings.claude': 'ai', 'settings.images': 'ai', 'settings.model-routing.presets': 'models', 'settings.nav': '',
});

const labelOf = (section, ctx) => (typeof section.label === 'function' ? section.label(ctx) : section.label);

// ctx = { state, web, has: { models, brandKnowledge, brandImages, monday, setupShare } } → [{ id, group, label, collapsible }] in page order.
export function visibleSections(ctx = {}) {
  return SETTINGS_SECTIONS.filter((section) => !section.when || section.when(ctx)).map((section) => ({ id: section.id, group: section.group, label: labelOf(section, ctx), collapsible: Boolean(section.collapsible), spot: section.spot || '' }));
}

const AI_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'FAL_KEY'];
const list = (value) => (Array.isArray(value) ? value : []);
const tone = (value, label) => ({ tone: value, label });

// The nav's dot for one section: { tone: 'ready'|'attention'|'problem'|'neutral', label } or null for none. Labels are
// short plain words; the section itself says more.
export function sectionStatus(id, ctx = {}) {
  const state = ctx.state || {}; const keys = state.keys || {}; const problems = state.keyProblems || {}; const settings = state.settings || {};
  if (id === 'sources') {
    if (problems.APIFY_API_TOKEN) return tone('problem', 'Can’t read saved token');
    return keys.APIFY_API_TOKEN ? tone('ready', 'Connected') : tone('attention', 'Not connected');
  }
  if (id === 'ai') {
    if (AI_KEYS.some((name) => problems[name])) return tone('problem', 'Can’t read a saved key');
    const check = settings.lastAiCheck;
    if (check?.ok) return tone('ready', 'Working');
    if (check && !check.ok) return tone('problem', 'Not working');
    return tone('neutral', 'Not checked');
  }
  if (id === 'models') return settings.aiRouting?.updatedAt ? tone('ready', 'Customized') : tone('neutral', 'Defaults');
  if (id === 'brand-knowledge') {
    const studio = state.contentStudio || {};
    const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId);
    const filled = Object.entries(workspace?.knowledge || {}).some(([key, value]) => key !== 'name' && key !== 'editionId' && typeof value === 'string' && value.trim());
    return filled ? tone('ready', 'Saved') : tone('attention', 'Not filled in');
  }
  if (id === 'brand-images') {
    const studio = state.contentStudio || {};
    const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId);
    const count = list(workspace?.brandImageSets).reduce((sum, set) => sum + list(set.images).length, 0);
    return count ? tone('ready', `${count} ${count === 1 ? 'picture' : 'pictures'}`) : tone('neutral', 'Optional');
  }
  if (id === 'google-drive') {
    // state.driveSync: { connected, folder, autoAdd, failed } (drive-sync.js publicState()).
    const drive = state.driveSync || {};
    if (problems.GOOGLE_DRIVE_SERVICE_ACCOUNT) return tone('problem', 'Can’t read saved key');
    if (!drive.connected) return tone('neutral', 'Optional');
    if (!drive.folder) return tone('attention', 'Choose a folder');
    if (Number(drive.failed) > 0) return tone('problem', 'Some files failed');
    return drive.autoAdd ? tone('ready', 'Syncing') : tone('neutral', 'Switch off');
  }
  if (id === 'google-docs') {
    if (problems.GOOGLE_DOCS_ACCESS_TOKEN) return tone('problem', 'Can’t read saved token');
    return keys.GOOGLE_DOCS_ACCESS_TOKEN ? tone('ready', 'Connected') : tone('neutral', 'Optional');
  }
  if (id === 'google-sheets') {
    if (problems.GOOGLE_SHEETS_WEBHOOK_URL) return tone('problem', 'Can’t read saved link');
    if (list(state.sheetRuns).slice(0, 3).some((run) => run?.status === 'failed')) return tone('attention', 'Last run failed');
    return keys.GOOGLE_SHEETS_WEBHOOK_URL ? tone('ready', 'Bridge saved') : tone('neutral', 'Optional');
  }
  if (id === 'monday') {
    // state.monday: { connected, link: { boardId, paused, problems, counts } | null } (older builds: boardId, lastError).
    const monday = state.monday || {}; const link = monday.link || null;
    if (problems.MONDAY_API_TOKEN) return tone('problem', 'Can’t read saved token');
    if (link?.paused) return tone('problem', 'Sync paused');
    if (monday.lastError || Number(link?.counts?.failed) > 0) return tone('problem', 'Sync failed');
    if (list(link?.problems).length) return tone('attention', 'Needs a look');
    if (link?.boardId || monday.boardId) return tone('ready', 'Board linked');
    if (monday.connected || keys.MONDAY_API_TOKEN) return tone('attention', 'Choose a board');
    return tone('neutral', 'Optional');
  }
  if (id === 'web-address') return settings.studioWebAddress ? tone('ready', 'Links on') : tone('neutral', 'Optional');
  if (id === 'diagnostics') return list(state.storeRecovery).length || Object.keys(problems).length ? tone('problem', 'Needs attention') : null;
  return null;
}
