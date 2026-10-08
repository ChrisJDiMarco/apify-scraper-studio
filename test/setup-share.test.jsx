// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupShare } from '../src/renderer/src/setup-share.jsx';

afterEach(cleanup);
const summary = {
  exportedAt: '2026-10-08T12:00:00.000Z', appVersion: '0.2.0',
  workspace: { name: 'Semrush workspace', editionLabel: 'Semrush', knowledgeFields: ['audience', 'voice'], products: { total: 10, enterprise: ['A', 'B', 'C'], selfServe: ['D', 'E', 'F', 'G', 'H', 'I', 'J'], general: [] }, taxonomy: { categories: 22, source: 'Golden Thread' }, referenceDocs: [{ kind: 'icp', title: 'ICP', characters: 5000 }, { kind: 'registry', title: 'Registry', characters: 16000 }] },
  programs: [{ id: 'p1', name: 'Weekly listening', action: 'add', sources: { x: 382, linkedin: 515, reddit: 18 }, budgets: { collectionUsd: 120, aiUsd: 120 }, targetPerPlatform: 1000, schedule: { frequency: 'weekly', label: 'Every Monday at 09:00', arrivesPaused: true } }],
  changes: ['Replaces the brand knowledge, product registry, taxonomy and reference documents of “Semrush workspace”.', 'Adds 1 program.'],
};
const opened = (extra = {}) => ({ token: 'preview-1', fileName: 'Semrush workspace setup 2026-10-08.json', summary, warnings: ['This file carries an Apify token. Treat it like a password.'], apifyTokenIncluded: true, apifyTokenSaved: false, ...extra });

describe('Share your setup', () => {
  it('exports with the shared Apify token only when asked', async () => {
    const api = { openSetupFile: vi.fn(), applySetup: vi.fn(), exportSetup: vi.fn(async () => ({ fileName: 'Semrush workspace setup 2026-10-08.json', summary, includesApifyToken: true })) };
    render(<SetupShare api={api} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Include the shared Apify token/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export setup…/ }));
    await waitFor(() => expect(api.exportSetup).toHaveBeenCalledWith({ includeApifyToken: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Semrush workspace setup 2026-10-08.json1 research program · 10 products · includes the Apify token.');
  });
  it('previews a file in full, then imports it and saves the token when chosen', async () => {
    const onImported = vi.fn(); const onOpenPrograms = vi.fn();
    const api = { exportSetup: vi.fn(), openSetupFile: vi.fn(async () => opened()), applySetup: vi.fn(async () => ({ fileName: opened().fileName, summary, programIds: ['p1'], apifyTokenSaved: true })) };
    render(<SetupShare api={api} onImported={onImported} onOpenPrograms={onOpenPrograms} />);
    fireEvent.click(screen.getByRole('button', { name: /Import setup…/ }));
    const preview = await screen.findByRole('region', { name: 'Setup to import' });
    expect(preview).toHaveTextContent('10 products · 3 Enterprise · 7 self-serve');
    expect(preview).toHaveTextContent('22 categories');
    expect(preview).toHaveTextContent('382 X accounts · 515 LinkedIn accounts · 18 subreddits · 1,000 posts per platform · $120 collection + $120 AI per run · Every Monday at 09:00 · arrives paused');
    expect(preview).toHaveTextContent('Adds 1 program.');
    expect(preview).toHaveTextContent('Treat it like a password.');
    expect(within(preview).getByRole('checkbox', { name: /Save the Apify token from this file/ })).toBeChecked();
    fireEvent.click(within(preview).getByRole('button', { name: /Import this setup/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith({ token: 'preview-1', saveApifyToken: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported Semrush workspace setup 2026-10-08.json');
    expect(onImported).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Research programs' }));
    expect(onOpenPrograms).toHaveBeenCalled();
  });
  it('leaves an existing Apify token alone unless asked, and shows file errors', async () => {
    const api = { exportSetup: vi.fn(), openSetupFile: vi.fn(async () => opened({ apifyTokenSaved: true })), applySetup: vi.fn(async () => ({ fileName: 'x.json', summary, programIds: [] })) };
    render(<SetupShare api={api} mode="import" />);
    expect(screen.getByText('Got a setup file from your team?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import setup…/ }));
    const preview = await screen.findByRole('region', { name: 'Setup to import' });
    const keep = within(preview).getByRole('checkbox', { name: /replaces the one saved on this Mac/ });
    expect(keep).not.toBeChecked();
    fireEvent.click(within(preview).getByRole('button', { name: /Import this setup/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith({ token: 'preview-1', saveApifyToken: false }));
    const failing = { exportSetup: vi.fn(), applySetup: vi.fn(), openSetupFile: vi.fn(async () => { throw new Error('This file is not a Scraper Studio setup.'); }) };
    cleanup(); render(<SetupShare api={failing} />);
    fireEvent.click(screen.getByRole('button', { name: /Import setup…/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a Scraper Studio setup.');
  });
  it('renders nothing without the desktop bridge', () => {
    const { container } = render(<SetupShare api={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
