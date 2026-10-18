// Research programs at a glance: schedule words, next and last run, sources and budgets. Pure ESM, shared by the
// Research programs page (content-studio-view.jsx), Home's Research programs panel and the program drawer.
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const emptySchedule = () => ({ frequency: 'manual', enabled: false, time: '09:00', timeZone: localTimeZone(), weekday: 1, dayOfMonth: 1, lookbackDays: 7 });
export const timeZones = () => [...new Set([localTimeZone(), 'UTC', ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'])])];
export const programWindowLabel = (program) => program.schedule?.frequency && program.schedule.frequency !== 'manual' ? `Previous ${program.schedule.lookbackDays} complete UTC days` : program.window?.startDate ? `${program.window.startDate} → ${program.window.endDate || 'Present'}` : `Last ${program.lookbackDays || 7} days`;
export const scheduleSummary = (schedule) => schedule.frequency === 'manual' ? 'Only when you start it' : `${schedule.frequency === 'weekly' ? `Every ${WEEKDAYS[schedule.weekday]}` : schedule.frequency === 'monthly' ? `Monthly on day ${schedule.dayOfMonth}` : 'Every day'} at ${schedule.time} · ${schedule.timeZone}`;
export function scheduledDate(value, timeZone) { if (!value) return ''; try { return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)); } catch { return ''; } }

const list = (value) => (Array.isArray(value) ? value : []);
const targetsOf = (group) => (Array.isArray(group?.targets) ? group.targets : String(group?.targets || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean));

// What a program collects from: targets per platform among its turned-on source groups, and whether LinkedIn keyword
// search is on (it searches the research focus, so it has no targets).
export function sourceCounts(program = {}) {
  const byPlatform = { x: 0, reddit: 0, linkedin: 0 };
  let keywordSearch = false;
  for (const group of list(program.sourceGroups)) {
    if (!group?.enabled) continue;
    if (group.sourceId === 'linkedin-search') { keywordSearch = true; continue; }
    const platform = group.platform || (group.sourceId === 'linkedin-profile' ? 'linkedin' : group.sourceId);
    if (platform in byPlatform) byPlatform[platform] += targetsOf(group).length;
  }
  const total = byPlatform.x + byPlatform.reddit + byPlatform.linkedin + (keywordSearch && String(program.query || '').trim() ? 1 : 0);
  return { total, byPlatform, keywordSearch };
}

const ACTIVE = ['queued', 'running', 'awaiting-review'];
const quick = (run) => run?.origin === 'quick-scan';
const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

// One row per program for Home's panel, sorted so what needs attention comes first: a schedule problem or a stopped
// last run, then a run in progress, then the next scheduled runs (soonest first), then the rest (newest edit first).
export function programSummaries({ programs = [], researchRuns = [] } = {}) {
  const rows = list(programs).map((program) => {
    const schedule = { ...emptySchedule(), ...(program.schedule || {}) };
    const runs = list(researchRuns).filter((run) => run.programId === program.id && !quick(run)).sort(newest);
    const last = runs.find((run) => !ACTIVE.includes(run.status) && run.status !== 'queued');
    const active = runs.find((run) => ACTIVE.includes(run.status));
    const recurring = schedule.frequency !== 'manual';
    const problem = String(schedule.lastError || '');
    return {
      id: program.id, name: program.name || 'Untitled program', query: program.query || '', program,
      sources: sourceCounts(program),
      schedule: { recurring, enabled: recurring && Boolean(schedule.enabled), summary: scheduleSummary(schedule), nextRunAt: recurring && schedule.enabled ? schedule.nextRunAt || '' : '', next: recurring && schedule.enabled ? scheduledDate(schedule.nextRunAt, schedule.timeZone) : '', problem, skipped: String(schedule.skippedReason || '') },
      lastRun: last ? { id: last.id, status: last.status, at: last.createdAt || '', costUsd: Number.isFinite(Number(last.costUsd)) ? Number(last.costUsd) : null, route: last.ai?.route || '' } : null,
      activeRun: active ? { id: active.id, status: active.status } : null,
      budgets: { collectionUsd: Number(program.budgets?.collectionUsd) || 0, aiUsd: Number(program.budgets?.aiUsd) || 0 },
      attention: Boolean(problem || last?.status === 'failed'),
      updatedAt: program.updatedAt || program.createdAt || '',
    };
  });
  const rank = (row) => (row.attention ? 0 : row.activeRun ? 1 : row.schedule.nextRunAt ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? String(a.schedule.nextRunAt).localeCompare(String(b.schedule.nextRunAt)) : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
