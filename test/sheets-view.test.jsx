// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetsView } from '../src/renderer/src/sheets-view.jsx';

beforeEach(() => {
  const values = new Map();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), clear: () => values.clear() } });
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const workbook = {
  id: 'research-1', name: 'Semrush social trends', kind: 'research', status: 'succeeded', edits: { version: 1, sheets: {} },
  sheets: [
    { id: 'themes', name: 'Theme Repository', columns: ['Theme', 'Novelty'], rows: [['Generative Visibility', 'NEW ANGLE'], ['Query fan-out', 'NEW TOPIC']], rowKeys: ['t1', 't2'] },
    { id: 'x', name: 'Twitter', columns: ['post_url', 'post_text', 'likeCount'], rows: [['https://x.com/a/1', 'AI Overviews tripled', '100'], ['https://x.com/b/2', 'Reporting is manual', '4'], ['https://x.com/c/3', 'GEO is the new SEO', '12']], rowKeys: ['e1', 'e2', 'e3'], frozenColumns: 1 },
    { id: 'summary', name: 'Theme Summary Data', columns: ['Theme', 'Overall Prevalence Score'], rows: [], rowKeys: [], empty: { title: 'Theme totals appear after tagging', detail: 'Approve themes, then continue the run.' } },
  ],
};
function api(overrides = {}) {
  return {
    listWorkbooks: vi.fn(async () => [{ id: 'research-1', kind: 'research', name: 'Semrush social trends', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', status: 'succeeded', rowCount: 3 }]),
    readWorkbook: vi.fn(async () => JSON.parse(JSON.stringify(workbook))),
    saveWorkbookEdits: vi.fn(async () => ({ savedAt: 'now' })),
    importWorkbook: vi.fn(async () => null), pullGoogleSheet: vi.fn(), removeWorkbook: vi.fn(), renameWorkbook: vi.fn(), openSourceUrl: vi.fn(),
    ...overrides,
  };
}
async function open(props = {}) {
  const bridge = props.api || api();
  render(<SheetsView api={bridge} state={{}} onNavigate={vi.fn()} {...props} />);
  await screen.findByRole('grid');
  return bridge;
}
const grid = () => screen.getByRole('grid');
const nameBox = () => screen.getByLabelText('Selected cell');
const cell = (text) => within(grid()).getByText(text).closest('[role="gridcell"]');

describe('Sheets view', () => {
  it('opens the newest workbook on its first tab with rows and shows every tab along the bottom', async () => {
    await open();
    expect(screen.getByRole('button', { name: /Semrush social trends/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Theme Repository2', 'Twitter3', 'Theme Summary Data']);
    expect(screen.getByRole('tab', { name: /Theme Repository/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(grid()).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Theme', 'Novelty']);
    expect(screen.getByText('2 rows')).toBeInTheDocument();
  });

  it('selects cells with the mouse and keyboard and names them like the Google Sheet', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Twitter/ }));
    fireEvent.mouseDown(cell('AI Overviews tripled'), { button: 0 });
    expect(nameBox()).toHaveTextContent('B2');
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    fireEvent.keyDown(grid(), { key: 'ArrowRight' });
    expect(nameBox()).toHaveTextContent('C3');
    expect(screen.getByLabelText('likeCount value')).toHaveValue('4');
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
    expect(nameBox()).toHaveTextContent('C3:C4');
    // The status bar adds up a numeric selection the way Sheets does.
    expect(screen.getByText('Sum').parentElement).toHaveTextContent('Sum 16');
    expect(screen.getByText('Count').parentElement).toHaveTextContent('Count 2');
  });

  it('edits by typing, saves on its own, and undoes', async () => {
    const bridge = await open();
    fireEvent.mouseDown(cell('NEW ANGLE'), { button: 0 });
    fireEvent.keyDown(grid(), { key: 'E' });
    const editor = screen.getByLabelText('Edit Novelty');
    fireEvent.change(editor, { target: { value: 'EVERGREEN' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(cell('EVERGREEN')).toHaveClass('edited');
    expect(nameBox()).toHaveTextContent('B3');
    await waitFor(() => expect(bridge.saveWorkbookEdits).toHaveBeenCalledWith({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: { t1: { Novelty: 'EVERGREEN' } } } } }), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(grid()).queryByText('EVERGREEN')).not.toBeInTheDocument();
    expect(cell('NEW ANGLE')).not.toHaveClass('edited');
    await waitFor(() => expect(bridge.saveWorkbookEdits).toHaveBeenLastCalledWith({ workbookId: 'research-1', edits: { version: 1, sheets: { themes: {} } } }), { timeout: 2000 });
  });

  it('copies a selection as tab-separated cells that paste straight into Google Sheets', async () => {
    await open();
    fireEvent.mouseDown(cell('Generative Visibility'), { button: 0 });
    fireEvent.mouseDown(cell('NEW TOPIC'), { button: 0, shiftKey: true });
    const data = new Map();
    fireEvent.copy(grid(), { clipboardData: { setData: (type, value) => data.set(type, value) } });
    expect(data.get('text/plain')).toBe('Generative Visibility\tNEW ANGLE\nQuery fan-out\tNEW TOPIC');
    expect(data.get('text/html')).toContain('<td>Query fan-out</td>');
    // Selecting a whole column brings its header along, like copying a column in Sheets.
    fireEvent.mouseDown(within(grid()).getByText('A'), { button: 0 });
    fireEvent.copy(grid(), { clipboardData: { setData: (type, value) => data.set(type, value) } });
    expect(data.get('text/plain')).toBe('Theme\nGenerative Visibility\nQuery fan-out');
  });

  it('pastes a block of cells from the clipboard into place', async () => {
    const bridge = await open();
    fireEvent.mouseDown(cell('Generative Visibility'), { button: 0 });
    fireEvent.paste(grid(), { clipboardData: { getData: () => 'GEO\tNEW TOPIC\nAEO\tEVERGREEN' } });
    expect(cell('GEO')).toHaveClass('edited');
    expect(cell('AEO')).toBeInTheDocument();
    expect(nameBox()).toHaveTextContent('A2:B3');
    await waitFor(() => expect(bridge.saveWorkbookEdits).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('finds text across the sheet and steps through the matches', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Twitter/ }));
    fireEvent.keyDown(grid(), { key: 'f', metaKey: true });
    const find = screen.getByLabelText('Find in sheet');
    await waitFor(() => expect(find).toHaveFocus());
    fireEvent.change(find, { target: { value: 'r' } });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(nameBox()).toHaveTextContent('B2');
    expect(cell('AI Overviews tripled')).toHaveClass('find-active');
    fireEvent.keyDown(find, { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(nameBox()).toHaveTextContent('B3');
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(within(grid()).queryAllByRole('gridcell').some((node) => node.classList.contains('find-hit'))).toBe(false);
  });

  it('explains an empty tab in place, under its real headers', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Theme Summary Data/ }));
    expect(screen.getByText('Theme totals appear after tagging')).toBeInTheDocument();
    expect(within(grid()).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Theme', 'Overall Prevalence Score']);
  });

  it('welcomes a first visit with ways to start', async () => {
    const bridge = api({ listWorkbooks: vi.fn(async () => []) });
    const onNavigate = vi.fn();
    render(<SheetsView api={bridge} state={{}} onNavigate={onNavigate} />);
    expect(await screen.findByRole('heading', { name: 'Your research, as a spreadsheet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start a research run/ }));
    expect(onNavigate).toHaveBeenCalledWith('research-programs');
    fireEvent.click(screen.getByRole('button', { name: /Import .xlsx or .csv/ }));
    await waitFor(() => expect(bridge.importWorkbook).toHaveBeenCalledWith({}));
  });
});
