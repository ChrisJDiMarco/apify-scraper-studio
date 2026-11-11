import { describe, expect, it } from 'vitest';
import { shareState } from '../src/renderer/src/state-share.js';

const push = () => JSON.parse(JSON.stringify({ keys: { APIFY_API_TOKEN: true }, datasets: [{ id: 'd1', itemCount: 3 }], settings: { aiModel: 'claude-opus-5-5' },
  contentStudio: { activeWorkspaceId: 'ws', programs: [{ id: 'p', name: 'Pulse' }], researchRuns: [{ id: 'r', status: 'running', progress: { completed: 1, total: 9 } }], contentRuns: [], assets: [{ id: 'a' }] } }));

describe('shareState', () => {
  it('returns the previous state itself when a push changes nothing, so nothing renders', () => {
    const first = push();
    expect(shareState(first, push())).toBe(first);
  });
  it('keeps the identity of every part that did not change, two levels down', () => {
    const first = push(); const next = push();
    next.contentStudio.researchRuns[0].progress.completed = 2;
    const shared = shareState(first, next);
    expect(shared).not.toBe(first);
    expect(shared.contentStudio).not.toBe(first.contentStudio);
    expect(shared.contentStudio.researchRuns).toBe(next.contentStudio.researchRuns);
    expect(shared.contentStudio.researchRuns[0].progress.completed).toBe(2);
    for (const key of ['programs', 'contentRuns', 'assets']) expect(shared.contentStudio[key]).toBe(first.contentStudio[key]);
    for (const key of ['keys', 'datasets', 'settings']) expect(shared[key]).toBe(first[key]);
  });
  it('takes added, removed and retyped parts from the new push', () => {
    const first = push(); const next = push();
    next.help = { estimate: { route: 'claude-api' } }; delete next.settings; next.datasets = {}; next.contentStudio.activeWorkspaceId = 'other';
    const shared = shareState(first, next);
    expect(shared.help).toBe(next.help);
    expect('settings' in shared).toBe(false);
    expect(shared.datasets).toBe(next.datasets);
    expect(shared.contentStudio.activeWorkspaceId).toBe('other');
    expect(shared.keys).toBe(first.keys);
  });
  it('shares across a chain of pushes, and survives a first push with nothing before it', () => {
    const a = shareState(null, push()); const b = shareState(a, push()); const c = shareState(b, push());
    expect(c).toBe(a);
    expect(shareState(undefined, 5)).toBe(5);
  });
  it('treats an empty array and an empty object as different', () => {
    expect(shareState({ rows: [] }, { rows: {} }).rows).toEqual({});
  });
});
