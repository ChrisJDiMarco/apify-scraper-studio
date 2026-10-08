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

  it('opens a research run that started since the last visit and points older runs at the newer one', async () => {
    const runs = [
      { id: 'research-old', kind: 'research', programId: 'p1', name: 'Semrush social trends', createdAt: '2026-09-27T20:42:00Z', updatedAt: '2026-10-07T23:00:00Z', status: 'failed', rowCount: 1632 },
      { id: 'research-new', kind: 'research', programId: 'p1', name: 'Semrush social trends', createdAt: '2026-10-07T22:58:00Z', updatedAt: '2026-10-07T22:58:00Z', status: 'awaiting-review', rowCount: 2469 },
    ];
    // The old run was the last one viewed; a new run has started since.
    window.localStorage.setItem('sheets:lastWorkbook', JSON.stringify('research-old'));
    const bridge = api({ listWorkbooks: vi.fn(async () => runs), readWorkbook: vi.fn(async ({ workbookId }) => ({ ...JSON.parse(JSON.stringify(workbook)), id: workbookId })) });
    await open({ api: bridge });
    await waitFor(() => expect(bridge.readWorkbook).toHaveBeenLastCalledWith({ workbookId: 'research-new' }));
    expect(screen.queryByText(/A newer run of this program started/)).not.toBeInTheDocument();
    cleanup();
    // Opening the older run on purpose shows which run it is and offers the newer one.
    render(<SheetsView api={bridge} state={{}} onNavigate={vi.fn()} initialWorkbookId="research-old" />);
    const note = await screen.findByText(/A newer run of this program started/);
    expect(bridge.readWorkbook).toHaveBeenLastCalledWith({ workbookId: 'research-old' });
    fireEvent.click(within(note.parentElement).getByRole('button', { name: /Open the newer run/ }));
    await waitFor(() => expect(bridge.readWorkbook).toHaveBeenLastCalledWith({ workbookId: 'research-new' }));
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

describe('Sheets export menu', () => {
  const exportMenu = () => { fireEvent.click(screen.getByRole('button', { name: /Export/ })); return screen.getByRole('menu', { name: 'Export' }); };

  it('lists every export, and explains what Create Google Sheet needs when the bridge is not connected', async () => {
    const onNavigate = vi.fn();
    await open({ api: api({ exportWorkbookXlsx: vi.fn(), exportWorkbookToGoogle: vi.fn() }), onNavigate });
    const menu = exportMenu();
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Download workbook (.xlsx)', 'Download this tab (.xlsx)', 'Download this tab (.csv)', 'Copy “Theme Repository” for Google Sheets', 'Create Google Sheet…']);
    expect(within(menu).getByRole('menuitem', { name: 'Download workbook (.xlsx)' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Create Google Sheet…' })).toBeDisabled();
    expect(within(menu).getByText(/Connect the Sheets bridge in Settings → Google Sheets/)).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Open Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
    expect(screen.queryByRole('menu', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('keeps .xlsx downloads to hosts that can save files', async () => {
    await open();
    const menu = exportMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Download workbook (.xlsx)' })).toBeDisabled();
    expect(within(menu).getByText('Excel downloads are available in the desktop app.')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Download this tab (.csv)' })).toBeEnabled();
  });

  it('downloads the whole workbook as .xlsx with edits applied and says where it was saved', async () => {
    const exportWorkbookXlsx = vi.fn(async () => ({ path: '/Users/me/Downloads/Semrush social trends 2026-10-07.xlsx', fileName: 'Semrush social trends 2026-10-07.xlsx', truncatedCells: 0 }));
    const readWorkbook = vi.fn(async () => ({ ...JSON.parse(JSON.stringify(workbook)), edits: { version: 1, sheets: { themes: { t1: { Novelty: 'EVERGREEN' } } } } }));
    await open({ api: api({ exportWorkbookXlsx, readWorkbook }) });
    fireEvent.click(within(exportMenu()).getByRole('menuitem', { name: 'Download workbook (.xlsx)' }));
    await waitFor(() => expect(exportWorkbookXlsx).toHaveBeenCalledTimes(1));
    const payload = exportWorkbookXlsx.mock.calls[0][0];
    expect(payload.name).toBe('Semrush social trends');
    expect(payload.sheets.map((sheet) => sheet.name)).toEqual(['Theme Repository', 'Twitter', 'Theme Summary Data']);
    expect(payload.sheets[0]).toEqual({ name: 'Theme Repository', columns: ['Theme', 'Novelty'], rows: [['Generative Visibility', 'EVERGREEN'], ['Query fan-out', 'NEW TOPIC']] });
    expect(payload.sheets[1]).toMatchObject({ frozenColumns: 1, rows: workbook.sheets[1].rows });
    expect(payload.sheets[2]).toEqual({ name: 'Theme Summary Data', columns: ['Theme', 'Overall Prevalence Score'], rows: [] });
    expect(await screen.findByText('Saved /Users/me/Downloads/Semrush social trends 2026-10-07.xlsx.')).toBeInTheDocument();
  });

  it('downloads only the open tab and stays quiet when the save dialog is cancelled', async () => {
    const exportWorkbookXlsx = vi.fn(async () => null);
    await open({ api: api({ exportWorkbookXlsx }) });
    fireEvent.click(screen.getByRole('tab', { name: /Twitter/ }));
    fireEvent.click(within(exportMenu()).getByRole('menuitem', { name: 'Download this tab (.xlsx)' }));
    await waitFor(() => expect(exportWorkbookXlsx).toHaveBeenCalledWith({ name: 'Semrush social trends - Twitter', sheets: [{ name: 'Twitter', columns: ['post_url', 'post_text', 'likeCount'], rows: workbook.sheets[1].rows, frozenColumns: 1 }] }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Export/ }).querySelector('.spin')).toBeNull());
    expect(screen.queryByText(/^Saved /)).not.toBeInTheDocument();
  });

  it('downloads the file in the page when the host sends it back instead of saving it', async () => {
    const createObjectURL = vi.fn(() => 'blob:fixture'); const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportWorkbookXlsx = vi.fn(async () => ({ fileName: 'Semrush social trends 2026-10-07.xlsx', base64: btoa('PK fixture') }));
    await open({ api: api({ exportWorkbookXlsx }) });
    fireEvent.click(within(exportMenu()).getByRole('menuitem', { name: 'Download workbook (.xlsx)' }));
    await screen.findByText('Saved Semrush social trends 2026-10-07.xlsx.');
    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(blob.size).toBe(10);
  });

  it('creates a Google Sheet through the bridge and offers to open it', async () => {
    const exportWorkbookToGoogle = vi.fn(async (payload) => ({ url: 'https://docs.google.com/spreadsheets/d/abc123/edit', spreadsheetId: 'abc123', title: payload.name, tabCount: 3 }));
    const bridge = api({ exportWorkbookXlsx: vi.fn(), exportWorkbookToGoogle });
    await open({ api: bridge, state: { keys: { GOOGLE_SHEETS_WEBHOOK_URL: true }, settings: { sheets: { sheetsExportFolderId: 'folder_1' } } } });
    fireEvent.click(within(exportMenu()).getByRole('menuitem', { name: 'Create Google Sheet…' }));
    const name = screen.getByLabelText('New Google Sheet name');
    expect(name.value).toMatch(/^Semrush social trends \d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText('A new spreadsheet with all 3 tabs and 5 rows, including your edits, in the Google Sheets exports folder from Settings.')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Golden Thread export' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Google Sheet' }));
    await waitFor(() => expect(exportWorkbookToGoogle).toHaveBeenCalledTimes(1));
    expect(exportWorkbookToGoogle.mock.calls[0][0]).toMatchObject({ name: 'Golden Thread export', sheets: [expect.objectContaining({ name: 'Theme Repository' }), expect.objectContaining({ name: 'Twitter', frozenColumns: 1 }), expect.objectContaining({ name: 'Theme Summary Data' })] });
    expect(await screen.findByText('Created “Golden Thread export” in Google Sheets · 3 tabs.')).toBeInTheDocument();
    expect(screen.queryByLabelText('New Google Sheet name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open in Google Sheets/ }));
    expect(bridge.openSourceUrl).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/abc123/edit');
  });

  it('shows a failed Google export as an error and keeps the form open to try again', async () => {
    const exportWorkbookToGoogle = vi.fn(async () => { throw new Error('Your Google Sheets bridge is an older version. Paste the latest script.'); });
    await open({ api: api({ exportWorkbookToGoogle }), state: { keys: { GOOGLE_SHEETS_WEBHOOK_URL: true } } });
    fireEvent.click(within(exportMenu()).getByRole('menuitem', { name: 'Create Google Sheet…' }));
    expect(screen.getByText(/in your My Drive\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Google Sheet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('older version');
    expect(screen.getByLabelText('New Google Sheet name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Google Sheet' })).toBeEnabled();
  });
});
