// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStudioActions } from '../src/renderer/src/studio-actions.js';

// What Ask AI can change from chat: each runner saves only what its card held, through the studio's own save calls.
const program = { id: 'p1', workspaceId: 'ws', name: 'AI search pulse', query: 'ai search', updatedAt: '2026-11-01T10:00:00.000Z', lookbackDays: 7, budgets: { collectionUsd: 10, aiUsd: 25 },
  schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1, dayOfMonth: 1, lookbackDays: 7 },
  sourceGroups: [{ id: 'source-x', sourceId: 'x', targets: ['randfish', '@lilyraynyc'], enabled: true }, { id: 'source-reddit', sourceId: 'reddit', targets: ['r/SEO'], enabled: true }, { id: 'source-li', sourceId: 'linkedin-profile', targets: [], enabled: false }] };
const workspace = { id: 'ws', name: 'Main', editionId: 'semrush', knowledge: { audience: 'Marketers', voice: 'Plain.', editorialRules: 'Cite sources.', forbiddenClaims: '' }, products: [{ name: 'Semrush One' }] };
const state = { contentStudio: { activeWorkspaceId: 'ws', workspaces: [workspace], programs: [program], researchRuns: [], contentRuns: [], assets: [] } };
function studio(api = {}, { confirm = async () => true } = {}) {
  const calls = {
    saveResearchProgram: vi.fn(async (payload) => ({ program: payload })),
    readChannelSettings: vi.fn(async ({ channelId }) => ({ channelId, channelName: 'Semrush Blog', knowledge: { audience: 'SEOs', voice: '', format: 'Short.', dos: '', donts: '', examples: 'Kept.', links: '' } })),
    saveChannelKnowledge: vi.fn(async () => ({})), saveContentWorkspace: vi.fn(async () => ({})),
    previewAiRouting: vi.fn(async () => ({ routing: { updatedAt: 'v1', preset: 'balanced', defaults: { text: { route: 'auto', model: 'claude-opus-5-5' } }, tasks: { 'research.tagging': { model: 'claude-fable-5-1', effort: 'low' } } } })),
    saveAiRouting: vi.fn(async ({ routing }) => ({ routing })),
    readPrompt: vi.fn(async () => ({ version: 5 })), revertPrompt: vi.fn(async () => ({ version: 6 })), ...api };
  const confirmed = vi.fn(confirm);
  const { result } = renderHook(() => useStudioActions({ api: calls, state, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: confirmed }));
  return { run: (kind, request) => result.current.executors[kind]({ kind, target: '', params: {}, ...request }), calls, confirmed };
}

describe('edit-program', () => {
  it('changes only what the card held, and carries the version it started from', async () => {
    const { run, calls, confirmed } = studio();
    const said = await run('edit-program', { programId: 'p1', params: { focus: 'AI search and answer engines', days: '14', ai: '40' } });
    const saved = calls.saveResearchProgram.mock.calls[0][0];
    expect(saved).toMatchObject({ id: 'p1', name: 'AI search pulse', query: 'AI search and answer engines', lookbackDays: 14, budgets: { collectionUsd: 10, aiUsd: 40 }, baseUpdatedAt: '2026-11-01T10:00:00.000Z' });
    expect(saved.schedule).toMatchObject({ frequency: 'weekly', enabled: true, lookbackDays: 14 });
    expect(saved.sourceGroups).toEqual(program.sourceGroups);
    expect(confirmed).not.toHaveBeenCalled();
    expect(said).toMatch(/^Saved “AI search pulse”: /);
  });
  it('pauses a schedule without asking, and asks before turning one on', async () => {
    const paused = studio();
    await paused.run('edit-program', { programId: 'p1', params: { schedule: 'off' } });
    expect(paused.calls.saveResearchProgram.mock.calls[0][0].schedule).toMatchObject({ frequency: 'weekly', enabled: false });
    expect(paused.confirmed).not.toHaveBeenCalled();
    const off = { ...state, contentStudio: { ...state.contentStudio, programs: [{ ...program, schedule: { ...program.schedule, enabled: false } }] } };
    const calls = { saveResearchProgram: vi.fn(async () => ({})) };
    const declined = vi.fn(async () => false);
    const { result } = renderHook(() => useStudioActions({ api: calls, state: off, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: declined }));
    expect(await result.current.executors['edit-program']({ kind: 'edit-program', target: '', programId: 'p1', params: { schedule: 'on' } })).toBe(false);
    expect(declined.mock.calls[0][0].lines.join(' ')).toMatch(/\$10\.00 on collection and \$25\.00 on AI/);
    expect(calls.saveResearchProgram).not.toHaveBeenCalled();
  });
  it('refuses a number out of range and a card with nothing on it', async () => {
    const { run, calls } = studio();
    await expect(run('edit-program', { programId: 'p1', params: { days: '400' } })).rejects.toThrow(/whole number from 1 to 90/);
    await expect(run('edit-program', { programId: 'p1', params: {} })).rejects.toThrow(/Nothing to change/);
    await expect(run('edit-program', { target: 'No such program' })).rejects.toThrow(/couldn’t find a research program/);
    expect(calls.saveResearchProgram).not.toHaveBeenCalled();
  });
});

describe('edit-sources', () => {
  it('adds accounts to their platform, skips ones already followed, and removes by name whatever the prefix', async () => {
    const { run, calls } = studio();
    const said = await run('edit-sources', { programId: 'p1', params: { x: 'aleyda, @RandFish', linkedin: ['https://www.linkedin.com/in/someone'], remove: 'lilyraynyc | SEO' } });
    const groups = Object.fromEntries(calls.saveResearchProgram.mock.calls[0][0].sourceGroups.map((group) => [group.sourceId, group]));
    expect(groups.x.targets).toEqual(['randfish', 'aleyda']);
    expect(groups['linkedin-profile']).toMatchObject({ targets: ['https://www.linkedin.com/in/someone'], enabled: true });
    expect(groups.reddit.targets).toEqual([]);
    expect(said).toBe('Saved “AI search pulse”: added 2 and removed 2. Its next run uses them.');
  });
  it('saves nothing when nothing would change', async () => {
    const { run, calls } = studio();
    expect(await run('edit-sources', { programId: 'p1', params: { x: 'randfish' } })).toMatch(/already follows all of those/);
    expect(calls.saveResearchProgram).not.toHaveBeenCalled();
  });
});

describe('edit-channel and edit-brand', () => {
  it('replaces the channel fields on the card and keeps the rest', async () => {
    const { run, calls } = studio();
    await run('edit-channel', { params: { channel: 'blog', voice: 'Direct and practical.', donts: 'No hype.' } });
    expect(calls.saveChannelKnowledge).toHaveBeenCalledWith({ channelId: 'blog', knowledge: { audience: 'SEOs', voice: 'Direct and practical.', format: 'Short.', dos: '', donts: 'No hype.', examples: 'Kept.', links: '' } });
    await expect(run('edit-channel', { params: { voice: 'x' } })).rejects.toThrow(/Choose the channel/);
  });
  it('replaces the brand fields on the card and leaves products alone', async () => {
    const { run, calls } = studio();
    await run('edit-brand', { params: { voice: 'Confident, never salesy.', avoid: 'No ranking guarantees.' } });
    expect(calls.saveContentWorkspace).toHaveBeenCalledWith({ id: 'ws', name: 'Main', editionId: 'semrush', products: [{ name: 'Semrush One' }],
      knowledge: { audience: 'Marketers', voice: 'Confident, never salesy.', editorialRules: 'Cite sources.', forbiddenClaims: 'No ranking guarantees.', name: 'Main', editionId: 'semrush' } });
  });
});

describe('set-model', () => {
  it('changes one task’s model by name, keeping the rest of the routing and the version it read', async () => {
    const { run, calls } = studio();
    const said = await run('set-model', { target: 'Trends report', params: { model: 'Claude Fable 5.2', effort: 'high' } });
    const { routing, baseUpdatedAt } = calls.saveAiRouting.mock.calls[0][0];
    expect(baseUpdatedAt).toBe('v1');
    expect(routing.tasks).toEqual({ 'research.tagging': { model: 'claude-fable-5-1', effort: 'low' }, 'reports.trends-report': { model: 'claude-fable-5-2', effort: 'high' } });
    expect(routing.preset).toBe('custom');
    expect(said).toBe('“Trends report” now uses Claude Fable 5.2 at high effort. Later runs cost what that model costs.');
  });
  it('changes the studio default, and refuses a model or task it doesn’t know', async () => {
    const { run, calls } = studio();
    await run('set-model', { target: 'default', params: { model: 'claude-sonnet-5-5' } });
    expect(calls.saveAiRouting.mock.calls[0][0].routing.defaults.text).toEqual({ route: 'auto', model: 'claude-sonnet-5-5' });
    await expect(run('set-model', { target: 'default', params: { model: 'gpt-9' } })).rejects.toThrow(/isn’t a model the studio lists/);
    await expect(run('set-model', { target: 'Make coffee', params: { model: 'claude-opus-5-5' } })).rejects.toThrow(/couldn’t find an AI task/);
    expect(calls.saveAiRouting).toHaveBeenCalledTimes(1);
  });
});

describe('restore-prompt', () => {
  it('asks first, then restores against the version it read', async () => {
    const { run, calls, confirmed } = studio();
    expect(await run('restore-prompt', { target: 'Trends report', title: 'Trends report', promptId: 'reports.trends-report', params: { version: 3 } })).toBe('Restored version 3 of “Trends report”.');
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(calls.revertPrompt).toHaveBeenCalledWith({ id: 'reports.trends-report', toVersion: 3, expectedVersion: 5, note: 'Restored version 3 from Ask AI' });
  });
  it('does nothing when it is already on that version', async () => {
    const { run, calls } = studio();
    expect(await run('restore-prompt', { target: 'Trends report', title: 'Trends report', promptId: 'reports.trends-report', params: { version: 5 } })).toMatch(/already on version 5/);
    expect(calls.revertPrompt).not.toHaveBeenCalled();
  });
});
