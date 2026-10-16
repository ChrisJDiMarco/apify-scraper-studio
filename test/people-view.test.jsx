// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeopleView, linkMessage, linkStatus } from '../src/renderer/src/people-view.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const later = new Date(Date.now() + 25 * 86400000).toISOString();
const members = () => [
  { id: 'm-chris', name: 'Chris DiMarco', email: 'chris@semrush.com', role: 'admin', channelId: null, disabled: false, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-10-15T09:00:00.000Z', serverAdmin: true, link: null },
  { id: 'm-ana', name: 'Ana Ortiz', email: 'ana@semrush.com', role: 'admin', channelId: null, disabled: false, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-10-15T09:00:00.000Z', serverAdmin: false, link: null },
  { id: 'm-alex', name: 'Alex Smith', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false, createdAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-10-14T09:00:00.000Z', serverAdmin: false, link: { createdAt: '2026-10-12T09:00:00.000Z', expiresAt: later, lastUsedAt: '2026-10-14T09:00:00.000Z' } },
  { id: 'm-riley', name: 'Riley Jones', email: 'riley@semrush.com', role: 'editor', channelId: null, disabled: false, createdAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '', serverAdmin: false, link: null },
];
const channels = [{ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'm-alex', name: 'Alex Smith' }] }, { id: 'social', name: 'Semrush Social Team', short: 'Social', owners: [] }];
const team = (over = {}) => ({ members: members(), channels, signIn: { web: true, sso: false, links: true, linkDays: 30 }, ...over });
const api = (over = {}) => ({ getTeam: vi.fn(async () => team()), saveMember: vi.fn(async (input) => ({ member: { id: input.id || 'm-new', ...input } })), removeMember: vi.fn(async () => ({ ok: true })), createSignInLink: vi.fn(async () => ({ url: 'https://studio.semrush.com/#signin=abc123', expiresAt: later })), revokeSignInLink: vi.fn(async () => ({ ok: true })), ...over });
const ana = { id: 'm-ana', name: 'Ana Ortiz', role: 'admin', realRole: 'admin', preview: false };
const row = (name) => screen.getByText(name, { selector: 'strong' }).closest('li');
const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));

describe('PeopleView on the web', () => {
  it('shows who owns each channel, and Assign starts a channel owner for that channel', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={ana} />);
    const coverage = await screen.findByRole('region', { name: 'Channels' });
    expect(within(coverage).getByText('1 of 2 channels have an owner')).toBeInTheDocument();
    expect(within(coverage).getByText('Alex Smith')).toBeInTheDocument();
    expect(within(coverage).getByText('No owner yet')).toBeInTheDocument();
    fireEvent.click(within(coverage).getByRole('button', { name: 'Assign an owner to Semrush Social Team' }));
    const sheet = screen.getByRole('dialog', { name: 'Add a person' });
    expect(within(sheet).getByRole('radio', { name: /Channel owner/ })).toBeChecked();
    expect(within(sheet).getByRole('combobox', { name: 'Channel' })).toHaveValue('social');
    expect(within(sheet).getByLabelText('Name')).toHaveFocus();
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Pat Lee' } });
    fireEvent.change(within(sheet).getByLabelText('Work email'), { target: { value: 'pat@semrush.com' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(services.saveMember).toHaveBeenCalledWith({ name: 'Pat Lee', email: 'pat@semrush.com', role: 'channel', channelId: 'social', disabled: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Pat Lee is added. Make their sign-in link to send it.')).toBeInTheDocument();
  });

  it('describes each role, shows errors inline and keeps what was typed', async () => {
    const services = api({ saveMember: vi.fn(async () => { throw new Error('Someone already uses that email.'); }) });
    render(<PeopleView api={services} web viewer={ana} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a person/ }));
    const sheet = screen.getByRole('dialog', { name: 'Add a person' });
    expect(within(sheet).getByRole('radio', { name: /Editor/ })).toHaveAccessibleName(/Finds trends, writes and edits reports, makes assets for any channel\./);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add person' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Add their name.');
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Pat Lee' } });
    fireEvent.change(within(sheet).getByLabelText('Work email'), { target: { value: 'pat' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add person' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('That doesn’t look like an email address.');
    fireEvent.change(within(sheet).getByLabelText('Work email'), { target: { value: 'pat@semrush.com' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: /Channel owner/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add person' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Choose their channel.');
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Channel' }), { target: { value: 'blog' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add person' }));
    expect(await within(sheet).findByText('Someone already uses that email.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Pat Lee');
  });

  it('lists people with role, channel, last seen and link status', async () => {
    render(<PeopleView api={api()} web viewer={ana} />);
    await screen.findByRole('region', { name: /People/ });
    const alex = row('Alex Smith');
    expect(within(alex).getByText('Channel owner')).toBeInTheDocument();
    expect(within(alex).getByText('Semrush Blog')).toBeInTheDocument();
    expect(within(alex).getByText(`Link made ${day('2026-10-12T09:00:00.000Z')} · works until ${day(later)} · used ${day('2026-10-14T09:00:00.000Z')}`)).toBeInTheDocument();
    expect(within(row('Riley Jones')).getByText('Never signed in')).toBeInTheDocument();
    expect(within(row('Ana Ortiz (you)')).getByText('Admin')).toBeInTheDocument();
  });

  it('never offers Remove or Disable for yourself, the last admin, or an admin set by the server', async () => {
    render(<PeopleView api={api()} web viewer={ana} />);
    await screen.findByRole('region', { name: /People/ });
    expect(within(row('Chris DiMarco')).getByText('Set by the server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Chris DiMarco' })).not.toBeInTheDocument();
    openMenu('Ana Ortiz');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openMenu('Alex Smith');
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeInTheDocument();
    cleanup();
    // Pat is the only enabled admin and isn't the one signed in (the shared admin password).
    const solo = api({ getTeam: vi.fn(async () => team({ members: [{ ...members()[1], id: 'm-pat', name: 'Pat Admin' }, members()[2]] })) });
    render(<PeopleView api={solo} web viewer={{ id: 'owner', name: 'Studio admin', role: 'admin', realRole: 'admin' }} />);
    await screen.findByRole('region', { name: /People/ });
    openMenu('Pat Admin');
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('confirms before replacing a link, then shows it ready to copy and paste', async () => {
    const services = api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PeopleView api={services} web viewer={ana} />);
    await screen.findByRole('region', { name: /People/ });
    openMenu('Alex Smith');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make a new sign-in link' }));
    expect(confirm).toHaveBeenCalledWith('Alex’s current link will stop working, and anyone signed in with it is signed out.');
    await waitFor(() => expect(services.createSignInLink).toHaveBeenCalledWith({ id: 'm-alex' }));
    const panel = await screen.findByRole('region', { name: 'Sign-in link for Alex Smith' });
    expect(within(panel).getByRole('textbox', { name: 'Sign-in link for Alex Smith' })).toHaveValue('https://studio.semrush.com/#signin=abc123');
    const message = `Here’s your sign-in link for the Semrush research studio: https://studio.semrush.com/#signin=abc123. It works until ${day(later)}. Open it in your work browser.`;
    expect(within(panel).getByText(message)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: /Copy message/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
  });

  it('turns off a link, disables gently and removes only after confirming', async () => {
    const services = api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PeopleView api={services} web viewer={ana} />);
    await screen.findByRole('region', { name: /People/ });
    openMenu('Alex Smith');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn off link' }));
    await waitFor(() => expect(services.revokeSignInLink).toHaveBeenCalledWith({ id: 'm-alex' }));
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(services.saveMember).toHaveBeenCalledWith({ id: 'm-riley', name: 'Riley Jones', email: 'riley@semrush.com', role: 'editor', channelId: null, disabled: true }));
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('To stop access for a while instead, disable them.'));
    await waitFor(() => expect(services.removeMember).toHaveBeenCalledWith({ id: 'm-riley' }));
  });

  it('starts with three steps when you’re the only person', async () => {
    render(<PeopleView api={api({ getTeam: vi.fn(async () => team({ members: [members()[1]] })) })} web viewer={ana} />);
    const first = await screen.findByRole('region', { name: 'Bring your team in' });
    expect(first).toHaveTextContent('Add a person');
    expect(first).toHaveTextContent('Choose their role and channel');
    expect(first).toHaveTextContent('Send their sign-in link');
    fireEvent.click(within(first).getByRole('button', { name: /Add a person/ }));
    expect(screen.getByRole('dialog', { name: 'Add a person' })).toBeInTheDocument();
  });
});

describe('PeopleView on the Mac', () => {
  it('explains that only you use this Mac and offers previews instead of Add person', async () => {
    const onPreview = vi.fn();
    render(<PeopleView api={api()} web={false} viewer={{ ...ana, channels }} onPreview={onPreview} />);
    expect(await screen.findByText('People sign in to the browser version of the studio. On this Mac you’re the only user and always an admin. To check what someone else sees, use View as in the sidebar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a person/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview what Semrush Blog’s owner sees' }));
    expect(onPreview).toHaveBeenCalledWith('blog');
    fireEvent.click(screen.getByRole('button', { name: /Preview as an editor/ }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});

describe('people helpers', () => {
  it('words link status and the message to send', () => {
    expect(linkStatus({ link: null, lastSeenAt: '' })).toBe('Never signed in');
    expect(linkStatus({ link: null, lastSeenAt: '2026-10-14T09:00:00.000Z' }, { links: true })).toBe('No link');
    expect(linkStatus({ link: { createdAt: '2026-10-12T09:00:00.000Z', expiresAt: null, lastUsedAt: '' } })).toBe(`Link made ${day('2026-10-12T09:00:00.000Z')} · never expires · not used yet`);
    expect(linkStatus({ link: { createdAt: '2026-01-12T09:00:00.000Z', expiresAt: '2026-02-11T09:00:00.000Z' } })).toMatch(/^Link expired /);
    expect(linkMessage({ url: 'https://x.test/#signin=1', expiresAt: null })).toBe('Here’s your sign-in link for the research studio: https://x.test/#signin=1. It doesn’t expire. Open it in your work browser.');
  });
});
