// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, MoreMenu, NoAccess, PreviewBanner } from '../src/renderer/src/role-screens.jsx';
import { LOCAL_ADMIN_FALLBACK, adminNames, can, previewWho, roleLabel } from '../src/renderer/src/viewer.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const admins = [{ name: 'Chris DiMarco' }, { name: 'Alex Smith' }];

describe('NoAccess', () => {
  it('names the admins to ask, checks again, and copies the email', async () => {
    const onRetry = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<NoAccess viewer={{ email: 'pat@semrush.com', role: null }} admins={admins} onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: 'You’re not in this studio yet' })).toBeInTheDocument();
    expect(screen.getByText(/You’re signed in as/)).toHaveTextContent('You’re signed in as pat@semrush.com. Ask Chris DiMarco or Alex Smith to add you, then press Check again.');
    expect(screen.queryByRole('button', { name: /Sign out/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
    expect(screen.getByRole('button', { name: /Checking…/ })).toBeDisabled();
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent('Still no access. Once Chris DiMarco or Alex Smith adds you, press Check again.');
    fireEvent.click(screen.getByRole('button', { name: /Copy my email/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('pat@semrush.com'));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  it('falls back to “a studio admin” and offers Sign out only when the session allows it', () => {
    const onSignOut = vi.fn();
    render(<NoAccess email="pat@semrush.com" admins={[]} canSignOut onSignOut={onSignOut} onRetry={() => {}} />);
    expect(screen.getByText(/Ask a studio admin to add you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('tells a disabled member their access is paused', () => {
    render(<NoAccess viewer={{ email: 'pat@semrush.com', role: null, disabled: true }} admins={[admins[0]]} onRetry={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Your access is paused' })).toBeInTheDocument();
    expect(screen.getByText('Your access to this studio is paused. Ask Chris DiMarco if you need it back.')).toBeInTheDocument();
  });
});

describe('PreviewBanner', () => {
  it('stays out of the way unless an admin is previewing', () => {
    const { container } = render(<PreviewBanner viewer={LOCAL_ADMIN_FALLBACK} onBack={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says whose view this is, takes focus, announces it and goes back to Admin', () => {
    vi.useFakeTimers();
    const onBack = vi.fn();
    const viewer = { role: 'channel', realRole: 'admin', channelId: 'blog', channelName: 'Semrush Blog', preview: true };
    render(<PreviewBanner viewer={viewer} onBack={onBack} />);
    const banner = screen.getByText('Previewing what Semrush Blog’s channel owner sees. Buttons that change things are off.').closest('[role="status"]');
    expect(banner).toHaveFocus();
    act(() => { vi.advanceTimersByTime(100); });
    expect(within(banner).getByText('Now previewing as Semrush Blog’s channel owner.')).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: 'Back to Admin' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('names an editor preview plainly', () => {
    render(<PreviewBanner viewer={{ role: 'editor', realRole: 'admin', preview: true }} onBack={() => {}} />);
    expect(screen.getByText('Previewing what an editor sees. Buttons that change things are off.')).toBeInTheDocument();
  });
});

describe('Dialog and MoreMenu', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button type="button" onClick={() => setOpen(true)}>Open it</button>{open && <Dialog labelledBy="t" onClose={() => setOpen(false)}><h2 id="t">A dialog</h2><button type="button">First</button><button type="button">Last</button></Dialog>}</>;
  }
  it('moves focus in, keeps Tab inside, closes on Esc and gives focus back', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'A dialog' });
    expect(dialog).toHaveFocus();
    screen.getByRole('button', { name: 'Last' }).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('opens a menu with arrow keys and closes it on Esc', () => {
    const onSelect = vi.fn();
    render(<MoreMenu label="More for “AI”" items={[{ label: 'Change link', onSelect }, false, { label: 'Change my answer', onSelect: () => {} }]} />);
    const button = screen.getByRole('button', { name: 'More for “AI”' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
    expect(within(menu).getByRole('menuitem', { name: 'Change link' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Change my answer' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change link' }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('viewer helpers', () => {
  it('lets the fallback admin call everything and a projected viewer only what it was given', () => {
    expect(can(LOCAL_ADMIN_FALLBACK, 'saveSettings')).toBe(true);
    expect(can(undefined, 'saveSettings')).toBe(true);
    expect(can({ allowed: ['state', 'askHelp'] }, 'askHelp')).toBe(true);
    expect(can({ allowed: ['state'] }, 'saveSettings')).toBe(false);
  });
  it('names roles, previews and admins in plain words', () => {
    expect(roleLabel('channel')).toBe('Channel owner');
    expect(roleLabel(null)).toBe('No access');
    expect(previewWho({ role: 'channel', channelName: 'Semrush Blog' })).toBe('Semrush Blog’s channel owner');
    expect(adminNames({ team: { admins: [{ name: 'Chris' }, { name: 'Pat' }, { name: 'Alex' }] } })).toBe('Chris, Pat or Alex');
    expect(adminNames({ team: { admins: [] } })).toBe('an admin');
  });
});
