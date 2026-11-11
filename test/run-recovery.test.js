import { describe, expect, it } from 'vitest';
import recovery from '../src/main/run-recovery.js';

const { UNFINISHED_RUN, resumableRun, resumableAfterFailure } = recovery;
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const run = (extra) => ({ id: 'run-1', recipeId: 'r', status: 'failed', resumable: true, apifyRunId: 'AbC123', startedAt: '2026-11-11T11:00:00.000Z', finishedAt: '2026-11-11T11:05:00.000Z', ...extra });

describe('a scraper run the studio lost track of', () => {
  it('is picked up by the next Run instead of being paid for again', () => {
    expect(resumableRun([run()], 'r', NOW)?.apifyRunId).toBe('AbC123');
  });
  it('only when it is the scraper’s newest run, failed, marked, recent and has a real run id', () => {
    expect(resumableRun([run(), run({ id: 'run-2', status: 'succeeded', resumable: false, startedAt: '2026-11-11T11:30:00.000Z' })], 'r', NOW)).toBeNull();
    expect(resumableRun([run({ status: 'cancelled' })], 'r', NOW)).toBeNull();
    expect(resumableRun([run({ resumable: false })], 'r', NOW)).toBeNull();
    expect(resumableRun([run({ apifyRunId: '../etc' })], 'r', NOW)).toBeNull();
    expect(resumableRun([run({ startedAt: '2026-11-09T11:00:00.000Z', finishedAt: '2026-11-09T11:05:00.000Z' })], 'r', NOW)).toBeNull();
    expect(resumableRun([run()], 'another-scraper', NOW)).toBeNull();
    expect(resumableRun(null, 'r', NOW)).toBeNull();
  });
  it('is marked after a failure once Apify has started it, but not when Apify says it is gone or the attempt was already a pick-up', () => {
    expect(resumableAfterFailure({ apifyRunId: 'AbC123' }, new Error('socket hang up'))).toBe(true);
    expect(resumableAfterFailure({}, new Error('Apify Actor not found.'))).toBe(false);
    expect(resumableAfterFailure({ apifyRunId: 'AbC123' }, new Error('The saved Apify run could not be found. Check that run in Apify; it will not be started again automatically.'))).toBe(false);
    expect(resumableAfterFailure({ apifyRunId: 'AbC123', resumedFrom: 'run-0' }, new Error('socket hang up'))).toBe(false);
  });
  it('counts every state Apify reports for a run in progress as unfinished after a restart', () => {
    for (const status of ['running', 'ready', 'timing-out', 'aborting']) expect(UNFINISHED_RUN.has(status)).toBe(true);
    for (const status of ['succeeded', 'failed', 'cancelled']) expect(UNFINISHED_RUN.has(status)).toBe(false);
  });
});
