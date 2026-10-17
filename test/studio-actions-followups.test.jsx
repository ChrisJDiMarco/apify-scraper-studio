// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOf, useStudioActions } from '../src/renderer/src/studio-actions.js';
import { SimpleReports } from '../src/renderer/src/simple-reports.jsx';
import { buildLibraryTree } from '../src/shared/library-tree.js';
import quick from '../src/shared/research-quick-scan.js';

// Ask AI's buttons for work it follows up on (SPEC-3): a scan or research run started from a conversation names it, so
// the studio can post back there; Write reports from a run's follow-up writes only that run's approved trends.
afterEach(cleanup);
const CONVERSATION = 'ask-11111111-2222-3333-4444-555555555555';
const STUDIO = {
  activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'Semrush', editionId: 'semrush' }],
  programs: [{ id: 'p-weekly', workspaceId: 'w', name: 'Weekly listening', budgets: { aiUsd: 40, collectionUsd: 20 }, maxThemes: 4 }],
  researchRuns: [
    { id: 'run-a', workspaceId: 'w', type: 'research', programId: 'p-weekly', title: 'Weekly listening', status: 'awaiting-review', createdAt: '2026-10-16T09:00:00Z', discoveredThemes: [{ id: 't1', name: 'AI Overviews' }, { id: 't2', name: 'Listicles' }], themes: [], decisions: { t1: 'approved' } },
    { id: 'run-b', workspaceId: 'w', type: 'research', programId: 'p-weekly', title: 'Weekly listening', status: 'awaiting-review', createdAt: '2026-10-15T09:00:00Z', discoveredThemes: [{ id: 't3', name: 'Zero-click' }], themes: [], decisions: { t3: 'approved' } },
  ],
  contentRuns: [], assets: [],
};
function hook(api) {
  const action = async (work, message, throwOnError) => { try { return await work(); } catch (failure) { if (throwOnError) throw failure; return null; } };
  return renderHook(() => useStudioActions({ api, state: { contentStudio: STUDIO }, action, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: async () => true })).result;
}

describe('Ask AI buttons that start work a conversation follows', () => {
  it('reads the conversation from the button or the panel', () => {
    expect(askOf({ ask: { conversationId: CONVERSATION, messageId: 'msg-1', actionIndex: 2 } })).toEqual({ conversationId: CONVERSATION, messageId: 'msg-1', actionIndex: 2 });
    expect(askOf({ conversationId: CONVERSATION })).toEqual({ conversationId: CONVERSATION });
    expect(askOf({})).toBeNull();
  });
  it('sends it with a research start and a quick scan', async () => {
    const api = { estimateResearchProgram: async () => null, startResearchRun: vi.fn(async () => ({ id: 'research-new' })), estimateQuickScan: vi.fn(async () => ({ fingerprint: 'fp', ready: true, lines: [] })), startQuickScan: vi.fn(async () => ({ id: 'research-scan', title: 'Quick scan · SEO' })) };
    const result = hook(api);
    await result.current.runAiAction({ kind: 'start-research', target: 'Weekly listening', programId: 'p-weekly', ask: { conversationId: CONVERSATION } });
    expect(api.startResearchRun).toHaveBeenCalledWith(expect.objectContaining({ programId: 'p-weekly', ask: { conversationId: CONVERSATION } }));
    await result.current.runAiAction({ kind: 'quick-scan', target: 'SEO', scan: { topic: 'SEO' }, conversationId: CONVERSATION, messageId: 'msg-2', actionIndex: 0 });
    expect(api.startQuickScan).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'fp', ask: { conversationId: CONVERSATION, messageId: 'msg-2', actionIndex: 0 } }));
    // Without a conversation the start sends none.
    await result.current.runAiAction({ kind: 'start-research', target: 'Weekly listening', programId: 'p-weekly' });
    expect(api.startResearchRun.mock.calls.at(-1)[0].ask).toBeUndefined();
  });
  it('writes reports only for the run the follow-up named, and says when none of its trends has a yes', async () => {
    const api = { estimateResearchProgram: async () => null, approveResearchThemes: vi.fn(async () => ({})), continueResearchRun: vi.fn(async () => ({})) };
    const result = hook(api);
    await result.current.runAiAction({ kind: 'write-reports', label: 'Write reports', target: '', params: {}, runId: 'run-b' });
    expect(api.approveResearchThemes).toHaveBeenCalledTimes(1);
    expect(api.approveResearchThemes).toHaveBeenCalledWith({ runId: 'run-b', themes: ['t3'] });
    await expect(result.current.runAiAction({ kind: 'write-reports', target: '', params: {}, runId: 'run-unknown' })).rejects.toThrow('Say yes to at least one trend from this run first.');
  });
});

describe('the plan lines and Reports', () => {
  it('names the report’s share of the AI estimate, and what happens when it finishes', () => {
    const scan = quick.normalizeScan({ topic: 'SEO', lookbackHours: 6, platforms: ['x'] });
    const lines = quick.describeScan(scan, { platforms: ['x'], targets: [], ai: { totalUsd: 0.62, report: { on: true, usd: 0.27 } }, collection: { worstCaseUsd: 0.4 } });
    expect(lines).toContain('AI: about $0.62 (includes a short trends report, about $0.27), capped at $1.50.');
    expect(lines.at(-1)).toBe('When it finds trends, it writes a short trends report and posts it in Ask AI. No review or tagging, and the saved program is not changed.');
    const off = quick.describeScan(scan, { platforms: ['x'], targets: [], ai: { totalUsd: 0.35, report: { on: false, usd: 0 } } });
    expect(off.at(-1)).toBe('Stops once trends are found: no review, tagging or reports, and the saved program is not changed.');
  });
  it('lists a quick scan’s report as its own row under Quick scans', () => {
    const report = { id: 'a-scan', workspaceId: 'w', runId: 'c-scan', deliverableId: 'scan-report', title: 'Quick scan report: SEO (2026-10-17)', kind: 'text', channel: 'Research', createdAt: '2026-10-17T10:20:00Z', reviewStatus: 'draft' };
    const tree = buildLibraryTree({ researchRuns: [{ id: 'q', workspaceId: 'w', type: 'research', origin: 'quick-scan', title: 'Quick scan · SEO', status: 'succeeded', createdAt: '2026-10-17T10:00:00Z', quickScan: { topic: 'SEO' }, discoveredThemes: [{ id: 't', name: 'T' }] }], contentRuns: [{ id: 'c-scan', workspaceId: 'w', type: 'content', researchRunId: 'q', scanReport: true, status: 'succeeded', createdAt: '2026-10-17T10:10:00Z' }], assets: [report], editionId: 'semrush' });
    render(<SimpleReports api={{ readStudioAsset: vi.fn(async () => ({})) }} reports={[report]} selectedId="" onSelect={vi.fn()} action={vi.fn()} tree={tree} onFindTrends={vi.fn()} onMakeAssets={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Quick scans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick scan · SEO.*Quick scan report/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other reports and drafts' })).not.toBeInTheDocument();
  });
});
