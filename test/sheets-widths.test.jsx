// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetsView } from '../src/renderer/src/sheets-view.jsx';

// Column widths are remembered per workbook tab, merged with the ones saved earlier, and a resize never breaks the page.
let values;
beforeEach(() => {
  values = new Map([['sheets:widths:import-1:s1', JSON.stringify({ Volume: 210 })]]);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), clear: () => values.clear() } });
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Sheets column widths', () => {
  it('saves an auto-fit width alongside the widths remembered before', async () => {
    const workbook = { id: 'import-1', kind: 'import', name: 'Q3 keywords', source: { kind: 'file', fileName: 'q3.xlsx' }, edits: { version: 1, sheets: {} }, sheets: [{ id: 's1', name: 'Sheet1', columns: ['Keyword', 'Volume'], rows: [['ai search visibility tracking', '1200']], rowKeys: ['r1'] }] };
    const api = { listWorkbooks: vi.fn(async () => [{ id: 'import-1', kind: 'import', name: 'Q3 keywords', sheetCount: 1, rowCount: 1 }]), readWorkbook: vi.fn(async () => JSON.parse(JSON.stringify(workbook))), saveWorkbookEdits: vi.fn(async () => ({})) };
    render(<SheetsView api={api} state={{}} onNavigate={vi.fn()} initialWorkbookId="import-1" />);
    await screen.findByRole('grid');
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize column A' }));
    await waitFor(() => expect(JSON.parse(values.get('sheets:widths:import-1:s1'))).toEqual({ Volume: 210, Keyword: expect.any(Number) }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});
