// Pins "today" for a suite whose fixtures carry literal dates, so it passes on any day it runs. Without it, a suite
// written in autumn 2026 breaks by the calendar alone: the Inbox keeps 30 days, and dates from another year are shown
// with the year. Only Date is faked, so timers, waitFor and promises run as usual. A test that calls vi.useFakeTimers
// itself is pinned again before the next test.
import { afterEach, beforeEach, vi } from 'vitest';

export const FIXTURE_TODAY = '2026-11-09T12:00:00Z';
export function pinClock(iso = FIXTURE_TODAY) {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) }); });
  afterEach(() => { vi.useRealTimers(); });
}
