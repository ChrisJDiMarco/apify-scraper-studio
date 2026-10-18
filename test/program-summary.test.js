import { describe, expect, it } from 'vitest';
import { programSummaries, scheduleSummary, sourceCounts } from '../src/renderer/src/program-summary.js';

// Home's Research programs rows: sources, next and last run, the run in progress, and what needs attention first.
const group = (sourceId, targets, enabled = true) => ({ id: `source-${sourceId}`, sourceId, platform: sourceId.startsWith('linkedin') ? 'linkedin' : sourceId, name: sourceId, targets, enabled, options: {} });
const weekly = (extra = {}) => ({ frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7, nextRunAt: '2026-10-19T09:00:00.000Z', ...extra });

describe('program summaries', () => {
  it('counts targets per platform among turned-on sources, and keyword search', () => {
    const program = { query: 'AI search', sourceGroups: [group('x', ['@a', '@b']), group('reddit', 'r/SEO\nr/marketing'), group('linkedin-profile', ['https://linkedin.com/company/a']), group('linkedin-search', []), group('x', ['@off'], false)] };
    expect(sourceCounts(program)).toEqual({ total: 6, byPlatform: { x: 2, reddit: 2, linkedin: 1 }, keywordSearch: true });
    expect(sourceCounts({ sourceGroups: [group('linkedin-search', [])] }).total).toBe(0); // no focus, nothing to search
    expect(sourceCounts({}).total).toBe(0);
  });

  it('finds the last finished run and the one in progress, leaving quick scans out', () => {
    const programs = [{ id: 'p1', name: 'Pulse', sourceGroups: [group('x', ['@a'])], budgets: { collectionUsd: 10, aiUsd: 25 }, schedule: weekly({ skippedReason: 'The previous run is still active.' }) }];
    const researchRuns = [
      { id: 'scan', programId: 'p1', origin: 'quick-scan', status: 'succeeded', createdAt: '2026-10-16T00:00:00Z' },
      { id: 'old', programId: 'p1', status: 'succeeded', createdAt: '2026-10-06T00:00:00Z', costUsd: 2 },
      { id: 'last', programId: 'p1', status: 'partial', createdAt: '2026-10-13T00:00:00Z', costUsd: 3.2, ai: { route: 'codex' } },
      { id: 'live', programId: 'p1', status: 'awaiting-review', createdAt: '2026-10-15T00:00:00Z' },
    ];
    const [row] = programSummaries({ programs, researchRuns });
    expect(row.lastRun).toEqual({ id: 'last', status: 'partial', at: '2026-10-13T00:00:00Z', costUsd: 3.2, route: 'codex' });
    expect(row.activeRun).toEqual({ id: 'live', status: 'awaiting-review' });
    expect(row.schedule).toMatchObject({ recurring: true, enabled: true, nextRunAt: '2026-10-19T09:00:00.000Z', summary: scheduleSummary(weekly()), skipped: 'The previous run is still active.', problem: '' });
    expect(row.schedule.next).toMatch(/Oct/);
    expect(row.budgets).toEqual({ collectionUsd: 10, aiUsd: 25 });
    expect(row.attention).toBe(false);
  });

  it('puts what needs attention first, then runs in progress, then the next scheduled runs', () => {
    const programs = [
      { id: 'later', name: 'Later', updatedAt: '2026-10-01', schedule: weekly({ nextRunAt: '2026-10-25T09:00:00.000Z' }) },
      { id: 'idle', name: 'Idle', updatedAt: '2026-10-09', schedule: { frequency: 'manual', enabled: false } },
      { id: 'soon', name: 'Soon', updatedAt: '2026-10-02', schedule: weekly({ nextRunAt: '2026-10-18T09:00:00.000Z' }) },
      { id: 'broken', name: 'Broken', updatedAt: '2026-10-03', schedule: weekly({ enabled: false, nextRunAt: '', lastError: 'Apify token missing.' }) },
      { id: 'busy', name: 'Busy', updatedAt: '2026-10-04', schedule: { frequency: 'manual', enabled: false } },
      { id: 'stopped', name: 'Stopped', updatedAt: '2026-10-05', schedule: { frequency: 'manual', enabled: false } },
    ];
    const researchRuns = [{ id: 'r1', programId: 'busy', status: 'running', createdAt: '2026-10-16' }, { id: 'r2', programId: 'stopped', status: 'failed', createdAt: '2026-10-15' }];
    const rows = programSummaries({ programs, researchRuns });
    expect(rows.map((row) => row.id)).toEqual(['stopped', 'broken', 'busy', 'soon', 'later', 'idle']);
    expect(rows.find((row) => row.id === 'broken').schedule).toMatchObject({ problem: 'Apify token missing.', enabled: false, next: '' });
    expect(rows.find((row) => row.id === 'idle').schedule).toMatchObject({ recurring: false, summary: 'Only when you start it' });
  });
});
