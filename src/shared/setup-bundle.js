// "Share your setup": one JSON file carries a workspace's research knowledge (brand knowledge,
// product registry, taxonomy, reference documents) and its research programs from the owner's Mac
// to a tester's fresh install. Pure: no files, clocks or IDs. Every part is re-checked by the
// validator that guards it inside the app, so a hand-edited file cannot store what the app refuses.
const content = require('./content-studio');
const intel = require('./research-intel');
const research = require('./research-program');
const { DEFAULT_RESEARCH_SCHEDULE } = require('./research-schedule');
const { REFERENCE_DOC_KINDS } = require('./research-reports');

const SETUP_BUNDLE_KIND = 'scraper-studio-setup';
const SETUP_BUNDLE_VERSION = 1;
// Credentials a file may carry for the host to store. Their values never appear in summaries or errors.
const SETUP_SECRET_KEYS = Object.freeze(['APIFY_API_TOKEN']);
// 25M characters holds a full workspace (20 reference documents at the 300,000-character cap plus the
// registry, taxonomy and ~2,000-source programs) while refusing files no setup could need.
const SETUP_LIMITS = Object.freeze({ characters: 25000000, programs: 50, referenceDocs: 20, referenceDocCharacters: 300000, enterpriseProducts: 20, secretCharacters: 512 });
const KNOWLEDGE_META = ['editionId', 'name', 'version'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOO_LARGE = `Setup files are limited to ${SETUP_LIMITS.characters.toLocaleString('en-US')} characters. Share fewer programs or shorter reference documents.`;

function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
function object(value, field, message = `${field} must be an object.`) { if (!isObject(value)) fail(field, message); return value; }
function list(value, field, max) { if (!Array.isArray(value) || value.length > max) fail(field, `${field} must be a list of up to ${max} entries.`); return value; }
function text(value, field, max, required = false) {
  if (value != null && typeof value !== 'string') fail(field, `${field} must be text.`);
  const result = (value || '').trim();
  if (required && !result) fail(field, `${field} is required.`);
  if (result.length > max) fail(field, `${field} must be ${max.toLocaleString('en-US')} characters or fewer.`);
  return result;
}
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
const joinList = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const named = (label, name) => (typeof name === 'string' && name.trim() && name.trim().length <= 160 ? `${label} (“${name.trim()}”)` : label);
// The app's validators name their own fields; say which part of the file they were checking.
function within(label, field, check) {
  try { return check(); } catch (error) { const wrapped = new Error(`${label}: ${error.message}`); wrapped.field = error.field ? `${field}.${error.field}` : field; throw wrapped; }
}

// Hosts pass the file text or a parsed object. Text is measured before parsing, and parser messages
// are dropped because they quote the file, which may hold a key.
function readBundle(input) {
  if (input == null || input === '') fail('bundle', 'Choose a Scraper Studio setup file.');
  let value = input;
  if (typeof input === 'string') {
    if (input.length > SETUP_LIMITS.characters) fail('bundle', TOO_LARGE);
    try { value = JSON.parse(input.replace(/^\uFEFF/, '')); } catch (_) { fail('bundle', 'This file is not a readable setup file. Export it again from Scraper Studio.'); }
  } else if (isObject(input)) {
    let size = Infinity; try { size = JSON.stringify(input).length; } catch (_) { /* Circular or BigInt values: not a file's contents. */ }
    if (size > SETUP_LIMITS.characters) fail('bundle', Number.isFinite(size) ? TOO_LARGE : 'This setup file could not be read.');
  }
  return object(value, 'bundle', 'This is not a Scraper Studio setup file.');
}
function referenceDoc(doc, index) {
  return within(named(`Reference document ${index + 1}`, doc?.title), `workspace.referenceDocs.${index}`, () => {
    object(doc, 'document');
    if (!REFERENCE_DOC_KINDS.includes(doc.kind)) fail('kind', `Choose one of these kinds: ${REFERENCE_DOC_KINDS.join(', ')}.`);
    const source = doc.source == null ? null : object(doc.source, 'source');
    return { kind: doc.kind, title: text(doc.title, 'title', 200, true), text: text(doc.text, 'text', SETUP_LIMITS.referenceDocCharacters, true), source: source && { kind: text(source.kind, 'source.kind', 40), name: text(source.name, 'source.name', 300) } };
  });
}
function setupWorkspace(input) {
  const source = object(input, 'workspace', 'This setup file has no workspace section.');
  const editionId = text(source.editionId, 'workspace.editionId', 40, true);
  if (!content.CONTENT_EDITIONS.some(entry => entry.id === editionId)) fail('workspace.editionId', 'This setup file is for a workspace edition this app does not have. Update Scraper Studio, then import it again.');
  object(source.knowledge, 'workspace.knowledge', 'This setup file has no brand knowledge section.');
  const taxonomy = within('Taxonomy', 'workspace.taxonomy', () => intel.validateTaxonomy(source.taxonomy ?? null));
  return {
    editionId, name: text(source.name, 'workspace.name', 160, true),
    knowledge: within('Brand knowledge', 'workspace.knowledge', () => content.validateBrandKnowledge(source.knowledge, { editionId })),
    products: within('Product registry', 'workspace.products', () => content.validateProductRegistry(source.products ?? [], { editionId })),
    // null keeps the edition default (Semrush: its three Enterprise products), as an unset workspace list does.
    enterpriseProducts: source.enterpriseProducts == null ? null : [...new Set(list(source.enterpriseProducts, 'workspace.enterpriseProducts', SETUP_LIMITS.enterpriseProducts).map((name, index) => text(name, `workspace.enterpriseProducts.${index}`, 160, true)))],
    taxonomy: taxonomy?.categories.length ? taxonomy : null,
    referenceDocs: list(source.referenceDocs ?? [], 'workspace.referenceDocs', SETUP_LIMITS.referenceDocs).map(referenceDoc),
  };
}
function setupPrograms(value) {
  const seen = new Set();
  return list(value ?? [], 'programs', SETUP_LIMITS.programs).map((input, index) => within(named(`Program ${index + 1}`, input?.name), `programs.${index}`, () => {
    const program = research.validateResearchProgram(object(input, 'program'));
    // IDs travel so a re-import updates in place; they must stay usable as studio record IDs.
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(program.id)) fail('id', 'Program IDs may use only letters, numbers, hyphens and underscores.');
    if (seen.has(program.id)) fail('id', 'Another program in this file has the same ID.'); seen.add(program.id);
    // Only the cadence travels; run bookkeeping (nextRunAt, lastRunId…) belongs to the machine that ran it.
    return { ...program, schedule: Object.fromEntries(Object.keys(DEFAULT_RESEARCH_SCHEDULE).map(key => [key, program.schedule[key]])) };
  }));
}
function setupSecrets(input) {
  if (input == null) return undefined;
  const secrets = object(input, 'secrets', 'secrets must name each key, for example { "APIFY_API_TOKEN": "…" }.');
  // Unknown names are refused, not ignored, and never echoed: a misplaced name could itself be a key.
  if (Object.keys(secrets).some(key => !SETUP_SECRET_KEYS.includes(key))) fail('secrets', `A setup file can carry only these keys: ${SETUP_SECRET_KEYS.join(', ')}.`);
  const result = {};
  for (const key of SETUP_SECRET_KEYS) {
    const value = secrets[key];
    if (value == null || (typeof value === 'string' && !value.trim())) continue;
    if (typeof value !== 'string' || value.trim().length > SETUP_LIMITS.secretCharacters || !/^[\x21-\x7e]+$/.test(value.trim())) fail(`secrets.${key}`, `secrets.${key} must be a single-line key of up to ${SETUP_LIMITS.secretCharacters} characters.`);
    result[key] = value.trim();
  }
  return Object.keys(result).length ? result : undefined;
}
// Import: any version-1 file → the normalized bundle (stable key order, unknown keys dropped).
// Throws a readable Error with a `field` path; secrets are returned for the host to store.
function validateSetupBundle(input) {
  const bundle = readBundle(input);
  if (bundle.kind !== SETUP_BUNDLE_KIND) fail('kind', 'This is not a Scraper Studio setup file.');
  if (!Number.isInteger(bundle.version) || bundle.version < 1) fail('version', 'This setup file has no valid format version. Export it again from Scraper Studio.');
  if (bundle.version > SETUP_BUNDLE_VERSION) fail('version', `This setup file uses format ${bundle.version} from a newer Scraper Studio. Update the app, then import it again.`);
  const exportedAt = text(bundle.exportedAt, 'exportedAt', 40);
  if (exportedAt && !Number.isFinite(Date.parse(exportedAt))) fail('exportedAt', 'exportedAt must be a date and time.');
  const appVersion = text((bundle.app == null ? {} : object(bundle.app, 'app')).version, 'app.version', 40);
  const result = { kind: SETUP_BUNDLE_KIND, version: SETUP_BUNDLE_VERSION, exportedAt, app: appVersion ? { version: appVersion } : {}, workspace: setupWorkspace(bundle.workspace), programs: setupPrograms(bundle.programs) };
  const secrets = setupSecrets(bundle.secrets);
  return secrets ? { ...result, secrets } : result;
}
// Export: saved workspace and program records → a version-1 bundle without secrets. Record IDs
// (other than program IDs), timestamps and schedule bookkeeping stay behind, and the result has
// passed the same checks an import runs, so the owner learns about a problem before the testers do.
function buildSetupBundle({ workspace, programs = [], exportedAt = '', appVersion = '' } = {}) {
  object(workspace, 'workspace', 'Choose a workspace to export.');
  if (!Array.isArray(programs) || programs.length > SETUP_LIMITS.programs) fail('programs', `A setup file holds up to ${SETUP_LIMITS.programs} programs. Choose which programs to share.`);
  const bundle = validateSetupBundle({
    kind: SETUP_BUNDLE_KIND, version: SETUP_BUNDLE_VERSION, exportedAt, app: appVersion ? { version: String(appVersion) } : {},
    workspace: { editionId: workspace.editionId, name: workspace.name, knowledge: workspace.knowledge || {}, products: workspace.products || [], enterpriseProducts: workspace.enterpriseProducts ?? null, taxonomy: workspace.taxonomy || null, referenceDocs: (workspace.referenceDocs || []).map(doc => doc && { kind: doc.kind, title: doc.title, text: doc.text, source: doc.source || null }) },
    programs,
  });
  // Name order keeps re-exports of an unchanged setup identical apart from exportedAt.
  bundle.programs.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  return bundle;
}
// The host adds credentials from its own key store after export. Checked here so an export can
// never write a file that import would refuse; secrets stay the last key in the file.
function attachSetupSecrets(bundle, secrets) {
  const { secrets: _previous, ...rest } = object(bundle, 'bundle', 'Export the setup before adding keys.');
  const checked = setupSecrets(secrets);
  return checked ? { ...rest, secrets: checked } : rest;
}
function scheduleLabel({ frequency, time, timeZone, weekday, dayOfMonth }) {
  if (frequency === 'manual') return 'Manual runs only';
  const at = `at ${time} ${timeZone}`;
  return frequency === 'daily' ? `Daily ${at}` : frequency === 'weekly' ? `Weekly on ${WEEKDAYS[weekday]} ${at}` : `Monthly on day ${dayOfMonth} ${at}`;
}
function programSummary(program, action) {
  const enabled = program.sourceGroups.filter(group => group.enabled);
  const count = groups => groups.reduce((sum, group) => sum + group.targets.length, 0);
  const { schedule } = program;
  return {
    id: program.id, name: program.name, query: program.query, ...(action ? { action } : {}),
    sources: Object.fromEntries(research.PLATFORMS.map(platform => [platform, count(enabled.filter(group => group.platform === platform))])),
    targets: { enabled: count(enabled), total: count(program.sourceGroups) }, sourceGroups: { enabled: enabled.length, total: program.sourceGroups.length },
    budgets: { ...program.budgets }, targetPerPlatform: program.targetPerPlatform, autoApproveThemes: program.autoApproveThemes,
    schedule: { frequency: schedule.frequency, time: schedule.time, timeZone: schedule.timeZone, weekday: schedule.weekday, dayOfMonth: schedule.dayOfMonth, label: scheduleLabel(schedule), enabledInFile: schedule.enabled, arrivesPaused: schedule.frequency !== 'manual' },
  };
}
// What a person reviews before importing: names and counts (never secret values). With the import
// target's context it also says what changes on this machine.
// context: { target: { workspaceId?, name, exists, products, taxonomyCategories, referenceDocs }, programActions: { [programId]: 'add'|'update' }, keptPrograms }
function summarizeSetupBundle(input, { target, programActions = {}, keptPrograms = 0 } = {}) {
  const bundle = validateSetupBundle(input); const { workspace } = bundle;
  const names = segment => workspace.products.filter(product => product.segment === segment).map(product => product.name);
  const programs = bundle.programs.map(program => programSummary(program, programActions[program.id]));
  const secrets = Object.keys(bundle.secrets || {});
  const summary = {
    exportedAt: bundle.exportedAt, appVersion: bundle.app.version || '',
    workspace: {
      name: workspace.name, editionId: workspace.editionId, editionLabel: content.CONTENT_EDITIONS.find(entry => entry.id === workspace.editionId).label,
      brandName: workspace.knowledge.name, knowledgeFields: Object.keys(workspace.knowledge).filter(key => !KNOWLEDGE_META.includes(key) && workspace.knowledge[key]),
      products: { total: workspace.products.length, enterprise: names('enterprise'), selfServe: names('self-serve'), general: names('general') },
      enterpriseProducts: workspace.enterpriseProducts,
      taxonomy: workspace.taxonomy && { categories: workspace.taxonomy.categories.length, source: workspace.taxonomy.source?.name || '' },
      referenceDocs: workspace.referenceDocs.map(doc => ({ kind: doc.kind, title: doc.title, characters: doc.text.length })),
    },
    programs, secrets,
    ...(target ? { target: { workspaceId: target.workspaceId || '', name: target.name, action: target.exists ? 'replace' : 'create' } } : {}),
    changes: [],
  };
  const parts = 'brand knowledge, product registry, taxonomy and reference documents';
  if (target) summary.changes.push(target.exists ? `Replaces the ${parts} of “${target.name}”.` : `Creates a new workspace, “${target.name}”, with this file’s ${parts}.`);
  const [added, updated] = ['add', 'update'].map(action => programs.filter(program => program.action === action).length);
  const programChange = [added && `adds ${plural(added, 'program')}`, updated && `updates ${plural(updated, 'program')}`].filter(Boolean).join(' and ');
  if (programChange) summary.changes.push(`${programChange[0].toUpperCase()}${programChange.slice(1)}.`);
  if (keptPrograms) summary.changes.push(`Keeps ${plural(keptPrograms, 'other program')} already in that workspace.`);
  const paused = programs.filter(program => program.schedule.arrivesPaused).length;
  if (paused) summary.changes.push(`${paused === 1 ? '1 schedule arrives' : `${paused} schedules arrive`} paused; nothing runs until someone turns ${paused === 1 ? 'it' : 'them'} on.`);
  const warnings = [];
  if (target?.exists) {
    const existing = [target.products && plural(target.products, 'product'), target.taxonomyCategories && `a taxonomy of ${plural(target.taxonomyCategories, 'category', 'categories')}`, target.referenceDocs && plural(target.referenceDocs, 'reference document')].filter(Boolean);
    if (existing.length) warnings.push(`Importing replaces what “${target.name}” has now: ${joinList(existing)}.`);
  }
  for (const program of programs) if (program.autoApproveThemes) warnings.push(`“${program.name}” approves themes automatically, so a run continues to tagging and reports without stopping for review, spending up to its $${program.budgets.aiUsd.toFixed(2)} AI budget.`);
  if (secrets.length) warnings.push(`This file contains ${joinList(secrets)}. Treat it like a password: anyone with the file can use ${secrets.length === 1 ? 'that key' : 'those keys'}.`);
  return { summary, warnings };
}

module.exports = { SETUP_BUNDLE_KIND, SETUP_BUNDLE_VERSION, SETUP_SECRET_KEYS, SETUP_LIMITS, buildSetupBundle, validateSetupBundle, summarizeSetupBundle, attachSetupSecrets };
