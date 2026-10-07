// Calendar recurrence for Research Programs. No timers, files, or provider calls.
const DEFAULT_RESEARCH_SCHEDULE = Object.freeze({ frequency: 'manual', enabled: false, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7 });
const fail = (field, message) => { const error = new Error(message); error.field = `schedule.${field}`; throw error; };
function validateResearchSchedule(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('frequency', 'Choose a research schedule.');
  const value = { ...DEFAULT_RESEARCH_SCHEDULE, ...Object.fromEntries(Object.keys(DEFAULT_RESEARCH_SCHEDULE).filter(key => input[key] !== undefined).map(key => [key, input[key]])) };
  if (!['manual', 'daily', 'weekly', 'monthly'].includes(value.frequency)) fail('frequency', 'Choose manual, daily, weekly, or monthly.');
  if (typeof value.enabled !== 'boolean') fail('enabled', 'Schedule enabled must be true or false.');
  if (value.frequency === 'manual' && value.enabled) fail('enabled', 'Choose a repeat frequency before enabling the schedule.');
  if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail('time', 'Use a time in HH:MM format.');
  if (typeof value.timeZone !== 'string' || value.timeZone.length > 100 || !value.timeZone || /^[+-]/.test(value.timeZone)) fail('timeZone', 'Choose a valid IANA time zone.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(0); } catch { fail('timeZone', 'Choose a valid IANA time zone.'); }
  for (const [field, min, max] of [['weekday', 0, 6], ['dayOfMonth', 1, 31], ['lookbackDays', 1, 365]]) if (!Number.isInteger(value[field]) || value[field] < min || value[field] > max) fail(field, `${field} must be a whole number from ${min} to ${max}.`);
  return value;
}
const dateParts = (value, formatter) => Object.fromEntries(formatter.formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
const civilStamp = parts => Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0);
function zonedOccurrence(parts, formatter) {
  const wall = civilStamp(parts); const offsets = new Set();
  // Nearby offsets cover both sides of a daylight-saving transition, including
  // half-hour changes. Resolve a repeated time once (earlier); a missing time
  // shifts forward by the transition gap (02:30 becomes 03:30 in a one-hour gap).
  for (let hours = -48; hours <= 48; hours += 12) { const sample = wall + hours * 3600000; offsets.add(civilStamp(dateParts(sample, formatter)) - sample); }
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find(candidate => civilStamp(dateParts(candidate, formatter)) === wall);
  if (exact !== undefined) return exact;
  return candidates.map(candidate => ({ candidate, delta: civilStamp(dateParts(candidate, formatter)) - wall })).filter(row => row.delta > 0).sort((a, b) => a.delta - b.delta || a.candidate - b.candidate)[0]?.candidate;
}
function occurrenceAt(input, from, direction) {
  const schedule = validateResearchSchedule(input);
  if (!schedule.enabled || schedule.frequency === 'manual') return '';
  const after = new Date(from).getTime(); if (!Number.isFinite(after)) throw new Error('A valid recurrence anchor is required.');
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const start = dateParts(after, formatter); const [hour, minute] = schedule.time.split(':').map(Number);
  for (let day = 0; day < 370; day++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + day * direction));
    if (schedule.frequency === 'weekly' && date.getUTCDay() !== schedule.weekday) continue;
    const monthLast = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (schedule.frequency === 'monthly' && date.getUTCDate() !== Math.min(schedule.dayOfMonth, monthLast)) continue;
    const occurrence = zonedOccurrence({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute }, formatter);
    if (direction > 0 ? occurrence > after : occurrence <= after) return new Date(occurrence).toISOString();
  }
  throw new Error('Could not determine the next research occurrence.');
}
function nextResearchScheduleAt(input, { from = new Date().toISOString() } = {}) { return occurrenceAt(input, from, 1); }
function latestResearchScheduleAt(input, { at = new Date().toISOString() } = {}) { return occurrenceAt(input, at, -1); }
function researchScheduleWindow(input, scheduledFor) {
  const schedule = validateResearchSchedule(input); const occurrence = new Date(scheduledFor);
  if (!Number.isFinite(occurrence.getTime())) throw new Error('A valid scheduled occurrence is required.');
  const midnight = Date.UTC(occurrence.getUTCFullYear(), occurrence.getUTCMonth(), occurrence.getUTCDate());
  // Completed UTC days align exactly with the collector's inclusive date filters.
  return { startDate: new Date(midnight - schedule.lookbackDays * 86400000).toISOString().slice(0, 10), endDate: new Date(midnight - 86400000).toISOString().slice(0, 10) };
}
module.exports = { DEFAULT_RESEARCH_SCHEDULE, validateResearchSchedule, nextResearchScheduleAt, latestResearchScheduleAt, researchScheduleWindow };
