// @vitest-environment jsdom
import './helpers/prosemirror-dom.js';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimpleReports } from '../src/renderer/src/simple-reports.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';

// Simple's Reports on a studio with the live report editor: the reader is the editor, rows count open notes.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const report = { id: 'asset-r1', title: 'Zero-click report', deliverableId: 'evidence-report', kind: 'text', runId: 'c1', createdAt: '2026-10-17T10:00:00.000Z' };
const MARKDOWN = '# Zero-click report\n\nSearches end on the results page.';
function api(over = {}) {
  return {
    readStudioAsset: vi.fn(async () => ({ markdown: MARKDOWN })), openStudioAsset: vi.fn(), editStudioAsset: vi.fn(),
    openReportDoc: vi.fn(async () => ({ markdown: MARKDOWN, yState: '', versions: [], canEdit: true, canNote: true, editors: [] })),
    pushReportDocUpdate: vi.fn(async () => ({ version: 2, savedAt: '2026-10-18T10:00:00.000Z' })), closeReportDoc: vi.fn(async () => ({ ok: true })),
    listReportNotes: vi.fn(async () => ({ notes: [{ id: 'n1', assetId: report.id, anchor: { yStart: '', yEnd: '', quote: 'results page' }, author: { id: 'member-sam', name: 'Sam' }, body: 'Source?', mentions: [], createdAt: '2026-10-17T11:00:00.000Z', resolved: null, replies: [] }] })),
    saveReportNote: vi.fn(), resolveReportNote: vi.fn(), deleteReportNote: vi.fn(),
    ...over,
  };
}
const draw = (props, viewer) => { const view = <SimpleReports reports={[report]} onSelect={vi.fn()} action={(fn) => Promise.resolve().then(fn)} busy={false} onFindTrends={vi.fn()} onMakeAssets={vi.fn()} studio={{ noteCounts: { [report.id]: { open: 1, total: 2 } } }} web {...props} />; return render(viewer ? <ViewerContext.Provider value={viewer}>{view}</ViewerContext.Provider> : view); };

describe('Simple Reports with the live editor', () => {
  it('counts open notes on a report’s row', () => {
    draw({ api: api(), selectedId: '' });
    expect(screen.getByRole('button', { name: /Zero-click report/ })).toHaveTextContent('1 open note');
  });

  it('reads and edits on one page: no Edit button, autosave, and the Notes panel', async () => {
    const services = api();
    draw({ api: services, selectedId: report.id });
    const box = await screen.findByRole('textbox', { name: 'Text of Zero-click report' });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await waitFor(() => expect(box.editor).toBeTruthy());
    act(() => { box.editor.chain().focus('end').insertContent(' Clicks fell.').run(); });
    await waitFor(() => expect(services.pushReportDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ assetId: report.id, markdown: `${MARKDOWN} Clicks fell.` })), { timeout: 4000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Notes, 1 open' }));
    expect(within(screen.getByRole('complementary', { name: 'Notes' })).getByText('Source?')).toBeInTheDocument();
  }, 10000);

  it('stays read-only for a role without edit rights', async () => {
    draw({ api: api({ openReportDoc: vi.fn(async () => ({ markdown: MARKDOWN, yState: '', versions: [], canEdit: false, canNote: false, editors: [] })) }), selectedId: report.id }, { id: 'member-v', role: 'editor', base: 'editor', allowed: ['readStudioAsset', 'openStudioAsset', 'openReportDoc', 'closeReportDoc', 'listReportNotes'] });
    expect(await screen.findByRole('document', { name: 'Zero-click report' })).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('textbox', { name: /Text of/ })).not.toBeInTheDocument();
  });

  it('keeps the old reader and its Edit button on a studio without the live editor', async () => {
    const services = api({ openReportDoc: undefined });
    draw({ api: services, selectedId: report.id });
    expect(await screen.findByText('Searches end on the results page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Text of/ })).not.toBeInTheDocument();
  });
});
