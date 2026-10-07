import { describe, expect, it } from 'vitest';
import scheduling from '../src/shared/research-schedule.js';
import research from '../src/shared/research-program.js';
const { validateResearchSchedule, nextResearchScheduleAt, latestResearchScheduleAt, researchScheduleWindow } = scheduling;
const schedule = extra => ({ frequency: 'daily', enabled: true, time: '09:00', timeZone: 'America/New_York', weekday: 1, dayOfMonth: 1, lookbackDays: 7, ...extra });
describe('research calendar recurrence', () => {
  it('defaults to manual, requires explicit activation, and strips client execution metadata', () => {
    expect(validateResearchSchedule()).toMatchObject({ frequency: 'manual', enabled: false });
    expect(validateResearchSchedule({ frequency: 'weekly' }).enabled).toBe(false);
    expect(validateResearchSchedule({ nextRunAt: 'yesterday', lastRunId: 'forged' })).not.toHaveProperty('nextRunAt');
    expect(nextResearchScheduleAt({ frequency: 'daily', enabled: false })).toBe('');
    expect(() => validateResearchSchedule({ enabled: true })).toThrow(/frequency/);
  });
  it.each([{ enabled: 'true' }, { frequency: 'hourly' }, { time: '24:00' }, { timeZone: 'invalid/zone' }, { timeZone: '+04:00' }, { weekday: 7 }, { dayOfMonth: 0 }, { lookbackDays: 0 }, { lookbackDays: 366 }, { lookbackDays: 1.5 }])('rejects invalid options %j', extra => expect(() => validateResearchSchedule(schedule(extra))).toThrow());
  it('requires a source for an enabled schedule and validates the usual run budgets', () => {
    expect(() => research.validateResearchProgram({ name: 'Daily', sourceGroups: [], schedule: schedule() })).toThrow(/source group/);
    expect(() => research.validateResearchProgram({ name: 'Daily', sourceGroups: [{ platform: 'x', targets: ['user'] }], schedule: schedule(), budgets: { collectionUsd: 0 } })).toThrow(/between/);
  });
  it('keeps 09:00 local time when US daylight-saving starts and ends', () => {
    expect(nextResearchScheduleAt(schedule(), { from: '2026-03-07T14:00:00Z' })).toBe('2026-03-08T13:00:00.000Z');
    expect(nextResearchScheduleAt(schedule(), { from: '2026-10-31T13:00:00Z' })).toBe('2026-11-01T14:00:00.000Z');
  });
  it('moves a nonexistent spring time forward by the gap and runs a repeated fall time once', () => {
    expect(nextResearchScheduleAt(schedule({ time: '02:30' }), { from: '2026-03-07T08:00:00Z' })).toBe('2026-03-08T07:30:00.000Z');
    const fold = schedule({ time: '01:30' });
    expect(nextResearchScheduleAt(fold, { from: '2026-10-31T08:00:00Z' })).toBe('2026-11-01T05:30:00.000Z');
    expect(nextResearchScheduleAt(fold, { from: '2026-11-01T05:30:00Z' })).toBe('2026-11-02T06:30:00.000Z');
    expect(latestResearchScheduleAt(fold, { at: '2026-11-01T06:45:00Z' })).toBe('2026-11-01T05:30:00.000Z');
  });
  it('handles half-hour DST transitions and non-hour offsets', () => {
    expect(nextResearchScheduleAt(schedule({ time: '02:15', timeZone: 'Australia/Lord_Howe' }), { from: '2026-10-03T00:00:00Z' })).toBe('2026-10-03T15:45:00.000Z');
    expect(nextResearchScheduleAt(schedule({ timeZone: 'Asia/Kathmandu' }), { from: '2026-09-27T00:00:00Z' })).toBe('2026-09-27T03:15:00.000Z');
  });
  it('finds a weekly weekday after the current occurrence', () => {
    const weekly = schedule({ frequency: 'weekly', weekday: 1 });
    expect(nextResearchScheduleAt(weekly, { from: '2026-09-28T13:00:00Z' })).toBe('2026-10-05T13:00:00.000Z');
    expect(latestResearchScheduleAt(weekly, { at: '2026-10-03T12:00:00Z' })).toBe('2026-09-28T13:00:00.000Z');
  });
  it('clamps monthly dates to the last day and returns to the 31st afterward', () => {
    const monthly = schedule({ frequency: 'monthly', dayOfMonth: 31 });
    expect(nextResearchScheduleAt(monthly, { from: '2026-01-31T14:00:00Z' })).toBe('2026-02-28T14:00:00.000Z');
    expect(nextResearchScheduleAt(monthly, { from: '2026-02-28T14:00:00Z' })).toBe('2026-03-31T13:00:00.000Z');
    expect(nextResearchScheduleAt(monthly, { from: '2028-01-31T14:00:00Z' })).toBe('2028-02-29T14:00:00.000Z');
  });
  it('anchors the lookback to complete UTC dates, including year boundaries', () => {
    expect(researchScheduleWindow(schedule({ lookbackDays: 1 }), '2027-01-01T14:00:00Z')).toEqual({ startDate: '2026-12-31', endDate: '2026-12-31' });
    expect(researchScheduleWindow(schedule(), '2026-09-28T13:00:00Z')).toEqual({ startDate: '2026-09-21', endDate: '2026-09-27' });
  });
});
