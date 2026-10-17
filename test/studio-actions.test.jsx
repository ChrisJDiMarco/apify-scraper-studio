// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_UNCAPPED, quickScanBlocked, quickScanCostLines, retryCap, spendLine, titled, useStudioActions } from '../src/renderer/src/studio-actions.js';
import { ConfirmProvider, confirmOptions, useConfirm } from '../src/renderer/src/confirm-dialog.jsx';
import { cardActionIndexes, scanDraft } from '../src/renderer/src/chat-cards.jsx';

afterEach(cleanup);

describe('spend lines', () => {
  it('shows the estimate against each cap, and falls back to the cap alone', () => {
    expect(spendLine({ aiUsd: 1.2, aiCapUsd: 1.5, apifyUsd: 1.1, apifyCapUsd: 1.5 })).toBe('This spends about $1.20 AI (cap $1.50), up to $1.10 on Apify (cap $1.50).');
    expect(spendLine({ aiUsd: null, aiCapUsd: 25, apifyUsd: undefined, apifyCapUsd: 10 })).toBe('This spends AI up to $25.00, Apify up to $10.00.');
    expect(spendLine({})).toBe('');
  });
  it('uses the server’s plan lines for a quick scan, then its warnings, without repeating them', () => {
    const estimate = { lines: ['Small and cheap scan of “SEO” over the last 6 hours.', 'AI: about $0.80, capped at $1.50.'], warnings: ['Only 3 LinkedIn profiles matched.'], collection: { warnings: ['Only 3 LinkedIn profiles matched.'] }, uncapped: false };
    expect(quickScanCostLines(estimate)).toEqual([...estimate.lines, 'Only 3 LinkedIn profiles matched.']);
  });
  it('builds the spend line and the Codex note when the server sent no lines', () => {
    const lines = quickScanCostLines({ scan: { aiBudgetUsd: 1.5, collectionBudgetUsd: 2 }, ai: { totalUsd: 0.5 }, collection: { worstCaseUsd: 1.25, totalBudgetUsd: 2 }, route: 'codex' });
    expect(lines).toEqual(['This spends about $0.50 AI (cap $1.50), up to $1.25 on Apify (cap $2.00).', CODEX_UNCAPPED]);
  });
  it('treats ready:false as a plan the server would refuse', () => {
    expect(quickScanBlocked({ ready: false })).toBe(true);
    expect(quickScanBlocked({ ready: true })).toBe(false);
    expect(quickScanBlocked({})).toBe(false);
  });
});

describe('matching names from Ask AI', () => {
  const rows = [{ title: 'AI Citation Tracking — Comprehensive Trends Report' }, { title: 'Zero-click search' }];
  it('prefers an exact title, then containment either way', () => {
    expect(titled(rows, 'zero-click search')).toBe(rows[1]);
    expect(titled(rows, 'AI Citation Tracking')).toBe(rows[0]);
    expect(titled(rows, '')).toBeNull();
    expect(titled(rows, 'Something else')).toBeNull();
  });
  it('uses the server’s rules: short names match exactly only, and the closest length wins over the newest', () => {
    const reports = [{ title: 'Local SEO for AI Assistants: Editorial Toolkit' }, { title: 'Local SEO Trends Report' }, { title: 'Email outreach benchmarks' }, { title: 'AI' }];
    expect(titled(reports, 'SEO')).toBeNull();
    expect(titled(reports, 'AI')).toBe(reports[3]);
    expect(titled(reports, 'Local SEO')).toBe(reports[1]);
    expect(titled([{ title: 'Email outreach benchmarks' }], 'ai')).toBeNull();
  });
});

// The hook as Ask AI runs it: App's runAction (the stub below behaves the same way: with throwOnError it rethrows,
// otherwise it shows the error and resolves null), a confirmation that says yes, and a studio with two research runs
// that both found "AI Overviews".
const STUDIO = {
  activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'Semrush', editionId: 'semrush' }],
  programs: [{ id: 'p-weekly', workspaceId: 'w', name: 'Weekly listening', budgets: { aiUsd: 40, collectionUsd: 20 }, maxThemes: 4 }, { id: 'p-pulse', workspaceId: 'w', name: 'AI search pulse', budgets: { aiUsd: 40, collectionUsd: 20 }, maxThemes: 4 }],
  researchRuns: [
    { id: 'run-pulse', workspaceId: 'w', type: 'research', programId: 'p-pulse', title: 'AI search pulse', status: 'awaiting-review', createdAt: '2026-10-16T09:00:00Z', maxBudgetUsd: 40, costUsd: 2, discoveredThemes: [{ id: 'theme-ov', name: 'AI Overviews' }, { id: 'theme-zc', name: 'Zero-click search' }], themes: [], decisions: { 'theme-zc': 'approved' } },
    { id: 'run-weekly', workspaceId: 'w', type: 'research', programId: 'p-weekly', title: 'Weekly listening', status: 'awaiting-review', createdAt: '2026-10-15T09:00:00Z', maxBudgetUsd: 40, costUsd: 2, discoveredThemes: [{ id: 'theme-ov', name: 'AI Overviews' }, { id: 'theme-ll', name: 'Listicles' }], themes: [], decisions: { 'theme-ll': 'approved' } },
  ],
  contentRuns: [], assets: [{ id: 'asset-r', workspaceId: 'w', runId: 'content-1', kind: 'text', title: 'Zero-click search — Comprehensive Trends Report', createdAt: '2026-10-10T10:00:00Z' }],
};
function hook(apiIn = {}, { confirm = async () => true, nav = {}, onError, web = false } = {}) {
  const asked = [];
  const api = { estimateResearchProgram: async () => ({ ai: { totalUsd: 3, stages: { discovery: 1, synthesis: 0.5, matching: 0.25, tagging: 0.5, reports: 4 } }, collection: { worstCaseUsd: 2 } }), decideResearchTheme: vi.fn(async () => ({})), ...apiIn };
  const banner = [];
  const action = async (work, message, throwOnError) => { try { const result = await work(); if (message) banner.push(typeof message === 'function' ? message(result) : message); return result; } catch (failure) { if (throwOnError) throw failure; banner.push(`error: ${failure.message}`); return null; } };
  const { result } = renderHook(() => useStudioActions({ api, state: { contentStudio: STUDIO }, action, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: async (options) => { asked.push(options); return confirm(options); }, nav, onError, web }));
  return { result, api, asked, banner };
}

describe('Ask AI buttons report what really happened', () => {
  it('shows a refused start under the button, and keeps the banner for the studio’s own buttons', async () => {
    const refused = Object.assign(new Error('Riley started a search with this program at 2:14 PM. It’s still running.'), { status: 409 });
    const { result, banner } = hook({ startResearchRun: vi.fn(async () => { throw refused; }) });
    await expect(result.current.runAiAction({ kind: 'start-research', target: 'Weekly listening', programId: 'p-weekly' })).rejects.toThrow('still running');
    expect(banner).toEqual([]);
    await expect(result.current.startResearch(STUDIO.programs[0])).resolves.toBeNull();
    expect(banner).toEqual([`error: ${refused.message}`]);
  });
  it('says no only when the person said no, and calls nothing then', async () => {
    const { result, api } = hook({ startResearchRun: vi.fn(async () => ({})) }, { confirm: async () => false });
    await expect(result.current.runAiAction({ kind: 'start-research', programId: 'p-weekly' })).resolves.toBe(false);
    expect(api.startResearchRun).not.toHaveBeenCalled();
  });
  it('waits for a Yes to be saved, rejects when it isn’t, and never shows a toast for it', async () => {
    const onError = vi.fn();
    const { result } = hook({ decideResearchTheme: vi.fn(async () => { throw new Error('This trend is no longer waiting for a decision.'); }) }, { onError });
    await expect(result.current.runAiAction({ kind: 'approve-trend', target: 'AI Overviews', runId: 'run-weekly', themeId: 'theme-ov' })).rejects.toThrow('no longer waiting');
    expect(onError).not.toHaveBeenCalled();
  });
  it('saves a Yes with its note and channels, and names the run when two found the same trend', async () => {
    const { result, api } = hook();
    await expect(result.current.runAiAction({ kind: 'approve-trend', target: 'AI Overviews', runId: 'run-weekly', themeId: 'theme-ov', params: { note: 'Lead with clicks', channels: ['social', 'blog'] } })).resolves.toBe('Approved “AI Overviews” from Weekly listening for Social and Blog.');
    expect(api.decideResearchTheme).toHaveBeenCalledWith({ runId: 'run-weekly', themeId: 'theme-ov', decision: 'approved', note: 'Lead with clicks', channels: ['social', 'blog'] });
    // By name alone it refuses to guess between the two runs; a run hint settles it.
    await expect(result.current.runAiAction({ kind: 'approve-trend', target: 'AI Overviews' })).rejects.toThrow('Two runs found “AI Overviews” (AI search pulse, Weekly listening)');
    await expect(result.current.runAiAction({ kind: 'pass-trend', target: 'AI Overviews · AI search pulse', params: { note: 'Not for us' } })).resolves.toBe('Skipped “AI Overviews” from AI search pulse.');
    expect(api.decideResearchTheme).toHaveBeenLastCalledWith({ runId: 'run-pulse', themeId: 'theme-ov', decision: 'passed', note: 'Not for us' });
  });
  it('reports how many approvals landed when only some do', async () => {
    const { result } = hook({ decideResearchTheme: vi.fn(async ({ runId }) => { if (runId === 'run-weekly') throw new Error('It changed.'); return {}; }) });
    await expect(result.current.runAiAction({ kind: 'approve-trends', target: '' })).resolves.toBe('Approved 1 of 2. “AI Overviews” couldn’t be saved: It changed.');
  });
  it('writes reports only for the chosen trends, names the approved ones that will be skipped, and reports a run that couldn’t continue', async () => {
    const approveResearchThemes = vi.fn(async () => ({})); const continueResearchRun = vi.fn(async ({ runId }) => { if (runId === 'run-weekly') throw new Error('The Claude app is not signed in.'); return {}; });
    const { result, asked } = hook({ approveResearchThemes, continueResearchRun });
    const line = await result.current.runAiAction({ kind: 'write-reports', target: '', picks: [{ runId: 'run-pulse', themeId: 'theme-zc' }, { runId: 'run-weekly', themeId: 'theme-ll' }] });
    expect(line).toBe('Started 1 of 2 runs. Writing 1 report. They’ll appear under Reports. “Weekly listening” couldn’t continue: The Claude app is not signed in.');
    expect(asked[0]).toMatchObject({ title: 'Write reports for 2 approved trends?', confirmLabel: 'Write reports' });
    expect(approveResearchThemes).toHaveBeenCalledWith({ runId: 'run-pulse', themes: ['theme-zc'] });
    // Picking one of two approved trends in a run says the other is skipped for good.
    const { result: one, asked: askedOne } = hook({ approveResearchThemes, continueResearchRun: vi.fn(async () => { throw new Error('This run is not awaiting theme review.'); }) });
    await expect(one.current.runAiAction({ kind: 'write-reports', target: '', params: { trends: ['Zero-click search'] } })).rejects.toThrow('not awaiting theme review');
    expect(askedOne[0].lines.join(' ')).toContain('trend you haven’t decided on');
  });
  it('opens the asset dialog with the channels Ask AI picked, and copies a link only when there is one', async () => {
    const makeAssets = vi.fn(); const copyLink = vi.fn(() => '');
    const { result } = hook({}, { nav: { makeAssets, copyLink } });
    await expect(result.current.runAiAction({ kind: 'make-assets', target: 'Zero-click', assetId: 'asset-r', params: { channels: ['social'] } })).resolves.toBe('Opened the asset dialog with Social ticked. Check what will be made, then press Make.');
    expect(makeAssets).toHaveBeenCalledWith({ kind: 'report', assetId: 'asset-r', channels: ['social'] });
    await expect(result.current.runAiAction({ kind: 'copy', target: 'Zero-click', ref: { kind: 'report', id: 'asset-r' }, params: { what: 'link' } })).rejects.toThrow('Share links need a Studio web address');
    expect(copyLink).toHaveBeenCalledWith('report', 'asset-r');
    await expect(hook({}, { nav: {} }).result.current.runAiAction({ kind: 'invite-people', target: '', params: { emails: ['alex@example.com'] } })).rejects.toThrow('That isn’t available in this layout.');
  });
  it('says View as worked only once the server agreed, and nothing when the person cancelled', async () => {
    const run = (viewAs) => hook({}, { nav: { viewAs } }).result.current.runAiAction({ kind: 'view-as', target: 'Channel owner', title: 'Channel owner', roleId: 'channel', params: {} });
    await expect(run(vi.fn(async () => true))).resolves.toBe('Showing the studio as Channel owner. Choose Admin under View as to come back.');
    await expect(run(vi.fn(async () => false))).resolves.toBe(false);
    await expect(run(vi.fn(async () => { throw new Error('Choose a role, a channel or a person to preview.'); }))).rejects.toThrow('Choose a role, a channel or a person to preview.');
  });
  it('moves a report through review with its live link, and records a channel’s answer', async () => {
    const setAssetStatus = vi.fn(async () => ({ asset: {} })); const setTrendAdoption = vi.fn(async () => ({}));
    const { result } = hook({ setAssetStatus, setTrendAdoption });
    await expect(result.current.runAiAction({ kind: 'set-status', target: 'Zero-click search — Comprehensive Trends Report', assetId: 'asset-r', params: { status: 'published', link: 'https://blog.example.com/zero-click' } })).resolves.toBe('Moved “Zero-click search — Comprehensive Trends Report” to Published with its live link.');
    expect(setAssetStatus).toHaveBeenCalledWith({ assetId: 'asset-r', status: 'published', link: 'https://blog.example.com/zero-click' });
    await expect(result.current.runAiAction({ kind: 'set-status', target: 'x', assetId: 'asset-r', params: {} })).rejects.toThrow('Choose a status first');
    await expect(result.current.runAiAction({ kind: 'mark-used', target: 'Zero-click search', themeId: 'theme-zc', params: { channel: 'social', date: '2026-10-24' } })).resolves.toMatch(/^Saved: Social is using “Zero-click search”, planned for /);
    expect(setTrendAdoption).toHaveBeenCalledWith({ themeId: 'theme-zc', channelId: 'social', status: 'using', plannedFor: '2026-10-24' });
  });
  it('finishes a channel asset set with the shared retry cap', () => {
    expect(retryCap({ maxBudgetUsd: 4, reservedUsd: 0.8 }, 3)).toBe(7);
    expect(retryCap({ maxBudgetUsd: 4000 }, 1)).toBe(1000);
  });
});

describe('scan plan drafts', () => {
  it('keeps -1 for numbers that follow the depth preset and fills missing platforms', () => {
    const draft = scanDraft({ topic: '  SEO  ', depth: 'standard', platforms: [], maxTargets: { x: 5 }, itemsPerPlatform: -1, lookbackHours: 6 });
    expect(draft).toMatchObject({ topic: 'SEO', depth: 'standard', platforms: ['x', 'linkedin', 'reddit'], maxTargets: { x: 5, linkedin: -1, reddit: -1 }, itemsPerPlatform: -1, commentsPerPost: -1, lookbackHours: 6, aiBudgetUsd: -1 });
  });
  it('falls back to the first preset and the topic from the action', () => {
    expect(scanDraft({ depth: 'enormous', platforms: ['reddit', 'myspace'] }, 'AI Overviews')).toMatchObject({ topic: 'AI Overviews', depth: 'lite', platforms: ['reddit'] });
  });
  it('reports which reply actions cards draw, so the answer never offers a button twice', () => {
    const actions = [{ kind: 'approve-trend' }, { kind: 'pass-trend' }, { kind: 'quick-scan' }, { kind: 'open-tab' }];
    const cards = [{ type: 'trend', actionIndexes: [0, 1, 9] }, { type: 'scan-plan', actionIndexes: [] }, { type: 'unknown', actionIndexes: [3] }];
    expect([...cardActionIndexes(cards, actions)].sort()).toEqual([0, 1, 2]);
  });
});

describe('in-app confirmation', () => {
  it('reads a string or options, and splits a message into lines', () => {
    expect(confirmOptions('Stop it?')).toMatchObject({ title: 'Stop it?', lines: [], confirmLabel: 'Continue', tone: 'default' });
    expect(confirmOptions({ title: 'Delete?', message: 'One.\n\nTwo.', tone: 'danger' })).toMatchObject({ lines: ['One.', 'Two.'], tone: 'danger' });
  });
  function Asker({ onAnswer, options }) {
    const confirm = useConfirm();
    return <button type="button" onClick={async () => onAnswer(await confirm(options))}>Ask</button>;
  }
  it('resolves true on the confirm button and false on Escape, as an alert dialog', async () => {
    const answers = [];
    render(<ConfirmProvider><Asker options={{ title: 'Start research?', lines: ['This spends about $2.00 AI (cap $25.00).'], items: ['AI Overviews'], confirmLabel: 'Start research' }} onAnswer={(value) => answers.push(value)} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start research?' });
    expect(dialog).toHaveTextContent('This spends about $2.00 AI (cap $25.00).');
    expect(screen.getByRole('button', { name: 'Start research' })).toHaveFocus();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start research' })); });
    expect(answers).toEqual([true]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(answers).toEqual([true, false]);
  });
  it('starts a dangerous confirmation on Cancel', async () => {
    render(<ConfirmProvider><Asker options={{ title: 'Delete this conversation?', confirmLabel: 'Delete', tone: 'danger' }} onAnswer={() => {}} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('alertdialog', { name: 'Delete this conversation?' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
