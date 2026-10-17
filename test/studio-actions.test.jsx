// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CODEX_UNCAPPED, quickScanBlocked, quickScanCostLines, spendLine, titled } from '../src/renderer/src/studio-actions.js';
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
