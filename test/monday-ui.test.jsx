// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MondaySettings, estimateMondayCalls } from '../src/renderer/src/monday-settings.jsx';
import { MondayChip, MondayStatusLine } from '../src/renderer/src/monday-ui.jsx';
import { ConfirmProvider } from '../src/renderer/src/confirm-dialog.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';

// Settings → Monday.com, the chips on trend cards and the trend page's status line (monday-settings.jsx, monday-ui.jsx).
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const BOARD = {
  board: { id: '42', name: 'Trends', url: 'https://x.monday.com/boards/42', workspaceName: 'Marketing', itemsCount: 0 },
  columns: [{ id: 'name', title: 'Name', type: 'name' }, { id: 'status', title: 'Stage', type: 'status', labels: ['Approved', 'Done'] }, { id: 'priority', title: 'Priority', type: 'status', labels: ['High'] }, { id: 'notes', title: 'Notes', type: 'long_text' }, { id: 'when', title: 'Due', type: 'date' }],
  groups: [{ id: 'topics', title: 'Group Title' }], suggested: { columns: { stage: 'status', notes: 'notes' }, statusLabels: {} }, missing: ['studioKey'], problems: ['Add a Studio key column so the studio never adds an item twice.'],
};
const FIXED = { ...BOARD, columns: [...BOARD.columns, { id: 'studio_key', title: 'Studio key', type: 'text' }], suggested: { columns: { stage: 'status', notes: 'notes', studioKey: 'studio_key' }, statusLabels: {} }, missing: [], problems: [], rev: 2 };
const api = (extra = {}) => ({
  connectMonday: vi.fn(async ({ token }) => (token === 'good-token-0123456789abcdef' ? { ok: true, account: { name: 'Studio Bot', accountName: 'Example', plan: 'Enterprise' }, dailyLimit: 25000 } : { ok: false, error: 'Monday.com didn’t accept this token. Copy it again from Developers → My access tokens.' })),
  testMondayConnection: vi.fn(async () => ({ ok: true, account: {}, board: null, hooks: { status: 'off' }, callsToday: 3 })),
  listMondayBoards: vi.fn(async () => ({ workspaces: [{ id: '1', name: 'Marketing' }], boards: [{ id: '42', name: 'Trends', url: '', workspaceName: 'Marketing', itemsCount: 12 }], more: false })),
  readMondayBoard: vi.fn(async () => BOARD),
  fixMondayBoard: vi.fn(async () => FIXED),
  createMondayBoard: vi.fn(),
  saveMondayLink: vi.fn(async () => ({ monday: { link: { boardName: 'Trends', rev: 3 } } })),
  disconnectMonday: vi.fn(async () => ({ monday: {} })),
  readMondaySyncLog: vi.fn(async () => ({ rows: [{ at: '2026-10-17T10:00:00Z', dir: 'out', kind: 'created', text: 'Sent “Zero-click search” (new item).', ok: true, url: 'https://x.monday.com/boards/42/pulses/1' }], more: false })),
  syncTrendBoardToMonday: vi.fn(async () => ({ jobId: 'monday-1', queued: 1 })),
  readMondayItem: vi.fn(async () => ({ notes: [{ by: 'Dana Lee', text: 'Looks good', at: '2026-10-17T10:00:00Z' }] })),
  ...extra,
});
const state = (monday) => ({ monday, keys: {}, contentStudio: { researchRuns: [], contentRuns: [], assets: [] } });

describe('Settings → Monday.com', () => {
  it('connects with a tested token, and says plainly when Monday refuses one', async () => {
    const calls = api();
    render(<MondaySettings state={state({ connected: false })} api={calls} />);
    expect(screen.getByText(/profile picture → Developers → My access tokens/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Monday.com API token'), { target: { value: 'wrong-token-0123456789abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Monday.com didn’t accept this token');
    fireEvent.change(screen.getByLabelText('Monday.com API token'), { target: { value: 'good-token-0123456789abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connected as Studio Bot · Example · Enterprise plan · up to 25,000 API calls a day.');
  });

  it('picks a board from the list or a pasted link, offers only compatible columns, and blocks Start syncing until Stage and Studio key are mapped', async () => {
    const calls = api();
    render(<MondaySettings state={state({ connected: true, account: { name: 'Studio Bot' }, dailyLimit: 1000, callsToday: 10 })} api={calls} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Trends/ }));
    await screen.findByRole('heading', { name: /Match columns/ });
    expect(calls.readMondayBoard).toHaveBeenCalledWith({ boardId: '42' });
    const priority = screen.getByRole('combobox', { name: 'Monday column for Priority' });
    expect(within(priority).getAllByRole('option').map((option) => option.textContent)).toEqual(['Don’t sync', 'Priority (Status)', 'Add a new column']);
    const sources = screen.getByRole('combobox', { name: 'Monday column for Sources' });
    expect(within(sources).getAllByRole('option').map((option) => option.textContent)).toEqual(['Don’t sync', 'Add a new column']); // no Numbers column on this board
    expect(screen.getByRole('button', { name: 'Start syncing' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Add the missing columns/ }));
    await waitFor(() => expect(calls.fixMondayBoard).toHaveBeenCalledWith({ boardId: '42', add: ['studioKey'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start syncing' })).toBeEnabled());
    // The stage label table offers the board's labels, and adds the studio's where they're missing.
    const approved = screen.getByRole('combobox', { name: 'Monday label for Approved' });
    expect(within(approved).getAllByRole('option').map((option) => option.textContent)).toContain('Approved');
    expect(within(screen.getByRole('combobox', { name: 'Monday label for Needs your OK' })).getAllByRole('option').map((option) => option.textContent)).toContain('Add “Potential trend”');
    fireEvent.click(screen.getByRole('button', { name: 'Start syncing' }));
    await waitFor(() => expect(calls.saveMondayLink).toHaveBeenCalled());
    expect(calls.saveMondayLink.mock.calls[0][0]).toMatchObject({ rev: 2, boardId: '42', active: true, columns: { stage: 'status', studioKey: 'studio_key', notes: 'notes' } });
  });

  it('reads a pasted board link', async () => {
    const calls = api();
    render(<MondaySettings state={state({ connected: true })} api={calls} />);
    fireEvent.change(await screen.findByPlaceholderText('https://yourteam.monday.com/boards/1234567890'), { target: { value: 'https://x.monday.com/boards/42/views/9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this board' }));
    await waitFor(() => expect(calls.readMondayBoard).toHaveBeenCalledWith({ url: 'https://x.monday.com/boards/42/views/9' }));
  });

  it('warns when the settings would use more than 60% of the plan’s daily calls', async () => {
    expect(estimateMondayCalls({ push: { mode: 'live' }, pull: { mode: 'poll', pollMinutes: 2 }, trends: 100 })).toBeGreaterThan(600);
    expect(estimateMondayCalls({ push: { mode: 'hourly' }, pull: { mode: 'poll', pollMinutes: 15 }, trends: 100 })).toBeLessThan(200);
    render(<MondaySettings state={state({ connected: true, dailyLimit: 1000, callsToday: 143 })} api={api({ readMondayBoard: vi.fn(async () => FIXED) })} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Trends/ }));
    const budget = await screen.findByTestId('md-budget');
    expect(budget).toHaveTextContent('your plan allows 1,000. 143 used today.');
    expect(budget).not.toHaveClass('is-warning');
    fireEvent.change(screen.getByRole('combobox', { name: 'Minutes between checks' }), { target: { value: '2' } });
    expect(screen.getByTestId('md-budget')).toHaveClass('is-warning');
  });

  it('disconnects through the in-app confirmation, keeping the item map unless asked', async () => {
    const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = api();
    const link = { boardId: '42', boardName: 'Trends', active: true, rev: 4, counts: { onMonday: 3 }, pull: { mode: 'poll', pollMinutes: 5 }, statusLabels: {} };
    render(<ConfirmProvider><MondaySettings state={state({ connected: true, account: { name: 'Studio Bot' }, link, items: {} })} api={calls} /></ConfirmProvider>);
    expect(screen.getByText('Syncing with Trends')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Connection'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
    expect(screen.getByRole('radio', { name: 'Stop syncing this board (keep the token)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Forget which items belong to which trends' })).not.toBeChecked();
    fireEvent.click(within(screen.getByRole('group', { name: 'Disconnect Monday.com' })).getByRole('button', { name: 'Disconnect…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Items on Monday stay as they are.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop syncing' }));
    await waitFor(() => expect(calls.disconnectMonday).toHaveBeenCalledWith({ scope: 'board', forgetItems: false }));
    expect(native).not.toHaveBeenCalled();
  });
});

describe('Monday.com on trend cards and pages', () => {
  const monday = (items) => ({ connected: true, link: { boardId: '42', boardName: 'Trends', boardUrl: 'https://x.monday.com/boards/42', active: true, statusLabels: { approved: 'Approved' }, counts: { failed: 1 }, lastSentAt: new Date().toISOString() }, items });
  const card = { key: 'r1:t1', stage: 'approved' };
  const editor = { role: 'editor', base: 'editor', allowed: ['syncTrendBoardToMonday', 'readMondaySyncLog', 'readMondayItem'] };
  const reader = { role: 'editor', base: 'editor', allowed: ['readMondayItem'] };

  it('shows each item state, with Open in Monday on synced items and Retry only for roles that may sync', async () => {
    const calls = api();
    const { rerender } = render(<ViewerContext.Provider value={editor}><MondayChip monday={monday({ 'r1:t1': { state: 'synced', url: 'https://x.monday.com/boards/42/pulses/1', owner: 'Dana', date: '2026-10-24', notes: 2 } })} card={card} api={calls} /></ViewerContext.Provider>);
    const open = screen.getByRole('link', { name: /Open in Monday/ });
    expect(open).toHaveAttribute('href', 'https://x.monday.com/boards/42/pulses/1');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveTextContent('Monday · Approved');
    expect(screen.getByText('Owner: Dana · Due Oct 24')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2 Monday notes/ }));
    expect(await screen.findByText('Looks good')).toBeInTheDocument();
    rerender(<ViewerContext.Provider value={editor}><MondayChip monday={monday({ 'r1:t1': { state: 'waiting' } })} card={card} api={calls} /></ViewerContext.Provider>);
    expect(screen.getByText('Waiting to send')).toBeInTheDocument();
    rerender(<ViewerContext.Provider value={editor}><MondayChip monday={monday({ 'r1:t1': { state: 'failed', error: 'Monday.com didn’t answer.' } })} card={card} api={calls} /></ViewerContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(calls.syncTrendBoardToMonday).toHaveBeenCalledWith({ keys: ['r1:t1'], force: true });
    rerender(<ViewerContext.Provider value={reader}><MondayChip monday={monday({ 'r1:t1': { state: 'failed' } })} card={card} api={calls} /></ViewerContext.Provider>);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    rerender(<ViewerContext.Provider value={editor}><MondayChip monday={monday({ 'r1:t1': { state: 'removed' } })} card={card} api={calls} /></ViewerContext.Provider>);
    expect(screen.getByText('Removed on Monday')).toBeInTheDocument();
    rerender(<ViewerContext.Provider value={editor}><MondayChip monday={monday({ 'r1:t1': { state: 'conflict' } })} card={card} api={calls} /></ViewerContext.Provider>);
    expect(screen.getByText('Changed on Monday')).toBeInTheDocument();
  });

  it('shows Sync now to editors, Connect only to admins, and switches writes off in a preview', () => {
    const calls = api();
    const { rerender, container } = render(<ViewerContext.Provider value={editor}><MondayStatusLine monday={monday({})} api={calls} /></ViewerContext.Provider>);
    expect(screen.getByRole('status')).toHaveTextContent('1 trend couldn’t send');
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }));
    expect(calls.syncTrendBoardToMonday).toHaveBeenCalledWith({});
    rerender(<ViewerContext.Provider value={editor}><MondayStatusLine monday={{ connected: false, link: null, items: {} }} api={calls} /></ViewerContext.Provider>);
    expect(container).toBeEmptyDOMElement();
    rerender(<ViewerContext.Provider value={{ role: 'admin', base: 'admin' }}><MondayStatusLine monday={{ connected: false, link: null, items: {} }} api={calls} canSetup /></ViewerContext.Provider>);
    expect(screen.getByRole('button', { name: 'Connect Monday.com' })).toBeInTheDocument();
    rerender(<ViewerContext.Provider value={{ ...editor, preview: true, roleAllowed: editor.allowed, allowed: ['readMondaySyncLog'] }}><MondayStatusLine monday={monday({})} api={calls} /></ViewerContext.Provider>);
    expect(screen.getByRole('button', { name: /Sync now/ })).toBeDisabled();
    rerender(<ViewerContext.Provider value={editor}><MondayStatusLine monday={undefined} api={calls} /></ViewerContext.Provider>);
    expect(container).toBeEmptyDOMElement(); // a channel owner's state has no monday
  });
});
