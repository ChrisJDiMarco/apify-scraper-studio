import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDay } from '../src/renderer/src/viewer.js';
import { buildInbox } from '../src/renderer/src/inbox-model.js';

// Calendar days ("2026-10-20": a planned date, a trend's first or last seen, a program window) are read as local days.
// new Date('2026-10-20') is UTC midnight, which is the evening before anywhere west of UTC, so these run in New York.
beforeAll(() => { vi.stubEnv('TZ', 'America/New_York'); });
afterAll(() => { vi.unstubAllEnvs(); });

const local = (year, month, day) => new Date(year, month - 1, day, 12);
const sameYear = (date) => date.getFullYear() === new Date().getFullYear();
const shortDay = (date) => (sameYear(date) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : date.toLocaleDateString(undefined, { dateStyle: 'medium' }));

describe('dates west of UTC', () => {
  it('shows a calendar day as that day, not the day before (Ask AI’s “planned for”, trend first/last seen, program windows)', () => {
    expect(new Date('2026-10-20').getDate()).toBe(19); // the shift this guards against
    expect(formatDay('2026-10-20')).toBe(shortDay(local(2026, 10, 20)));
    expect(formatDay('2026-01-01')).toBe(shortDay(local(2026, 1, 1)));
    expect(formatDay('2026-01-01')).not.toMatch(/Dec|2025/);
  });

  it('still reads full timestamps as instants, and empty or bad values as nothing', () => {
    expect(formatDay('2026-10-20T15:00:00.000Z')).toBe(shortDay(new Date('2026-10-20T15:00:00.000Z')));
    expect(formatDay('')).toBe('');
    expect(formatDay('not a date')).toBe('');
  });

  it('words an Inbox “planned for” the way My plan and the Calendar do, on the planned day', () => {
    const state = { contentStudio: { activeWorkspaceId: 'semrush', researchRuns: [{ id: 'r', workspaceId: 'semrush', status: 'succeeded', createdAt: '2026-10-10T10:00:00.000Z', themes: [{ id: 't-1', name: 'AI Overviews' }] }], contentRuns: [], assets: [],
      adoptionsByTheme: { 't-1': { social: { status: 'using', plannedFor: '2026-10-20', at: '2026-10-16T08:00:00.000Z', channelName: 'Semrush Social Team' } } } } };
    const inbox = buildInbox({ state, viewer: { id: 'member-riley', role: 'editor', allowed: [] }, seenAt: '', now: Date.parse('2026-10-16T12:00:00.000Z') });
    const row = inbox.items.find((item) => item.kind === 'adoption');
    expect(row.detail).toBe(`Planned for ${local(2026, 10, 20).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    expect(row.detail).not.toContain('2026-10-20');
    expect(row.detail).not.toMatch(/19/);
  });
});
