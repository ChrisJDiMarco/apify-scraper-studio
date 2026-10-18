// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimpleReports } from '../src/renderer/src/simple-reports.jsx';
import { ContentStudioView } from '../src/renderer/src/content-studio-view.jsx';
import { PREVIEW_TITLE, ViewerContext } from '../src/renderer/src/viewer.js';

// Save to Drive at the top of a report (simple-reports.jsx DriveSaveButton), in Simple's reader and the Advanced
// Library: save once, Update in Drive after an edit, greyed out with the reason while the folder sync adds every report,
// and the way to Settings → Google Drive before Drive is connected.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const DOC = 'https://docs.google.com/document/d/doc-1/edit';
const FOLDER = { id: 'ROOT_FOLDER_1', name: 'Studio reports', url: 'https://drive.google.com/drive/folders/ROOT_FOLDER_1', sharedDrive: false };
const report = { id: 'asset-r1', workspaceId: 'general', title: 'Zero-click report', deliverableId: 'evidence-report', kind: 'text', runId: 'c1', createdAt: '2026-10-17T10:00:00.000Z' };
const drive = (extra = {}) => ({ connected: true, mode: 'service-account', folder: FOLDER, autoAdd: false, ...extra });
const AUTO_TIP = 'Google Drive sync is on. Every report is added to “Studio reports” automatically, and edits update the same Doc.';
const AUTO_NOT_YET = 'Google Drive sync is on. New reports are added to “Studio reports” automatically, and edits update the same Doc. This one isn’t there yet: it goes there after its next edit, or an admin can add older reports with Copy existing reports in Settings → Google Drive.';
const SAVED_TIP = 'This report is in “Studio reports”. Saving again updates the same Doc if anything changed.';
function api(over = {}) {
  return {
    readStudioAsset: vi.fn(async () => ({ markdown: '# Zero-click report\n\nSearches end on the results page.' })), openStudioAsset: vi.fn(), openSourceUrl: vi.fn(),
    saveReportToDrive: vi.fn(async () => ({ ok: true, link: DOC, folderName: 'Studio reports', updated: false })),
    ...over,
  };
}
const viewerWith = (extra = {}) => ({ id: 'member-alex', name: 'Alex', role: 'editor', base: 'editor', allowed: ['readStudioAsset', 'openStudioAsset', 'saveReportToDrive', 'publishStudioRun'], ...extra });
function draw({ services = api(), studio = {}, driveSync = drive(), asset = report, viewer = null, onOpenDriveSettings, onSelect = vi.fn() } = {}) {
  const view = (props) => <SimpleReports api={services} reports={[props.asset]} selectedId={props.asset.id} onSelect={onSelect} action={(fn) => Promise.resolve().then(fn)} busy={false} onFindTrends={vi.fn()} onMakeAssets={vi.fn()} studio={props.studio} drive={props.driveSync} onOpenDriveSettings={onOpenDriveSettings} />;
  const wrap = (props) => (viewer ? <ViewerContext.Provider value={viewer}>{view(props)}</ViewerContext.Provider> : view(props));
  const result = render(wrap({ studio, driveSync, asset }));
  return { ...result, services, redraw: (next) => result.rerender(wrap({ studio, driveSync, asset, ...next })) };
}
const saveButton = () => screen.getByRole('button', { name: /^(Save to Drive|Saving…|Saved to Drive|Update in Drive)$/ });

describe('Save to Drive, with Drive connected and the folder sync off', () => {
  it('sits right after Share, saves the report, shows Saving… then Saved to Drive with Open in Drive and a toast', async () => {
    let finish; const services = api({ saveReportToDrive: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    const { container } = draw({ services });
    const tools = [...container.querySelectorAll('.simple-reader-tools > button, .simple-reader-tools > .studio-menu-wrap > button, .simple-reader-tools > .gd-save > button')].map((node) => node.textContent);
    expect(tools.indexOf('Save to Drive')).toBe(tools.indexOf('Share') + 1);
    const button = saveButton();
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveAccessibleDescription('Adds this report to “Studio reports” as a Google Doc.');
    expect(screen.queryByRole('button', { name: 'Open in Drive' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(services.saveReportToDrive).toHaveBeenCalledWith({ assetId: 'asset-r1' });
    expect(saveButton()).toHaveTextContent('Saving…');
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(saveButton()); // a second press while saving sends nothing
    expect(services.saveReportToDrive).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true, link: DOC, folderName: 'Studio reports', updated: false, unchanged: false }); });
    expect(saveButton()).toHaveTextContent('Saved to Drive');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
    expect(saveButton()).toHaveAccessibleDescription(SAVED_TIP);
    expect(screen.getByRole('status')).toHaveTextContent('Saved to Google Drive, in “Studio reports”.');
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Open in Drive' }));
    expect(services.openSourceUrl).toHaveBeenLastCalledWith(DOC);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Drive' }));
    expect(services.openSourceUrl).toHaveBeenCalledTimes(2);
    // Saved to Drive can be pressed again (the state can lag a live edit by a minute): nothing changed, and it says so.
    fireEvent.click(saveButton());
    expect(services.saveReportToDrive).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ ok: true, link: DOC, folderName: 'Studio reports', updated: false, unchanged: true }); });
    expect(screen.getByRole('status')).toHaveTextContent('Already up to date in “Studio reports”.');
    expect(saveButton()).toHaveTextContent('Saved to Drive');
  });

  it('reads Update in Drive once the report changes after its Doc, and updates that same Doc', async () => {
    const services = api({ saveReportToDrive: vi.fn(async () => ({ ok: true, link: DOC, folderName: 'Studio reports', updated: true })) });
    const { redraw } = draw({ services, studio: { driveLinks: { 'asset-r1': DOC }, driveStale: [] } });
    expect(saveButton()).toHaveTextContent('Saved to Drive');
    expect(saveButton()).toHaveAccessibleDescription(SAVED_TIP);
    // Sam edits the report: the server lists it in driveStale.
    const edited = { ...report, edited: { at: '2026-10-18T09:00:00.000Z', by: { id: 'member-sam', name: 'Sam' } } };
    redraw({ asset: edited, studio: { driveLinks: { 'asset-r1': DOC }, driveStale: ['asset-r1'] } });
    expect(saveButton()).toHaveTextContent('Update in Drive');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
    expect(saveButton()).toHaveAccessibleDescription('The report changed after it was saved. This updates the same Google Doc in “Studio reports”.');
    expect(screen.getByRole('button', { name: 'Open in Drive' })).toBeInTheDocument();
    fireEvent.click(saveButton());
    await screen.findByText('Updated the Google Doc in “Studio reports”.');
    expect(services.saveReportToDrive).toHaveBeenCalledWith({ assetId: 'asset-r1' });
    // Saved here, of this version: up to date even before the state says so.
    expect(saveButton()).toHaveTextContent('Saved to Drive');
    // Another edit after that save: Update in Drive again.
    redraw({ asset: { ...edited, edited: { at: '2026-10-18T09:30:00.000Z', by: { id: 'member-sam', name: 'Sam' } } }, studio: { driveLinks: { 'asset-r1': DOC }, driveStale: ['asset-r1'] } });
    expect(saveButton()).toHaveTextContent('Update in Drive');
  });

  it('says plainly when Drive refuses, and the button can be pressed again', async () => {
    const services = api({ saveReportToDrive: vi.fn(async () => { throw Object.assign(new Error('Google Drive is taking too long to answer. Try again in a minute.'), { status: 504 }); }) });
    draw({ services });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Drive is taking too long to answer. Try again in a minute.');
    expect(saveButton()).toHaveTextContent('Save to Drive');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
  });
});

describe('Save to Drive while the folder sync adds every report', () => {
  it('is greyed out with aria-disabled, explains why on hover and on focus, and does nothing when pressed', () => {
    const { services } = draw({ driveSync: drive({ autoAdd: true }), studio: { driveLinks: { 'asset-r1': DOC } } });
    const button = saveButton();
    expect(button).toHaveTextContent('Save to Drive');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled(); // aria-disabled, not disabled, so hover and focus still work
    expect(button).toHaveAccessibleDescription(AUTO_TIP);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(button.parentElement);
    expect(screen.getByRole('tooltip')).toHaveTextContent(AUTO_TIP);
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.mouseLeave(button.parentElement);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(AUTO_TIP);
    fireEvent.click(button);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
    // Esc hides the tip without leaving the report.
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    fireEvent.blur(button);
    // Open in Drive stays, since the Doc exists.
    fireEvent.click(screen.getByRole('button', { name: 'Open in Drive' }));
    expect(services.openSourceUrl).toHaveBeenCalledWith(DOC);
  });
});

describe('Save to Drive’s tooltip', () => {
  it('says an older report isn’t in Drive yet while the folder sync is on, and how it gets there', () => {
    const { services } = draw({ driveSync: drive({ autoAdd: true }), studio: { driveLinks: {} } });
    const button = saveButton();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(AUTO_NOT_YET);
    fireEvent.mouseEnter(button.parentElement);
    expect(screen.getByRole('tooltip')).toHaveTextContent(AUTO_NOT_YET);
    expect(screen.queryByRole('button', { name: 'Open in Drive' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
  });

  it('stays while the button has focus, and Esc over it hides the tip without leaving the report', () => {
    const onSelect = vi.fn();
    draw({ driveSync: drive({ autoAdd: true }), studio: { driveLinks: { 'asset-r1': DOC } }, onSelect });
    const button = saveButton(); const wrap = button.parentElement;
    // Focus, then the pointer passes over and leaves: focus still holds the tip open.
    fireEvent.focus(button); fireEvent.mouseEnter(wrap); fireEvent.mouseLeave(wrap);
    expect(screen.getByRole('tooltip')).toHaveTextContent(AUTO_TIP);
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // Open from hover alone: Esc (heard by the page, not the button) hides it, and the reader stays on the report.
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    // With the tip hidden, Esc goes back to the list as before.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onSelect).toHaveBeenCalledWith('');
    // Pointing at it again shows it again.
    fireEvent.mouseLeave(wrap); fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('Save to Drive before Drive is connected', () => {
  it('opens Settings → Google Drive for someone who can change Settings', () => {
    const onOpenDriveSettings = vi.fn();
    const { services } = draw({ driveSync: { connected: false, folder: null, autoAdd: false }, onOpenDriveSettings });
    const button = saveButton();
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveAccessibleDescription('Connect Google Drive in Settings first.');
    fireEvent.mouseEnter(button.parentElement);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Connect Google Drive in Settings first.');
    fireEvent.click(button);
    expect(onOpenDriveSettings).toHaveBeenCalledTimes(1);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
  });

  it('is greyed out for everyone else, saying an admin needs to connect it', () => {
    const { services } = draw({ driveSync: { connected: true, folder: null, autoAdd: false }, viewer: viewerWith() });
    const button = saveButton();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('An admin needs to connect Google Drive in Settings → Google Drive.');
    expect(button).toHaveAccessibleDescription('An admin needs to connect Google Drive in Settings → Google Drive.');
    fireEvent.click(button);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
  });

  it('opens Settings → Google Drive from the Advanced Library too', async () => {
    const onOpenTarget = vi.fn(); const services = api();
    const studio = { activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'My brand', editionId: 'general', knowledge: {}, products: [] }], programs: [], researchRuns: [], contentRuns: [{ id: 'c1', workspaceId: 'general', title: 'Zero-click', status: 'succeeded' }], assets: [report], availableDatasets: [], availableReports: [], capabilities: {} };
    render(<ContentStudioView state={{ contentStudio: studio, driveSync: { connected: false, folder: null, autoAdd: false } }} api={services} initialView="library" onNavigate={vi.fn()} onNotice={vi.fn()} onOpenTarget={onOpenTarget} />);
    const button = await screen.findByRole('button', { name: 'Save to Drive' });
    expect(button).toHaveAccessibleDescription('Connect Google Drive in Settings first.');
    fireEvent.click(button);
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'page', page: 'settings', section: 'google-drive' });
  });
});

describe('who sees Save to Drive', () => {
  it('saves from the Library reader too, right after Share, and confirms in the notice line', async () => {
    const services = api(); const onNotice = vi.fn();
    const studio = { activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'My brand', editionId: 'general', knowledge: {}, products: [] }], programs: [], researchRuns: [], contentRuns: [{ id: 'c1', workspaceId: 'general', title: 'Zero-click', status: 'succeeded' }], assets: [report], availableDatasets: [], availableReports: [], capabilities: {}, driveLinks: {}, driveStale: [] };
    const { container } = render(<ContentStudioView state={{ contentStudio: studio, driveSync: drive() }} api={services} initialView="library" onNavigate={vi.fn()} onNotice={onNotice} />);
    const button = await screen.findByRole('button', { name: 'Save to Drive' });
    const tools = [...container.querySelectorAll('.cs-asset-tools button')].map((node) => node.textContent).filter((text) => ['Share', 'Save to Drive'].includes(text));
    expect(tools).toEqual(['Share', 'Save to Drive']);
    fireEvent.click(button);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Saved to Google Drive, in “Studio reports”.'));
    expect(screen.getByRole('button', { name: 'Saved to Drive' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Open in Drive' })).toBeInTheDocument();
  });

  it('shows a refusal in the Library as an alert, not as a confirmation', async () => {
    const services = api({ saveReportToDrive: vi.fn(async () => { throw Object.assign(new Error('Google Drive is taking too long to answer. Try again in a minute.'), { status: 504 }); }) });
    const onNotice = vi.fn();
    const studio = { activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'My brand', editionId: 'general', knowledge: {}, products: [] }], programs: [], researchRuns: [], contentRuns: [{ id: 'c1', workspaceId: 'general', title: 'Zero-click', status: 'succeeded' }], assets: [report], availableDatasets: [], availableReports: [], capabilities: {}, driveLinks: {}, driveStale: [] };
    render(<ContentStudioView state={{ contentStudio: studio, driveSync: drive() }} api={services} initialView="library" onNavigate={vi.fn()} onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save to Drive' }));
    expect((await screen.findByText('Google Drive is taking too long to answer. Try again in a minute.')).closest('[role="alert"]')).toBeInTheDocument();
    expect(onNotice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save to Drive' })).not.toHaveAttribute('aria-disabled');
  });

  it('gets the Semrush Library’s pill look like its neighbours, though it sits in a wrapper', () => {
    const css = fs.readFileSync(path.resolve('src/renderer/src/content-studio.css'), 'utf8');
    expect(css).toContain('.content-studio[data-edition="semrush"] .cs-asset-tools > :is(button, .gd-save > button) { border: 1px solid var(--cs-border); border-radius: 999px;');
  });

  it('waits for Save while the Library’s older editor is open', async () => {
    const services = api({ editStudioAsset: vi.fn(async () => ({ asset: report })) });
    const studio = { activeWorkspaceId: 'general', workspaces: [{ id: 'general', name: 'My brand', editionId: 'general', knowledge: {}, products: [] }], programs: [], researchRuns: [], contentRuns: [{ id: 'c1', workspaceId: 'general', title: 'Zero-click', status: 'succeeded' }], assets: [report], availableDatasets: [], availableReports: [], capabilities: {}, driveLinks: {}, driveStale: [] };
    render(<ContentStudioView state={{ contentStudio: studio, driveSync: drive() }} api={services} initialView="library" onNavigate={vi.fn()} onNotice={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Save to Drive' })).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const button = screen.getByRole('button', { name: 'Save to Drive' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Save your edits first.');
    fireEvent.click(button);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
  });

  it('is not offered to a role without Export and publish, which keeps Open in Drive', () => {
    draw({ viewer: viewerWith({ allowed: ['readStudioAsset', 'openStudioAsset'] }), studio: { driveLinks: { 'asset-r1': DOC } } });
    expect(screen.queryByRole('button', { name: /Save to Drive|Update in Drive|Saved to Drive/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in Drive' })).toBeInTheDocument();
  });

  it('is not offered for drafts or channel assets, only the reports Drive gets', () => {
    draw({ asset: { ...report, id: 'asset-d1', deliverableId: 'blogshort' } });
    expect(screen.queryByRole('button', { name: 'Save to Drive' })).not.toBeInTheDocument();
    cleanup();
    draw({ asset: { ...report, id: 'asset-k1', deliverableId: 'editorial-toolkit', runId: 'kit-1' }, studio: { contentRuns: [{ id: 'kit-1', kit: { reportAssetId: 'asset-r1' } }] } });
    expect(screen.queryByRole('button', { name: 'Save to Drive' })).not.toBeInTheDocument();
    cleanup();
    draw({ asset: { ...report, id: 'asset-s1', deliverableId: 'scan-report' } });
    expect(saveButton()).toHaveTextContent('Save to Drive');
  });

  it('shows the previewed role’s button greyed out in an admin’s preview', () => {
    const { services } = draw({ viewer: viewerWith({ preview: true, realRole: 'admin', allowed: ['readStudioAsset'], roleAllowed: ['readStudioAsset', 'saveReportToDrive'] }) });
    const button = saveButton();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(PREVIEW_TITLE);
    fireEvent.click(button);
    expect(services.saveReportToDrive).not.toHaveBeenCalled();
  });
});
