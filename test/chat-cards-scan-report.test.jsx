// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCards } from '../src/renderer/src/chat-cards.jsx';

// The quick scan's short trends report on Ask AI's cards (SPEC-3): the scan plan prices it and lets it be turned off, a
// start names the conversation it came from, and the run card opens the report or retries only the report.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const CONVERSATION = 'ask-11111111-2222-3333-4444-555555555555';
const MESSAGE = 'msg-11111111-2222-3333-4444-555555555555';
const state = (extra = {}) => ({ contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', editionId: 'semrush' }], programs: [{ id: 'p-weekly', workspaceId: 'w', name: 'Weekly listening' }], researchRuns: [], contentRuns: [], assets: [], capabilities: {}, ...extra } });
const estimate = (report = true) => ({ scan: { topic: 'AI Overviews', depth: 'lite', aiBudgetUsd: 1.5, collectionBudgetUsd: 1.5, report }, programId: 'p-weekly', programName: 'Weekly listening', plan: { targets: [], platforms: ['x'] }, ai: { totalUsd: report ? 0.55 : 0.28, stages: { discovery: 0.2, synthesis: 0.08, report: report ? 0.27 : 0 }, report: { on: report, usd: report ? 0.27 : 0 } }, collection: { worstCaseUsd: 0.4, totalBudgetUsd: 1.5, warnings: [] }, warnings: [], lines: ['Small and cheap scan of “AI Overviews” over the last 12 hours.', `AI: about $${report ? '0.55 (includes a short trends report, about $0.27)' : '0.28'}, capped at $1.50.`, report ? 'When it finds trends, it writes a short trends report and posts it in Ask AI. No review or tagging, and the saved program is not changed.' : 'Stops once trends are found: no review, tagging or reports, and the saved program is not changed.'], fingerprint: report ? 'fp-on' : 'fp-off', ready: true });
const planCard = { type: 'scan-plan', title: 'Quick scan · AI Overviews', note: '', actionIndexes: [0], data: { scan: { topic: 'AI Overviews', depth: 'lite', platforms: ['x'] }, programId: 'p-weekly', programName: 'Weekly listening' } };
const scanAction = { kind: 'quick-scan', label: 'Run a small scan on AI Overviews', target: 'AI Overviews', scan: { topic: 'AI Overviews', depth: 'lite', platforms: ['x'] } };

describe('the scan plan card', () => {
  it('includes the trends report in the cost, can turn it off, and starts with the conversation it came from', async () => {
    const api = { estimateQuickScan: vi.fn(async ({ scan }) => estimate(scan.report !== false)), startQuickScan: vi.fn(async () => ({ id: 'research-scan', title: 'Quick scan · AI Overviews', status: 'queued' })) };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChatCards cards={[planCard]} actions={[scanAction]} actionState={{}} state={state()} onNav={{}} api={api} onAction={vi.fn()} onOutcome={vi.fn()} conversationId={CONVERSATION} messageId={MESSAGE} />);
    const toggle = screen.getByRole('checkbox', { name: /Write a short trends report when it finds trends/ });
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Check cost' }));
    expect(await screen.findByText('Includes a short trends report, about $0.27.')).toBeInTheDocument();
    expect(api.estimateQuickScan).toHaveBeenLastCalledWith({ programId: 'p-weekly', scan: expect.objectContaining({ report: true }) });
    expect(screen.getByText(/When it finds trends, it writes a short trends report and posts it in Ask AI/)).toBeInTheDocument();
    // Turning it off changes the plan: the price is stale until it is checked again.
    fireEvent.click(toggle);
    expect(screen.getByText('You changed the plan. Check the cost again before starting.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.estimateQuickScan).toHaveBeenLastCalledWith({ programId: 'p-weekly', scan: expect.objectContaining({ report: false }) }));
    await waitFor(() => expect(screen.queryByText(/Includes a short trends report/)).not.toBeInTheDocument());
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Includes a short trends report, about $0.27.');
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(api.startQuickScan).toHaveBeenCalledWith({ programId: 'p-weekly', scan: expect.objectContaining({ report: true }), fingerprint: 'fp-on', ask: { conversationId: CONVERSATION, messageId: MESSAGE, actionIndex: 0 } }));
  });

  it('sends no conversation when the answer isn’t stored yet', async () => {
    const api = { estimateQuickScan: vi.fn(async () => estimate(true)), startQuickScan: vi.fn(async () => ({ id: 'research-scan' })) };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChatCards cards={[planCard]} actions={[scanAction]} actionState={{}} state={state()} onNav={{}} api={api} onAction={vi.fn()} onOutcome={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check cost' }));
    await screen.findByText('Includes a short trends report, about $0.27.');
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(api.startQuickScan).toHaveBeenCalled());
    expect(api.startQuickScan.mock.calls[0][0].ask).toBeUndefined();
  });
});

describe('the quick scan run card', () => {
  const runCard = { type: 'run', title: '', note: '', actionIndexes: [], data: { runId: 'research-scan', kind: 'quick-scan', title: 'Quick scan · AI Overviews', status: 'running', themes: [] } };
  const live = (extra = {}) => ({ id: 'research-scan', workspaceId: 'w', type: 'research', origin: 'quick-scan', programId: 'p-weekly', title: 'Quick scan · AI Overviews', status: 'succeeded', stage: 'scan-complete', createdAt: '2026-10-17T10:00:00Z', quickScan: { topic: 'AI Overviews' }, discoveredThemes: [{ id: 't1', name: 'Fast trend' }], ...extra });
  it('says it is writing the trends report', () => {
    render(<ChatCards cards={[runCard]} actions={[]} actionState={{}} state={state({ researchRuns: [live({ status: 'running', stage: 'scan-report' })] })} onNav={{}} />);
    expect(screen.getByText('Writing the trends report')).toBeInTheDocument();
  });
  it('opens the finished report', () => {
    const openReport = vi.fn();
    render(<ChatCards cards={[runCard]} actions={[]} actionState={{}} state={state({ researchRuns: [live({ scanReport: { runId: 'c-report', status: 'succeeded', assetId: 'asset-report' } })] })} onNav={{ openReport }} onRunAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the report' }));
    expect(openReport).toHaveBeenCalledWith('asset-report');
    expect(screen.queryByRole('button', { name: 'Retry report' })).not.toBeInTheDocument();
  });
  it('retries only the report when it didn’t finish (the scan stays done)', async () => {
    const onRunAction = vi.fn(async () => 'Trying again. Progress shows on Home.');
    render(<ChatCards cards={[runCard]} actions={[]} actionState={{}} state={state({ researchRuns: [live({ scanReport: { runId: 'c-report', status: 'failed', error: 'It stopped early.' } })] })} onNav={{}} onRunAction={onRunAction} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith({ kind: 'retry-run', label: 'Retry report', target: 'Quick scan trends report', runId: 'c-report' }));
    expect(await screen.findByText('Trying again. Progress shows on Home.')).toBeInTheDocument();
  });
  it('uses the follow-up’s own Retry report button when the message carries one', () => {
    const onAction = vi.fn();
    const action = { kind: 'retry-run', label: 'Retry report', target: 'Quick scan · AI Overviews', runId: 'c-report' };
    render(<ChatCards cards={[{ ...runCard, actionIndexes: [0] }]} actions={[action]} actionState={{}} state={state({ researchRuns: [live({ scanReport: { runId: 'c-report', status: 'failed' } })] })} onNav={{}} onAction={onAction} onRunAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    expect(onAction).toHaveBeenCalledWith(0);
    expect(screen.getAllByRole('button', { name: 'Retry report' })).toHaveLength(1);
  });
});
