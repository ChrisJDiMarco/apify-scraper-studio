'use strict';
// Workflows and playbooks: the pure rules (SPEC-3 wave 3B). CommonJS, main-process only (src/main/workflow-engine.js);
// the renderer mirrors the grammar in src/renderer/src/workflow-model.js for instant feedback, and the server decides.
// A workflow is a trigger, then an ordered list of typed steps (src/shared/workflow-steps.json), plus a budget, run
// history and a status. Nothing here calls a provider, reads a file or keeps a timer.
const crypto = require('crypto');
const CATALOG = require('./workflow-steps.json');
const { validateResearchSchedule, nextResearchScheduleAt, latestResearchScheduleAt } = require('./research-schedule');

const LIMITS = CATALOG.limits;
const STEP_KINDS = Object.keys(CATALOG.steps);
const MOMENTUM = Object.keys(CATALOG.momentum);
const PRIORITY = Object.keys(CATALOG.priority);
const VELOCITY = Object.keys(CATALOG.velocity);
const AUDIENCES = Object.keys(CATALOG.audiences);
// The program a playbook makes, before it is saved: setup replaces this id with the saved program's own.
const NEW_PROGRAM_ID = 'program-new';
const DAY_MS = 86400000;

const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fail = (field, message) => { throw Object.assign(new Error(message), { field, status: 400 }); };
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim();
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
// Text that looks like a key or token never goes into a prompt or a saved note.
const SECRET_SHAPE = /(?:sk-[a-z0-9_-]{12,}|apify_api_[a-z0-9]{8,}|xox[abpr]-[a-z0-9-]{8,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.)/i;
function notesText(value, field, max = LIMITS.notesChars) {
  const text = longText(value, max);
  if (text.length > max) fail(field, `Keep these notes under ${max} characters.`);
  if (SECRET_SHAPE.test(text)) fail(field, 'These notes look like they contain a password, key or token. Remove it and save again.');
  return text;
}
function pickList(value, allowed, field, label) {
  const values = [...new Set(list(value).map((entry) => String(entry)))];
  if (values.some((entry) => !allowed.includes(entry))) fail(field, `Choose ${label} from the list.`);
  return allowed.filter((entry) => values.includes(entry));
}
function int(value, min, max, field, fallback) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(field, `Choose a whole number from ${min} to ${max}.`);
  return number;
}
const stable = (value) => (Array.isArray(value) ? value.map(stable) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value);
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

// ---------- Time ----------
// The instant a wall-clock time on a day falls at in a time zone (daylight-saving edges land within the hour).
function zonedWall(day, time, timeZone) {
  const guess = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(guess)) return NaN;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return guess - (wall - guess);
}
// "2026-10" for an instant in a time zone: the month a run's spend counts toward.
function monthKey(at, timeZone = 'UTC') {
  const date = new Date(at); if (!Number.isFinite(date.getTime())) return '';
  let zone = timeZone; try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0); } catch (_) { zone = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}
const dayAdd = (day, days) => { const ms = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(ms) ? new Date(ms + days * DAY_MS).toISOString().slice(0, 10) : ''; };

// ---------- Trigger ----------
function validateTrigger(input, { now = new Date() } = {}) {
  if (!isObject(input)) fail('trigger', 'Choose when this workflow runs.');
  const kind = String(input.kind || '');
  if (kind === 'manual') return { kind };
  if (kind === 'program-run') {
    const programId = clean(input.programId, 180);
    if (!programId) fail('trigger.programId', 'Choose the program whose runs start this workflow.');
    return { kind, programId };
  }
  if (kind !== 'schedule') fail('trigger.kind', 'Choose a schedule, “whenever a program runs”, or only when someone starts it.');
  const raw = isObject(input.schedule) ? input.schedule : {};
  const frequency = String(raw.frequency || '');
  if (!['daily', 'weekly', 'monthly', 'hourly'].includes(frequency)) fail('trigger.schedule.frequency', 'Choose every few hours, daily, weekly or monthly.');
  let base;
  try { base = validateResearchSchedule({ frequency: frequency === 'hourly' ? 'daily' : frequency, enabled: true, time: raw.time || '09:00', timeZone: raw.timeZone || 'UTC', weekday: raw.weekday ?? 1, dayOfMonth: raw.dayOfMonth ?? 1, lookbackDays: 7 }); }
  catch (error) { fail(`trigger.${error.field || 'schedule'}`, error.message); }
  const schedule = { frequency, time: base.time, timeZone: base.timeZone, weekday: base.weekday, dayOfMonth: base.dayOfMonth };
  if (frequency === 'hourly') {
    const everyHours = Number(raw.everyHours);
    if (!LIMITS.everyHours.includes(everyHours)) fail('trigger.schedule.everyHours', `Choose every ${LIMITS.everyHours.join(', ')} hours.`);
    const until = String(raw.until || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(Date.parse(`${until}T00:00:00Z`))) fail('trigger.schedule.until', 'Choose the last day it runs.');
    const today = new Date(now).toISOString().slice(0, 10);
    if (until < today) fail('trigger.schedule.until', 'The last day has already passed. Choose a later day.');
    if (until > dayAdd(today, LIMITS.untilDays)) fail('trigger.schedule.until', `Runs every few hours can last up to ${LIMITS.untilDays} days. Choose an earlier last day.`);
    Object.assign(schedule, { everyHours, until });
  }
  return { kind, schedule };
}

// When a trigger next fires after `from` ('' for manual and program-run triggers, and after an hourly trigger's last day).
function nextTriggerAt(trigger, { from = new Date().toISOString() } = {}) {
  if (trigger?.kind !== 'schedule' || !isObject(trigger.schedule)) return '';
  const s = trigger.schedule;
  if (s.frequency !== 'hourly') return nextResearchScheduleAt({ frequency: s.frequency, enabled: true, time: s.time, timeZone: s.timeZone, weekday: s.weekday, dayOfMonth: s.dayOfMonth, lookbackDays: 7 }, { from });
  const daily = { frequency: 'daily', enabled: true, time: s.time, timeZone: s.timeZone, weekday: 1, dayOfMonth: 1, lookbackDays: 7 };
  const after = Date.parse(from);
  const anchor = Date.parse(latestResearchScheduleAt(daily, { at: from }) || from);
  const step = s.everyHours * 3600000;
  const next = anchor + (Math.floor((after - anchor) / step) + 1) * step;
  const end = zonedWall(s.until, '23:59', s.timeZone);
  return Number.isFinite(end) && next > end ? '' : new Date(next).toISOString();
}

// About how many runs a month a trigger makes: { min, max }, or null when nobody can say (manual, or a program without a
// schedule of its own).
function runsPerMonth(trigger, programs = [], { now = new Date() } = {}) {
  const cadence = (frequency) => ({ daily: { min: 28, max: 31 }, weekly: { min: 4, max: 5 }, monthly: { min: 1, max: 1 } })[frequency] || null;
  if (trigger?.kind === 'schedule') {
    const s = trigger.schedule || {};
    if (s.frequency !== 'hourly') return cadence(s.frequency);
    const days = Math.max(1, Math.min(31, Math.round((Date.parse(`${s.until}T23:59:00Z`) - new Date(now).getTime()) / DAY_MS)));
    const runs = Math.ceil(days * (24 / s.everyHours));
    return { min: runs, max: runs };
  }
  if (trigger?.kind === 'program-run') {
    const program = list(programs).find((row) => row?.id === trigger.programId);
    return program?.schedule?.enabled ? cadence(program.schedule.frequency) : null;
  }
  return null;
}

// ---------- Steps ----------
function validateRule(input, index) {
  if (!isObject(input)) fail(`rules.${index}`, 'Each rule needs at least one condition.');
  const rule = {};
  const momentum = pickList(input.momentum, MOMENTUM, `rules.${index}.momentum`, 'momentum'); if (momentum.length) rule.momentum = momentum;
  const priority = pickList(input.priority, PRIORITY, `rules.${index}.priority`, 'priority'); if (priority.length) rule.priority = priority;
  const velocity = pickList(input.velocity, VELOCITY, `rules.${index}.velocity`, 'velocity'); if (velocity.length) rule.velocity = velocity;
  if (input.minPosts !== undefined && input.minPosts !== null && input.minPosts !== '') rule.minPosts = int(input.minPosts, 1, 100000, `rules.${index}.minPosts`);
  if (input.minPlatforms !== undefined && input.minPlatforms !== null && input.minPlatforms !== '') rule.minPlatforms = int(input.minPlatforms, 1, 3, `rules.${index}.minPlatforms`);
  if (!Object.keys(rule).length) fail(`rules.${index}`, 'Each rule needs at least one condition: momentum, priority, speed, posts or platforms.');
  return rule;
}
function channelsOf(value, kitFolderIds, field, { min = 0 } = {}) {
  const values = [...new Set(list(value).map(String))];
  if (values.some((entry) => !kitFolderIds.includes(entry))) fail(field, 'Choose channels from this workspace.');
  if (values.length < min) fail(field, 'Choose at least one channel.');
  if (values.length > LIMITS.channels) fail(field, `Choose up to ${LIMITS.channels} channels.`);
  return kitFolderIds.filter((entry) => values.includes(entry));
}
function validateStep(input, index, { kitFolderIds }) {
  if (!isObject(input) || !STEP_KINDS.includes(input.kind)) fail(`steps.${index}.kind`, 'Choose what this step does.');
  const id = /^step-\d{1,3}$/.test(String(input.id || '')) ? input.id : '';
  const field = (name) => `steps.${index}.${name}`;
  switch (input.kind) {
    case 'research': return { id, kind: 'research', programId: clean(input.programId, 180) };
    case 'quick-scan': {
      const scan = isObject(input.scan) ? input.scan : {};
      const topic = clean(scan.topic, 200); if (!topic) fail(field('scan.topic'), 'Name a topic to scan for.');
      const depth = ['lite', 'standard', 'deep'].includes(scan.depth) ? scan.depth : 'lite';
      const platforms = pickList(scan.platforms, ['x', 'linkedin', 'reddit'], field('scan.platforms'), 'platforms');
      const lookbackHours = int(scan.lookbackHours, 1, 168, field('scan.lookbackHours'), depth === 'deep' ? 72 : depth === 'standard' ? 24 : 12);
      return { id, kind: 'quick-scan', programId: clean(input.programId, 180), scan: { topic, depth, platforms, lookbackHours } };
    }
    case 'approve': {
      const mode = ['rules', 'review', 'all'].includes(input.mode) ? input.mode : 'review';
      const rules = list(input.rules);
      if (rules.length > LIMITS.rules) fail(field('rules'), `Use up to ${LIMITS.rules} rules.`);
      const step = {
        id, kind: 'approve', mode, rules: mode === 'rules' ? rules.map(validateRule) : [],
        maxApprove: int(input.maxApprove, LIMITS.maxApprove[0], LIMITS.maxApprove[1], field('maxApprove'), 3),
        otherwise: input.otherwise === 'skip' ? 'skip' : 'review',
        waitHours: int(input.waitHours, LIMITS.waitHours[0], LIMITS.waitHours[1], field('waitHours'), LIMITS.defaultWaitHours),
        afterWait: input.afterWait === 'stop' ? 'stop' : 'continue',
        channels: channelsOf(input.channels, kitFolderIds, field('channels')),
        note: clean(input.note, LIMITS.noteChars),
      };
      if (mode === 'rules' && !step.rules.length) fail(field('rules'), 'Add at least one rule, or choose to wait for someone’s OK.');
      return step;
    }
    case 'reports': return { id, kind: 'reports' };
    case 'assets': return { id, kind: 'assets', channels: channelsOf(input.channels, kitFolderIds, field('channels'), { min: 1 }), pictures: input.pictures !== false, teamNotes: notesText(input.teamNotes, field('teamNotes')) };
    case 'monday': return { id, kind: 'monday', alsoAtReview: input.alsoAtReview === true };
    case 'notify': {
      const audience = pickList(input.audience, AUDIENCES, field('audience'), 'who to tell');
      return { id, kind: 'notify', audience: audience.length ? audience : ['admin', 'editor'], slackSummary: input.slackSummary === true };
    }
    default: return fail(field('kind'), 'Choose what this step does.');
  }
}
// The step kinds that may follow the source step, in order (each at most once).
function allowedAfter(source) { return source === 'quick-scan' ? CATALOG.afterQuickScan : source === 'research' ? CATALOG.afterResearch : []; }
function checkGrammar(steps) {
  if (!steps.length) fail('steps', 'Add the first step: find trends or run a quick scan.');
  if (steps.length > LIMITS.steps) fail('steps', `Use up to ${LIMITS.steps} steps.`);
  const source = steps[0].kind;
  if (!CATALOG.steps[source]?.source) fail('steps.0.kind', 'The first step finds trends or runs a quick scan.');
  if (steps.slice(1).some((step) => CATALOG.steps[step.kind]?.source)) fail('steps', 'A workflow has one research step, at the start.');
  const order = allowedAfter(source); let last = -1;
  steps.slice(1).forEach((step, offset) => {
    const at = order.indexOf(step.kind);
    if (at < 0) fail(`steps.${offset + 1}.kind`, source === 'quick-scan' ? 'After a quick scan the only step is telling the team. Quick scan trends never reach the Trend board or Monday.com.' : `“${CATALOG.steps[step.kind].label}” can’t go here.`);
    if (at <= last) fail(`steps.${offset + 1}.kind`, `“${CATALOG.steps[step.kind].label}” is in the wrong place. The order is: approve trends, write reports, make channel assets, update Monday.com, tell the team.`);
    last = at;
  });
  const kinds = steps.map((step) => step.kind);
  if (source === 'research' && kinds[1] !== 'approve') fail('steps.1.kind', 'After finding trends, add “Approve trends”: by rules, by waiting for someone’s OK, or every trend.');
  if (kinds.includes('assets') && !kinds.includes('reports')) fail('steps', 'Channel assets are made from reports. Add “Write reports” before them.');
  return source;
}

// The workflow as the server keeps it (name, description, trigger, steps) plus warnings. `programs` are the workspace's
// programs (a playbook preview adds its unsaved draft as NEW_PROGRAM_ID). Throws an Error with `.field` on the first problem.
function validateWorkflow(input, { programs = [], editionId = 'general', kitFolderIds = [], mondayConnected = false, imagesReady = false, now = new Date() } = {}) {
  if (!isObject(input)) fail('workflow', 'Describe the workflow.');
  const name = clean(input.name, LIMITS.nameChars + 1);
  if (!name) fail('name', 'Name this workflow.');
  if (name.length > LIMITS.nameChars) fail('name', `Keep the name under ${LIMITS.nameChars} characters.`);
  const description = clean(input.description, LIMITS.descriptionChars + 1);
  if (description.length > LIMITS.descriptionChars) fail('description', `Keep the description under ${LIMITS.descriptionChars} characters.`);
  const trigger = validateTrigger(input.trigger, { now });
  const rawSteps = list(input.steps);
  if (rawSteps.length > LIMITS.steps) fail('steps', `Use up to ${LIMITS.steps} steps.`);
  const steps = rawSteps.map((step, index) => validateStep(step, index, { kitFolderIds }));
  const source = checkGrammar(steps);
  // Step ids stay as saved (run history points at them); new steps take the next free number.
  const taken = new Set(steps.map((step) => step.id).filter(Boolean)); const seen = new Set();
  for (const step of steps) {
    if (step.id && !seen.has(step.id)) { seen.add(step.id); continue; }
    let n = 1; while (seen.has(`step-${n}`) || taken.has(`step-${n}`)) n++;
    step.id = `step-${n}`; seen.add(step.id); taken.add(step.id);
  }
  const programId = steps[0].programId;
  const program = list(programs).find((row) => row?.id === programId);
  if (!programId || !program) fail('steps.0.programId', source === 'quick-scan' ? 'Choose the program whose accounts the quick scan reads.' : 'Choose a research program.');
  if (trigger.kind === 'program-run' && (source !== 'research' || trigger.programId !== programId)) fail('trigger.programId', 'A workflow that starts when a program runs finds trends with that same program.');
  if (trigger.kind === 'schedule' && trigger.schedule.frequency === 'hourly' && source !== 'quick-scan') fail('trigger.schedule.frequency', 'Only quick scans can run every few hours. Choose daily, weekly or monthly for research.');
  if (trigger.kind === 'schedule' && source === 'research' && program.schedule?.enabled && program.schedule.frequency !== 'manual') fail('trigger', `“${program.name}” already runs on its own schedule. Turn that off in the program, or choose “Whenever “${program.name}” runs”.`);
  const approve = steps.find((step) => step.kind === 'approve');
  if (approve && program.autoApproveThemes && approve.mode !== 'all') fail(`steps.${steps.indexOf(approve)}.mode`, 'This program approves every trend itself. Turn that off in the program to use rules.');
  const warnings = [];
  if (steps.some((step) => step.kind === 'monday') && !mondayConnected) warnings.push('Monday.com isn’t connected, so “Update Monday.com” will be skipped until it is.');
  if (steps.some((step) => step.kind === 'assets' && step.pictures) && !imagesReady) warnings.push('Pictures are off for your team, so channel assets are made without them.');
  if (trigger.kind === 'program-run' && !program.schedule?.enabled) warnings.push(`“${program.name}” has no schedule of its own, so this runs only when someone starts the program.`);
  void editionId;
  return { workflow: { name, description, trigger, steps }, warnings };
}

// ---------- Budget ----------
// A hash of everything that changes what a run may spend: the research program's caps, models and size, the quick scan,
// how many trends may be approved, the channels and pictures, and how often it runs. Notes, Monday.com, telling the team
// and the time of day don't change it, so editing those keeps the approved budget.
function budgetHash(workflow, programsById = {}) {
  const lookup = (programId) => (programsById instanceof Map ? programsById.get(programId) : programsById?.[programId]) || null;
  const trigger = workflow?.trigger || {};
  const cadence = trigger.kind === 'schedule' ? { kind: 'schedule', frequency: trigger.schedule?.frequency || '', everyHours: trigger.schedule?.everyHours || 0, until: trigger.schedule?.until || '' } : { kind: trigger.kind || '', programId: trigger.programId || '' };
  const paid = list(workflow?.steps).map((step) => {
    if (step.kind === 'research') {
      const program = lookup(step.programId) || {};
      return { kind: 'research', programId: step.programId, budgets: program.budgets || null, models: program.ai?.models || null, effort: program.ai?.effort || null, overrides: program.ai?.overrides || null, maxThemes: program.maxThemes || 0, autoApprove: Boolean(program.autoApproveThemes), targets: list(program.sourceGroups).filter((group) => group?.enabled !== false).reduce((sum, group) => sum + list(group.targets).length, 0) };
    }
    if (step.kind === 'quick-scan') return { kind: 'quick-scan', programId: step.programId, scan: step.scan || null };
    if (step.kind === 'approve') return { kind: 'approve', mode: step.mode, maxApprove: step.maxApprove };
    if (step.kind === 'reports') return { kind: 'reports' };
    if (step.kind === 'assets') return { kind: 'assets', channels: [...list(step.channels)].sort(), pictures: Boolean(step.pictures) };
    return null;
  }).filter(Boolean);
  return sha({ cadence, paid });
}

// ---------- Approval rules ----------
const labelOf = (table, value) => table[value] || '';
function ruleMatches(rule, signal) {
  if (rule.momentum && !rule.momentum.includes(signal.momentum)) return false;
  if (rule.priority && !rule.priority.includes(signal.priorityTier)) return false;
  if (rule.velocity && !rule.velocity.includes(signal.velocity)) return false;
  if (rule.minPosts && !(Number(signal.posts) >= rule.minPosts)) return false;
  if (rule.minPlatforms && !(list(signal.platforms).length >= rule.minPlatforms)) return false;
  return true;
}
function reasonFor(rule, signal) {
  const parts = [];
  if (rule.momentum) parts.push(labelOf(CATALOG.momentum, signal.momentum));
  if (rule.velocity) parts.push(labelOf(CATALOG.velocity, signal.velocity));
  if (rule.priority) parts.push(labelOf(CATALOG.priority, signal.priorityTier));
  if (rule.minPosts) parts.push(`${Number(signal.posts) || 0} posts`);
  if (rule.minPlatforms) parts.push(`${list(signal.platforms).length} platforms`);
  return parts.filter(Boolean).join(' · ') || 'Met the rules';
}
// The trends an approve step says yes to: never one a person already decided; fields inside one rule are ANDed and the
// rules are ORed; strongest first (priority score), at most maxApprove. Mode 'all' takes every undecided trend.
function selectByRules(themes, signals = {}, approve = {}, decided = []) {
  const people = new Set(decided instanceof Set ? [...decided] : list(decided));
  const open = list(themes).filter((theme) => theme?.id && !people.has(theme.id));
  const signalOf = (theme) => ({ name: theme.name, ...(isObject(signals[theme.id]) ? signals[theme.id] : {}) });
  const matched = [];
  for (const theme of open) {
    const signal = signalOf(theme);
    if (approve.mode === 'all') { matched.push({ theme, signal, reason: 'Every trend' }); continue; }
    const rule = list(approve.rules).find((entry) => ruleMatches(entry, signal));
    if (rule) matched.push({ theme, signal, reason: reasonFor(rule, signal) });
  }
  matched.sort((a, b) => (Number(b.signal.priorityScore) || 0) - (Number(a.signal.priorityScore) || 0) || String(a.theme.name || '').localeCompare(String(b.theme.name || '')));
  const cap = approve.mode === 'all' ? matched.length : Math.max(0, Number(approve.maxApprove) || 0);
  const approved = matched.slice(0, cap).map(({ theme, reason }) => ({ themeId: theme.id, name: theme.name || '', reason }));
  const taken = new Set(approved.map((row) => row.themeId));
  return { approved, rest: open.filter((theme) => !taken.has(theme.id)).map((theme) => theme.id) };
}

// ---------- Playbooks ----------
// Accounts typed in a playbook: "@handle", "r/community", LinkedIn profile or company URLs, X or Reddit URLs; one per
// line or comma. → source groups for a research program (empty platforms left out).
function parseAccounts(text) {
  const tokens = String(text || '').split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean).slice(0, 300);
  const groups = { x: [], reddit: [], 'linkedin-profile': [] };
  for (const token of tokens) {
    if (/linkedin\.com\//i.test(token)) groups['linkedin-profile'].push(token.replace(/^(?!https?:)/i, 'https://'));
    else if (/^\/?r\//i.test(token) || /reddit\.com\/r\//i.test(token)) groups.reddit.push(token);
    else groups.x.push(token);
  }
  return Object.entries(groups).filter(([, targets]) => targets.length).map(([sourceId, targets]) => ({ sourceId, platform: sourceId === 'linkedin-profile' ? 'linkedin' : sourceId, targets: [...new Set(targets)], enabled: true }));
}
function fillTemplate(text, vars) {
  return String(text ?? '').replace(/\{\{\s*([a-zA-Z]+)(?:\+(\d{1,3}))?\s*\}\}/g, (_, name, plus) => {
    const value = vars[name];
    if (plus) return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? dayAdd(value, Number(plus)) : '';
    return value == null ? '' : String(value);
  });
}
const fillDeep = (value, vars) => (typeof value === 'string' ? fillTemplate(value, vars) : Array.isArray(value) ? value.map((entry) => fillDeep(entry, vars)) : isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fillDeep(entry, vars)])) : value);
// Every {{name}} a playbook's text uses (for the catalog test).
function templateNames(value) { const names = new Set(); JSON.stringify(value ?? '').replace(/\{\{\s*([a-zA-Z]+)(?:\+\d{1,3})?\s*\}\}/g, (_, name) => { names.add(name); return ''; }); return [...names]; }
function inputValue(input, raw) {
  if (input.kind === 'names') return list(raw).length ? list(raw).map((entry) => clean(entry, 80)).filter(Boolean).join(', ') : String(raw || '').split(',').map((entry) => clean(entry, 80)).filter(Boolean).join(', ');
  if (input.kind === 'accounts') return longText(raw, input.max || 4000).slice(0, input.max || 4000);
  if (input.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(raw || '')) ? String(raw) : '';
  return clean(raw, input.max || 200);
}

// A playbook set up with the person's answers → { program (a draft to save, or null when an existing program is used as
// it is), programMode, workflow (a draft for validateWorkflow), missing: [{ field, message }] }. Pure: the caller saves.
// opts.sourceProgramId: the program to copy accounts from (or to use as it is); opts.programMode: 'new' | 'existing'.
function instantiatePlaybook(playbook, inputs = {}, { editionId = 'general', brand = '', programs = [], timeZone = 'UTC', sourceProgramId = '', programMode: wantedMode = '', kitFolderIds = null } = {}) {
  if (!isObject(playbook)) fail('playbookId', 'Choose a playbook.');
  const answers = isObject(inputs) ? inputs : {};
  const missing = [];
  const vars = { brand: clean(brand, 120) || 'our brand' };
  for (const input of list(playbook.inputs)) {
    if (input.kind === 'program') continue;
    const value = inputValue(input, answers[input.id] ?? input.default ?? '');
    if (input.required && !value) missing.push({ field: `inputs.${input.id}`, message: `Add “${input.label}”.` });
    vars[input.id] = value;
  }
  const research = playbook.research || {};
  const chosenId = clean(sourceProgramId || answers.program || '', 180);
  const chosen = list(programs).find((row) => row?.id === chosenId) || null;
  const programInput = list(playbook.inputs).find((input) => input.kind === 'program');
  const existing = research.mode === 'quick-scan' || !research.program || wantedMode === 'existing';
  let program = null; let programId = '';
  if (existing) {
    if (!chosen) missing.push({ field: 'inputs.program', message: list(programs).length ? `Choose ${programInput?.label ? `“${programInput.label}”` : 'a research program'}.` : 'Save a research program with sources first. Workflows read its accounts and communities.' });
    programId = chosen?.id || '';
  } else {
    const template = fillDeep(research.program, vars);
    let sourceGroups = [];
    if (research.sourceFrom === 'accounts' || (!chosen && vars.accounts)) sourceGroups = parseAccounts(vars.accounts || answers.accounts);
    else if (chosen) sourceGroups = JSON.parse(JSON.stringify(list(chosen.sourceGroups))).map(({ id: _id, ...group }) => group);
    if (!sourceGroups.length) missing.push({ field: research.sourceFrom === 'accounts' ? 'inputs.accounts' : 'inputs.program', message: research.sourceFrom === 'accounts' ? 'Add at least one account to follow.' : 'Choose a program to copy accounts from, or enter accounts.' });
    const notes = { research: fillTemplate(playbook.notes?.research, vars), reports: fillTemplate(playbook.notes?.reports, vars) };
    program = {
      id: NEW_PROGRAM_ID, name: clean(template.name, 160) || playbook.name, query: clean(template.query, 500), sourceGroups,
      lookbackDays: template.lookbackDays || 7, maxThemes: template.maxThemes || 6, budgets: { ...(template.budgets || {}) },
      schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false,
      ...(notes.research || notes.reports ? { notes } : {}),
    };
    programId = NEW_PROGRAM_ID;
  }
  const trigger = fillDeep(playbook.trigger || { kind: 'manual' }, vars);
  if (trigger.kind === 'schedule') trigger.schedule = { ...trigger.schedule, timeZone: clean(timeZone, 100) || 'UTC' };
  if (trigger.kind === 'program-run') trigger.programId = programId;
  const folders = Array.isArray(kitFolderIds) ? kitFolderIds : null;
  const keep = (channels) => (folders ? list(channels).filter((id) => folders.includes(id)) : list(channels));
  const steps = list(playbook.steps).map((template, index) => {
    const step = fillDeep(template, vars);
    const { semrushChannels, ...rest } = step;
    const out = { ...rest, id: `step-${index + 1}` };
    if (out.kind === 'research') out.programId = programId;
    if (out.kind === 'quick-scan') { out.programId = programId; out.scan = fillDeep(research.quickScan || {}, vars); }
    if (out.kind === 'assets') out.channels = keep(editionId === 'semrush' && Array.isArray(semrushChannels) ? semrushChannels : out.channels);
    if (out.kind === 'approve') out.channels = keep(out.channels);
    return out;
  });
  const workflow = { name: clean(playbook.name, LIMITS.nameChars), description: clean(playbook.outcome, LIMITS.descriptionChars), trigger, steps };
  return { program, programMode: existing ? 'existing' : 'new', programId, workflow, missing };
}

module.exports = {
  CATALOG, LIMITS, NEW_PROGRAM_ID, SECRET_SHAPE,
  validateWorkflow, validateTrigger, validateStep, checkGrammar, allowedAfter, budgetHash, selectByRules, ruleMatches, nextTriggerAt, runsPerMonth, monthKey, zonedWall,
  instantiatePlaybook, parseAccounts, fillTemplate, templateNames, notesText, round2,
};
