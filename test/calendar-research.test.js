import { describe, expect, it } from 'vitest';
import { mondayOf, researchByWeek } from '../src/renderer/src/calendar-view.jsx';

// Four weeks from Monday Nov 9, 2026.
const first = mondayOf(new Date(2026, 10, 11));
const weeks = [0, 7, 14, 21].map((days) => { const date = new Date(first); date.setDate(date.getDate() + days); return date; });
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const program = (id, schedule) => ({ id, name: `Program ${id}`, schedule: { time: '09:00', ...schedule } });
const names = (cell) => cell.map((row) => row.name);

describe('researchByWeek', () => {
  it('puts a weekly program in the week of its next run and every week after', () => {
    const out = researchByWeek([program('w', { enabled: true, frequency: 'weekly', weekday: 1, nextRunAt: new Date(2026, 10, 16, 9).toISOString() })], weeks);
    expect(weeks.map((week) => out[key(week)].length)).toEqual([0, 1, 1, 1]);
    expect(out[key(weeks[1])][0].when).toMatch(/Nov 16/);
    expect(out[key(weeks[2])][0].when).toMatch(/Nov 23/);
  });
  it('shows a daily program every week and a monthly one only in the week holding its day', () => {
    const out = researchByWeek([program('d', { enabled: true, frequency: 'daily', nextRunAt: new Date(2026, 10, 10, 9).toISOString() }), program('m', { enabled: true, frequency: 'monthly', dayOfMonth: 20, nextRunAt: new Date(2026, 10, 20, 9).toISOString() })], weeks);
    expect(weeks.map((week) => names(out[key(week)]))).toEqual([['Program d'], ['Program d', 'Program m'], ['Program d'], ['Program d']]);
    expect(out[key(weeks[2])][0].when).toBe('Every day · 09:00');
  });
  it('leaves out programs that are paused or only run on demand', () => {
    const out = researchByWeek([program('p', { enabled: false, frequency: 'weekly', weekday: 1 }), program('o', { enabled: true, frequency: 'manual' })], weeks);
    expect(weeks.every((week) => out[key(week)].length === 0)).toBe(true);
  });
});
