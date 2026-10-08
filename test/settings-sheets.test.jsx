// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';

const state = (overrides = {}) => ({ keys: {}, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [], ...overrides });
afterEach(cleanup);

describe('Google Drive folder settings', () => {
  it('saves folders for trend reports, toolkits, other Docs and Sheets exports with the bridge settings', async () => {
    const onSaveSettings = vi.fn(async (settings) => settings);
    render(<SettingsView state={state({ keys: { GOOGLE_SHEETS_WEBHOOK_URL: true }, settings: { maxItems: 1000, sheets: { archiveFolderId: 'archive_1', docsFolderId: 'docs_1' } } })} meta={{}} onSaveSettings={onSaveSettings} />);
    fireEvent.click(screen.getByText('Google Sheets'));
    expect(screen.getByRole('textbox', { name: 'Default Docs folder' })).toHaveValue('docs_1');
    expect(screen.getByText('Folder where new trend reports are created, like n8n’s ‘New Trends Output’.')).toBeInTheDocument();
    expect(screen.getByText(/creates native Google Docs through this bridge/)).toBeInTheDocument();
    expect(screen.getByText(/this token is only needed for imports/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Trend reports folder' }), { target: { value: 'https://drive.google.com/drive/folders/trends_1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Google Sheets exports folder' }), { target: { value: 'exports_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet settings' }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith({ sheets: expect.objectContaining({ archiveFolderId: 'archive_1', docsFolderId: 'docs_1', trendReportsFolderId: 'https://drive.google.com/drive/folders/trends_1', toolkitsFolderId: '', sheetsExportFolderId: 'exports_1' }) }));
  });

  it('explains how to publish Docs without a token when the bridge is not connected', () => {
    render(<SettingsView state={state({ sheetRuns: [{ id: 'sheet-1', kind: 'workbook-export', status: 'succeeded', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit' }] })} meta={{}} onSaveSettings={vi.fn()} />);
    expect(screen.getByText(/Save the webhook URL above to publish reports as Google Docs without an access token/)).toBeInTheDocument();
    expect(screen.queryByText(/this token is only needed for imports/)).not.toBeInTheDocument();
    expect(screen.getByText('https://docs.google.com/spreadsheets/d/abc123/edit')).toBeInTheDocument(); // the export's receipt links its sheet
  });
});
