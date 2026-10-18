// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveSettings, driveStatus } from '../src/renderer/src/drive-settings.jsx';
import { DriveOpenButton } from '../src/renderer/src/simple-reports.jsx';
import { SETTINGS_SECTION_IDS, sectionId, sectionStatus } from '../src/renderer/src/settings-sections.js';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';

// Settings → Google Drive (drive-settings.jsx), its nav dot, and Open in Drive on reports.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const EMAIL = 'studio-sync@studio-fixture.iam.gserviceaccount.com';
const FOLDER = { id: 'ROOT_FOLDER_1', name: 'Studio reports', url: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1', sharedDrive: true };
const api = (extra = {}) => ({
  connectDriveSync: vi.fn(async ({ serviceAccountKey }) => { if (!serviceAccountKey.includes('service_account')) throw new Error('That JSON isn’t a service account key (its "type" should be "service_account").'); return { ok: true, email: EMAIL }; }),
  saveDriveSync: vi.fn(async (payload) => ({ driveSync: { folder: payload.folder ? FOLDER : null } })),
  testDriveSync: vi.fn(async () => ({ ok: true, message: 'Working. The studio can add files to “Studio reports”.' })),
  startDriveBackfill: vi.fn(async () => ({ jobId: 'drive-copy-1', total: 12 })),
  retryDriveSync: vi.fn(async () => ({ kind: 'added' })),
  disconnectDriveSync: vi.fn(async () => ({ driveSync: {} })),
  readDriveSyncLog: vi.fn(async () => ({ rows: [
    { id: 'r2', at: '2026-10-18T11:59:00Z', kind: 'failed', assetId: 'asset-1', title: 'Local SEO this week', where: 'Quick scan · local SEO', error: 'Google Drive is limiting requests right now.' },
    { id: 'r1', at: '2026-10-18T11:00:00Z', kind: 'added', assetId: 'asset-2', title: 'AI Overviews — Trends report', where: '2026-10-14 · Weekly SEO pulse / AI Overviews', url: 'https://docs.google.com/document/d/doc-2/edit' },
  ] })),
  cancelJob: vi.fn(async () => true),
  ...extra,
});
const state = (driveSync) => ({ driveSync, keys: {}, keyProblems: {} });

describe('Settings → Google Drive', () => {
  it('connects a service account from a pasted JSON key, and says plainly when the key is wrong', async () => {
    const calls = api();
    render(<DriveSettings state={state({ connected: false })} api={calls} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/IAM & Admin → Service accounts/)).toBeInTheDocument();
    const field = screen.getByLabelText(/Service account JSON key/);
    fireEvent.change(field, { target: { value: '{"type":"authorized_user"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t a service account key');
    fireEvent.change(field, { target: { value: '{"type":"service_account"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`Connected as ${EMAIL}. Share your Drive folder with this address as Editor`);
    expect(calls.connectDriveSync).toHaveBeenLastCalledWith({ serviceAccountKey: '{"type":"service_account"}' });
    // The access token stays available as the fallback.
    expect(screen.getByText('Use an access token instead')).toBeInTheDocument();
  });

  it('shows the service account address to share with, and checks a pasted folder link', async () => {
    const calls = api();
    render(<DriveSettings state={state({ connected: true, mode: 'service-account', email: EMAIL, folder: null, rev: 3 })} api={calls} />);
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Share your Drive folder with this address as Editor/)).toBeInTheDocument();
    expect(screen.getByText('Choose a folder')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Drive folder link/), { target: { value: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The studio can add files to “Studio reports”.');
    expect(calls.saveDriveSync).toHaveBeenCalledWith({ folder: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1', rev: 3 });
  });

  it('turns on the studio-wide switch and channel assets, tests the folder and copies existing reports', async () => {
    const calls = api();
    render(<DriveSettings state={state({ connected: true, mode: 'service-account', email: EMAIL, folder: FOLDER, autoAdd: false, includeChannelAssets: false, rev: 4, files: 0, migratedPrograms: 2 })} api={calls} />);
    expect(screen.getByRole('link', { name: /Studio reports/ })).toHaveAttribute('href', FOLDER.url);
    expect(screen.getByText(/Turned on for you because 2 research programs had “Publish reports to Google Drive” on/)).toBeInTheDocument();
    expect(screen.getByText(/one folder per research run, named by date and program; quick scans as “Quick scan · topic”/)).toBeInTheDocument();
    expect(screen.getByText(/Google Doc, converted from the report/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Add every new report to Drive/ }));
    await waitFor(() => expect(calls.saveDriveSync).toHaveBeenCalledWith({ autoAdd: true, rev: 4 }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Include channel assets/ }));
    await waitFor(() => expect(calls.saveDriveSync).toHaveBeenCalledWith({ includeChannelAssets: true, rev: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Working. The studio can add files to “Studio reports”.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy existing reports' }));
    expect(await screen.findByText(/Copying 12 files to Drive/)).toBeInTheDocument();
  });

  it('shows a copy in progress with Cancel, which stops the job', async () => {
    const calls = api();
    render(<DriveSettings state={state({ connected: true, mode: 'service-account', email: EMAIL, folder: FOLDER, autoAdd: true, backfill: { jobId: 'drive-copy-1', total: 40, done: 12, failed: 1 } })} api={calls} />);
    expect(screen.getByText('Copying… 12 of 40 · 1 failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(calls.cancelJob).toHaveBeenCalledWith('drive-copy-1'));
  });

  it('lists the sync log with Retry on a failed file, and disconnects after confirming', async () => {
    const calls = api();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DriveSettings state={state({ connected: true, mode: 'service-account', email: EMAIL, folder: FOLDER, autoAdd: true, failed: 1, files: 1, lastError: 'Google Drive is limiting requests right now.' })} api={calls} />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(calls.readDriveSyncLog).not.toHaveBeenCalled(); // read only when opened
    const details = screen.getByText(/Sync log · 1 file to retry/).closest('details');
    details.open = true; fireEvent(details, new Event('toggle'));
    const log = await screen.findByRole('list', { name: 'Google Drive sync log' });
    expect(within(log).getByText('AI Overviews — Trends report')).toBeInTheDocument();
    expect(within(log).getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://docs.google.com/document/d/doc-2/edit');
    fireEvent.click(within(log).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.retryDriveSync).toHaveBeenCalledWith({ assetId: 'asset-1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('“Local SEO this week” is in Drive now.');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(calls.disconnectDriveSync).toHaveBeenCalled());
    expect(window.confirm.mock.calls[0][0]).toMatch(/Disconnect Google Drive\?[\s\S]*Files already in Drive stay there/);
  });

  it('is a Settings section with a status dot, reachable by its old #/settings/drive name', () => {
    expect(SETTINGS_SECTION_IDS.indexOf('google-drive')).toBeLessThan(SETTINGS_SECTION_IDS.indexOf('google-docs'));
    expect(sectionId('drive')).toBe('google-drive');
    const ctx = (driveSync, keyProblems = {}) => ({ state: { driveSync, keyProblems }, web: false, has: {} });
    expect(sectionStatus('google-drive', ctx({}))).toEqual({ tone: 'neutral', label: 'Optional' });
    expect(sectionStatus('google-drive', ctx({ connected: true }))).toEqual({ tone: 'attention', label: 'Choose a folder' });
    expect(sectionStatus('google-drive', ctx({ connected: true, folder: FOLDER, autoAdd: true }))).toEqual({ tone: 'ready', label: 'Syncing' });
    expect(sectionStatus('google-drive', ctx({ connected: true, folder: FOLDER, autoAdd: false }))).toEqual({ tone: 'neutral', label: 'Switch off' });
    expect(sectionStatus('google-drive', ctx({ connected: true, folder: FOLDER, autoAdd: true, failed: 2 }))).toEqual({ tone: 'problem', label: 'Some files failed' });
    expect(sectionStatus('google-drive', ctx({}, { GOOGLE_DRIVE_SERVICE_ACCOUNT: 'mismatch' })).tone).toBe('problem');
    expect(driveStatus({ connected: true, folder: FOLDER, autoAdd: true })).toEqual(['ready', 'Syncing']);
  });

  it('renders inside Settings for admins only', () => {
    const settingsState = { ...state({ connected: false }), settings: {}, contentStudio: {} };
    const { unmount } = render(<SettingsView role="admin" state={settingsState} meta={{ runtime: 'web' }} setupApi={api()} narrow />);
    expect(screen.getByRole('heading', { name: 'Google Drive' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste the whole JSON file here')).toBeInTheDocument();
    unmount();
    render(<SettingsView role="editor" state={settingsState} meta={{}} setupApi={api()} narrow />);
    expect(screen.queryByRole('heading', { name: 'Google Drive' })).not.toBeInTheDocument();
  });
});

describe('Open in Drive on reports', () => {
  it('shows only when the report is in Drive, and opens its Doc', () => {
    const openSourceUrl = vi.fn();
    const studio = { driveLinks: { 'asset-2': 'https://docs.google.com/document/d/doc-2/edit' } };
    const { rerender } = render(<DriveOpenButton api={{ openSourceUrl }} studio={studio} assetId="asset-1" />);
    expect(screen.queryByRole('button', { name: /Open in Drive/ })).not.toBeInTheDocument();
    rerender(<DriveOpenButton api={{ openSourceUrl }} studio={studio} assetId="asset-2" />);
    fireEvent.click(screen.getByRole('button', { name: /Open in Drive/ }));
    expect(openSourceUrl).toHaveBeenCalledWith('https://docs.google.com/document/d/doc-2/edit');
    rerender(<DriveOpenButton api={{ openSourceUrl }} studio={{ driveLinks: { 'asset-3': 'javascript:alert(1)' } }} assetId="asset-3" />);
    expect(screen.queryByRole('button', { name: /Open in Drive/ })).not.toBeInTheDocument();
  });
});
