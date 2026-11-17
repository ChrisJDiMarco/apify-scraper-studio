// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTour, tourKey, tourSteps } from '../src/renderer/src/workspace-tour.jsx';

afterEach(cleanup);
const workspace = { id: 'adobe', name: 'Adobe' };
const viewer = (over = {}) => ({ id: 'member-sam', workspaceId: 'adobe', role: 'channel', roleId: 'channel', channelName: 'Social', prefs: {}, ...over });
const pages = ['programs', 'trends', 'assets', 'mychannel', 'ask'];

describe('workspace and role walkthrough', () => {
  it('navigates through the channel workflow without offering workspace administration', () => {
    const open = vi.fn();
    render(<WorkspaceTour viewer={viewer()} workspace={workspace} pages={pages} onOpenPage={open} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Adobe' })).toHaveTextContent('Channel owner');
    fireEvent.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    expect(screen.getByRole('region', { name: 'Workspace walkthrough' })).toHaveTextContent('Adobe');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(open).toHaveBeenLastCalledWith('programs');
    expect(screen.getByRole('region')).toHaveTextContent('Read the research programs');
    expect(tourSteps(viewer(), pages).map((step) => step.page)).not.toContain('people');
  });

  it('keeps completion independent for each workspace, person and role, and allows replay', async () => {
    const save = vi.fn(async () => ({}));
    const { rerender } = render(<WorkspaceTour viewer={viewer()} workspace={workspace} pages={pages} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ workspaceTours: { 'adobe:channel': expect.any(String) } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    window.dispatchEvent(new Event('golden-thread-replay-tour'));
    expect(await screen.findByRole('dialog', { name: 'Welcome to Adobe' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    rerender(<WorkspaceTour viewer={viewer()} workspace={{ id: 'semrush', name: 'Semrush' }} pages={pages} onSave={save} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Semrush' })).toBeInTheDocument();
    rerender(<WorkspaceTour viewer={viewer({ id: 'member-riley' })} workspace={workspace} pages={pages} onSave={save} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Adobe' })).toBeInTheDocument();
    expect(tourKey(viewer({ roleId: 'editor' }), workspace)).toBe('adobe:editor');
  });

  it('does not automatically interrupt previews and never writes preview completion', async () => {
    const save = vi.fn();
    render(<WorkspaceTour viewer={viewer({ preview: true })} workspace={workspace} pages={pages} onSave={save} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    window.dispatchEvent(new Event('golden-thread-replay-tour'));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the walkthrough open with an error when completion cannot be saved', async () => {
    render(<WorkspaceTour viewer={viewer()} workspace={workspace} pages={pages} onSave={vi.fn(async () => { throw new Error('Try again'); })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('finishes the actual page walkthrough and tailors its instructions to granted actions', async () => {
    const save = vi.fn(async () => ({})); const open = vi.fn();
    render(<WorkspaceTour viewer={viewer()} workspace={workspace} pages={pages} onOpenPage={open} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(open.mock.calls.map(([page]) => page)).toEqual(['programs', 'trends', 'assets', 'mychannel', 'ask']);
    fireEvent.click(screen.getByRole('button', { name: 'Finish walkthrough' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ workspaceTours: { 'adobe:channel': expect.any(String) } }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    const restricted = tourSteps(viewer({ allowed: ['state'] }), ['trends', 'assets']);
    expect(restricted.find((step) => step.page === 'trends').text).toContain('can view this board');
    expect(restricted.find((step) => step.page === 'assets').title).toBe('Review your assets');
  });
});
