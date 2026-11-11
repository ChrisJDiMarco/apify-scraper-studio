// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';
import { TrendKanban, TrendsToolbar } from '../src/renderer/src/trend-kanban.jsx';
import { NO_FILTERS, filterBoard, filterChoices } from '../src/renderer/src/trend-filters.js';

const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key), clear: () => stored.clear() } });
afterEach(() => { cleanup(); stored.clear(); });
const card = (name, stage, extra = {}) => ({ key: `r:${name}`, runId: 'r', themeId: name, name, description: `${name} described`, evidenceCount: 5, platforms: ['x'], priorityTier: 'STRONG', keywords: [], stage, canDecide: ['potential', 'approved'].includes(stage), ...extra });
const boardOf = (cards) => ({ cards, scouting: [], columns: Object.fromEntries(['potential', 'approved', 'production', 'ready', 'passed', 'archived'].map((stage) => [stage, cards.filter((row) => row.stage === stage)])) });
const report = [{ id: 'asset-1', deliverableId: 'evidence-report', title: 'Report' }];

function open(cards, { can = () => true } = {}) {
  const handlers = { onDecide: vi.fn(), onWriteReports: vi.fn(), onArchive: vi.fn(), onOpenReport: vi.fn(), onOpenTrend: vi.fn() };
  render(<ConfirmProvider><TrendKanban board={boardOf(cards)} approved={cards.filter((row) => row.stage === 'approved')} busy={false} canDecide canWrite viewer={{ id: 'me' }} can={can}
    meta={() => null} why={() => null} decided={() => null} yes={() => <button type="button">Yes</button>} {...handlers} /></ConfirmProvider>);
  return handlers;
}
const column = (name) => screen.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) }).closest('section');
const cardOf = (name) => screen.getByRole('button', { name }).closest('article');
const drag = (name, to) => { fireEvent.dragStart(cardOf(name)); fireEvent.dragOver(column(to)); fireEvent.drop(column(to)); };

describe('Trends board', () => {
  it('has an Archived column and shows a long column eight at a time', () => {
    open(Array.from({ length: 30 }, (_, index) => card(`Trend ${String(index + 1).padStart(2, '0')}`, 'ready', { canDecide: false, reportAssets: report })));
    expect(within(column('Ready')).getAllByRole('article')).toHaveLength(8);
    expect(within(column('Ready')).getByText('22 trends not shown')).toBeInTheDocument();
    fireEvent.click(within(column('Ready')).getByRole('button', { name: /Show 16 more/ }));
    expect(within(column('Ready')).getAllByRole('article')).toHaveLength(24);
    expect(within(column('Archived')).getByText('Drag a finished trend here to file it away.')).toBeInTheDocument();
  });
  it('shows when research found each trend, on the card', () => {
    open([card('Zero click', 'potential', { discoveredAt: new Date(2025, 2, 4, 9).toISOString() }), card('Undated', 'potential')]);
    expect(within(cardOf('Zero click')).getByText(new Date(2025, 2, 4).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))).toBeInTheDocument();
    expect(cardOf('Undated').querySelector('.simple-kanban-date strong')).toBeNull();
  });
  it('approves a waiting trend dropped on Approved, with no question', () => {
    const h = open([card('Zero click', 'potential')]);
    drag('Zero click', 'Approved');
    expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zero click' }), 'approved');
  });
  it('asks before a backwards move, and stops asking once told to', async () => {
    const h = open([card('Zero click', 'approved'), card('Local packs', 'approved')]);
    drag('Zero click', 'Needs your OK');
    const dialog = await screen.findByRole('alertdialog', { name: 'Take back the yes on “Zero click”?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.onDecide).not.toHaveBeenCalled();
    drag('Zero click', 'Needs your OK');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Don’t ask me this again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zero click' }), 'pending'));
    drag('Local packs', 'Needs your OK');
    await waitFor(() => expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ name: 'Local packs' }), 'pending'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('archives from Ready after asking, and brings a trend back without asking', async () => {
    const h = open([card('Zero click', 'ready', { canDecide: false, reportAssets: report }), card('Old news', 'archived', { canDecide: false, homeStage: 'passed' })]);
    drag('Zero click', 'Archived');
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Archive “Zero click”?' })).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(h.onArchive).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zero click' }), true));
    fireEvent.click(screen.getByRole('button', { name: 'Bring back Old news' }));
    await waitFor(() => expect(h.onArchive).toHaveBeenCalledWith(expect.objectContaining({ name: 'Old news' }), false));
  });
  it('writes reports for a trend dropped on Being written', async () => {
    const h = open([card('Zero click', 'approved')]);
    drag('Zero click', 'Being written');
    await waitFor(() => expect(h.onWriteReports).toHaveBeenCalledWith({ runId: 'r' }));
  });
  it('says why a move cannot be made instead of ignoring it', async () => {
    const h = open([card('Zero click', 'ready', { canDecide: false, reportAssets: report })]);
    drag('Zero click', 'Needs your OK');
    expect(await screen.findByRole('status')).toHaveTextContent('The reports for “Zero click” are already written, so it can’t go back to Needs your OK.');
    expect(h.onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('offers the same moves from a menu, for the keyboard', async () => {
    const h = open([card('Zero click', 'potential')]);
    fireEvent.click(screen.getByRole('button', { name: 'Move Zero click' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Move to Approved', 'Move to Skipped']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Skipped' }));
    await waitFor(() => expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zero click' }), 'passed'));
  });
  it('offers no moves to a role that can do none', () => {
    open([card('Zero click', 'potential')], { can: () => false });
    expect(screen.queryByRole('button', { name: 'Move Zero click' })).toBeNull();
  });
});

describe('Trends filter bar', () => {
  const cards = [card('AI citations', 'ready', { priorityTier: 'FAST-TRACK', platforms: ['x', 'reddit'], discoveredAt: '2026-11-10T00:00:00Z' }), card('Zero click', 'ready', { platforms: ['linkedin'], discoveredAt: '2026-11-09T00:00:00Z' })];
  function Bar() {
    const [filters, setFilters] = useState(NO_FILTERS); const board = boardOf(cards); const view = filterBoard(board, filters, Date.parse('2026-11-11T00:00:00Z'));
    return <><TrendsToolbar filters={filters} onChange={setFilters} choices={filterChoices(cards)} shown={view.cards.length} total={cards.length} /><ul>{view.cards.map((row) => <li key={row.key}>{row.name}</li>)}</ul></>;
  }
  it('searches, narrows and clears', () => {
    render(<Bar />);
    expect(screen.getByRole('status')).toHaveTextContent('2 trends');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search trends' }), { target: { value: 'zero' } });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Zero click']);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 trends');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Platform' }), { target: { value: 'reddit' } });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['AI citations']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Platform' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'oldest' } });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Zero click', 'AI citations']);
  });
});
