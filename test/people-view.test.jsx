// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PeopleView, linkMessage, linkStatus } from '../src/renderer/src/people-view.jsx';
import { filterPeople, lastActive } from '../src/renderer/src/people-table.jsx';
import { parseEmails } from '../src/renderer/src/invite-dialog.jsx';
import { capabilityRules, setPersonState } from '../src/renderer/src/person-sheet.jsx';
import { accessLogCsv } from '../src/renderer/src/access-log.jsx';
import roles from '../src/main/roles.js';
import teamStoreModule from '../src/main/team-store.js';

// Node 25+ ships its own localStorage global, which is undefined without --localstorage-file and hides jsdom's, so the
// remembered tab gets an in-memory store (as sheets-widths does).
const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key), clear: () => stored.clear() } });

// The access summary comes from the real team store, so the page sees exactly what getTeam sends.
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'people-view-'));
afterAll(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
const store = teamStoreModule.createTeamStore({ root: storeRoot });
const viewerRole = store.saveRole({ label: 'Viewer', base: 'editor', template: 'viewer', rev: 0 }, { id: 'owner', name: 'Studio admin' }).role;
const ACCESS = store.accessSummary();
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const later = new Date(Date.now() + 25 * 86400000).toISOString();
const policy = store.accessPolicy();
const person = (fields) => { const def = policy.roles.get(fields.role); return { email: '', channelId: null, disabled: false, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '', serverAdmin: false, link: null, grants: [], denies: [], ...fields, roleLabel: def.label, base: def.base, capabilities: roles.capabilitiesFor({ roleId: fields.role, grants: fields.grants || [], denies: fields.denies || [] }, policy) }; };
const members = () => [
  person({ id: 'm-jordan', name: 'Jordan Server', email: 'jordan@semrush.com', role: 'admin', lastSeenAt: '2026-10-15T09:00:00.000Z', serverAdmin: true }),
  person({ id: 'm-sam', name: 'Sam Admin', email: 'sam@semrush.com', role: 'admin', lastSeenAt: '2026-10-15T09:00:00.000Z' }),
  person({ id: 'm-alex', name: 'Alex Smith', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', createdAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-10-14T09:00:00.000Z', link: { createdAt: '2026-10-12T09:00:00.000Z', expiresAt: later, lastUsedAt: '2026-10-14T09:00:00.000Z' } }),
  person({ id: 'm-riley', name: 'Riley Jones', email: 'riley@semrush.com', role: 'editor', createdAt: '2026-09-01T00:00:00.000Z', denies: ['askAi'] }),
];
const channels = [{ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [{ id: 'm-alex', name: 'Alex Smith' }] }, { id: 'social', name: 'Semrush Social Team', short: 'Social', owners: [] }];
const team = (over = {}) => ({ members: members(), channels, signIn: { web: true, sso: false, links: true, linkDays: 30 }, access: ACCESS, ...over });
const api = (over = {}) => ({
  getTeam: vi.fn(async () => team()), saveMember: vi.fn(async (input) => ({ member: { id: input.id || 'm-new', ...input } })), removeMember: vi.fn(async () => ({ ok: true })),
  createSignInLink: vi.fn(async () => ({ url: 'https://studio.semrush.com/#signin=abc123', expiresAt: later })), revokeSignInLink: vi.fn(async () => ({ ok: true })),
  inviteMembers: vi.fn(async ({ people }) => ({ members: people.map((entry, index) => ({ id: `m-new-${index}`, name: entry.name || 'Pat Lee', email: entry.email })), links: people.map((entry, index) => ({ id: `m-new-${index}`, url: `https://studio.semrush.com/#signin=new${index}`, expiresAt: later })), skipped: [], signIn: { web: true, sso: false, links: true } })),
  saveMemberAccess: vi.fn(async ({ id, grants, denies }) => ({ member: { id, grants, denies } })), previewAccess: vi.fn(async () => ({ capabilities: [], can: [], cannot: [], possible: 22 })),
  saveRolePolicy: vi.fn(async () => ({ access: ACCESS, affected: 1 })), saveRole: vi.fn(async () => ({ role: viewerRole, access: ACCESS })), deleteRole: vi.fn(async () => ({ ok: true, moved: 0, access: ACCESS })),
  readAccessLog: vi.fn(async ({ before }) => (before ? { rows: [{ id: 'audit-1', at: '2026-10-10T10:00:00.000Z', by: { name: 'Sam' }, kind: 'member-added', text: 'Sam added Riley Jones as Editor', changes: [], affected: 1 }], more: false, next: '' } : { rows: [{ id: 'audit-2', at: '2026-10-17T10:42:00.000Z', by: { name: 'Sam' }, kind: 'policy-changed', text: 'Sam turned off Edit AI prompts for Editor', changes: [{ field: 'capability', capability: 'editPrompts', from: true, to: false }], affected: 4 }], more: true, next: 'audit-2' })),
  ...over,
});
const sam = { id: 'm-sam', name: 'Sam Admin', role: 'admin', realRole: 'admin', base: 'admin', preview: false };
const row = (name) => screen.getByText(name, { selector: 'strong' }).closest('tr');
const openMenu = (name) => fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

describe('People & access: the People tab', () => {
  it('says which channels have no owner, and Assign invites a channel owner for that channel', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={sam} />);
    const strip = await screen.findByRole('region', { name: 'Channel owners' });
    expect(strip).toHaveTextContent('1 channel has no owner:');
    expect(strip).toHaveTextContent('Semrush Social Team');
    fireEvent.click(within(strip).getByRole('button', { name: 'Assign an owner to Semrush Social Team' }));
    const dialog = screen.getByRole('dialog', { name: 'Invite people' });
    expect(within(dialog).getByRole('radio', { name: /^Channel owner/ })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Channel' })).toHaveValue('social');
    expect(within(dialog).getByRole('textbox', { name: 'Work emails' })).toHaveFocus();
  });

  it('lists people in a table with role, custom access, channel, last active and sign-in', async () => {
    render(<PeopleView api={api()} web viewer={sam} />);
    await screen.findByRole('table');
    const alex = row('Alex Smith');
    expect(within(alex).getByText('Channel owner')).toBeInTheDocument();
    expect(within(alex).getByText('Semrush Blog')).toBeInTheDocument();
    expect(within(alex).getByText(`Link made ${day('2026-10-12T09:00:00.000Z')} · works until ${day(later)} · used ${day('2026-10-14T09:00:00.000Z')}`)).toBeInTheDocument();
    const riley = row('Riley Jones');
    expect(within(riley).getAllByText('Never signed in').length).toBeGreaterThan(0);
    expect(within(riley).getByRole('button', { name: /Custom access for Riley Jones: 1 turned off/ })).toHaveTextContent('Custom access −1');
    expect(within(row('Sam Admin (you)')).getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('4 people')).toBeInTheDocument();
  });

  it('searches, filters and clears', async () => {
    render(<PeopleView api={api()} web viewer={sam} />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), { target: { value: 'riley' } });
    expect(screen.getByText('4 people, 1 shown')).toBeInTheDocument();
    expect(screen.queryByText('Alex Smith', { selector: 'strong' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'channel' } });
    expect(screen.getByText('No one matches.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('4 people')).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Role' })).getByRole('option', { name: 'Viewer (0)' })).toBeInTheDocument();
  });

  it('never offers Remove or Disable for yourself, the last admin, or an admin set by the server', async () => {
    render(<PeopleView api={api()} web viewer={sam} />);
    await screen.findByRole('table');
    expect(within(row('Jordan Server')).getByText('Set by the server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Jordan Server' })).not.toBeInTheDocument();
    openMenu('Sam Admin');
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Change access' })).not.toBeInTheDocument(); // admins have everything
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openMenu('Alex Smith');
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeInTheDocument();
    cleanup();
    // Sam is the only enabled admin and isn't the one signed in (the shared admin password).
    const solo = api({ getTeam: vi.fn(async () => team({ members: [members()[1], members()[2]] })) });
    render(<PeopleView api={solo} web viewer={{ id: 'owner', name: 'Studio admin', role: 'admin', realRole: 'admin' }} />);
    await screen.findByRole('table');
    openMenu('Sam Admin');
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('confirms before replacing a link, then shows it ready to copy and paste', async () => {
    const services = api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openMenu('Alex Smith');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make a new sign-in link' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Alex’s current link will stop working, and anyone signed in with it is signed out.')));
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
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openMenu('Alex Smith');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn off link' }));
    await waitFor(() => expect(services.revokeSignInLink).toHaveBeenCalledWith({ id: 'm-alex' }));
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(services.saveMember).toHaveBeenCalledWith({ id: 'm-riley', name: 'Riley Jones', email: 'riley@semrush.com', role: 'editor', channelId: null, disabled: true }));
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('To stop access for a while instead, disable them.')));
    await waitFor(() => expect(services.removeMember).toHaveBeenCalledWith({ id: 'm-riley' }));
    confirm.mockReturnValue(false);
    openMenu('Alex Smith');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(4));
    expect(services.removeMember).toHaveBeenCalledTimes(1);
  });

  it('starts with three steps when you’re the only person', async () => {
    render(<PeopleView api={api({ getTeam: vi.fn(async () => team({ members: [members()[1]] })) })} web viewer={sam} />);
    const first = await screen.findByRole('region', { name: 'Bring your team in' });
    expect(first).toHaveTextContent('Invite people');
    expect(first).toHaveTextContent('Choose their role and channel');
    expect(first).toHaveTextContent('Send their sign-in link');
    fireEvent.click(within(first).getByRole('button', { name: /Invite people/ }));
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();
  });

  it('opens Invite once when asked from elsewhere (New › Person)', async () => {
    const { rerender } = render(<PeopleView api={api()} web viewer={sam} request={{ kind: 'invite', key: 1 }} />);
    expect(await screen.findByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<PeopleView api={api()} web viewer={sam} request={{ kind: 'invite', key: 1 }} />);
    expect(screen.queryByRole('dialog', { name: 'Invite people' })).not.toBeInTheDocument();
  });
});

describe('Invite people', () => {
  it('turns pasted addresses into rows, flags the ones it can’t add, and invites the rest in one call', async () => {
    const services = api();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PeopleView api={services} web viewer={sam} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invite people/ }));
    const dialog = screen.getByRole('dialog', { name: 'Invite people' });
    const box = within(dialog).getByRole('textbox', { name: 'Work emails' });
    fireEvent.change(box, { target: { value: 'pat.lee@semrush.com, riley@semrush.com, nope, ' } });
    const rows = within(within(dialog).getByRole('list', { name: 'People to invite' })).getAllByRole('listitem');
    expect(rows.map((item) => item.textContent)).toEqual(['pat.lee@semrush.com', 'riley@semrush.comAlready in the studio', 'nopeNot an email address']);
    expect(within(dialog).getByRole('textbox', { name: 'Name for pat.lee@semrush.com (optional)' })).toHaveAttribute('placeholder', 'Pat Lee');
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Viewer/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    await waitFor(() => expect(services.inviteMembers).toHaveBeenCalledWith({ people: [{ email: 'pat.lee@semrush.com' }], role: viewerRole.id }));
    const result = await screen.findByRole('dialog', { name: '1 person invited' });
    fireEvent.click(within(result).getByRole('button', { name: 'Copy Pat Lee’s link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://studio.semrush.com/#signin=new0'));
  });

  it('asks for the channel of a channel role, and can adjust access for everyone it invites', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={sam} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invite people/ }));
    const dialog = screen.getByRole('dialog', { name: 'Invite people' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Work emails' }), { target: { value: 'social.lead@semrush.com ' } }); // a new address (Jordan is already in the studio)
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Channel owner/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the channel they own.');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Channel' }), { target: { value: 'social' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adjust access' }));
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: /^Make channel assets/ })).getByRole('radio', { name: 'Off' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    await waitFor(() => expect(services.inviteMembers).toHaveBeenCalledWith({ people: [{ email: 'social.lead@semrush.com' }], role: 'channel', channelId: 'social', grants: [], denies: ['makeAssets'] }));
  });

  it('with company sign-in, says where they sign in instead of giving links', async () => {
    const services = api({ getTeam: vi.fn(async () => team({ signIn: { web: true, sso: true, links: false } })), inviteMembers: vi.fn(async () => ({ members: [{ id: 'm-1', name: 'Pat Lee', email: 'pat@semrush.com' }], links: [], skipped: [], signIn: { sso: true } })) });
    render(<PeopleView api={services} web viewer={sam} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invite people/ }));
    const dialog = screen.getByRole('dialog', { name: 'Invite people' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Work emails' }), { target: { value: 'pat@semrush.com ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    const result = await screen.findByRole('dialog', { name: '1 person invited' });
    expect(result).toHaveTextContent('They can sign in at');
    expect(within(result).getByRole('button', { name: /Copy invite message/ })).toBeInTheDocument();
  });
});

describe('The person sheet', () => {
  it('saves details through saveMember and access through saveMemberAccess, only what changed', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change access' }));
    const sheet = screen.getByRole('dialog', { name: 'Riley Jones' });
    expect(within(sheet).getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getByText('Only admins can have “Settings and connections”.')).toBeInTheDocument();
    const ask = within(sheet).getByRole('radiogroup', { name: /^Use Ask AI/ });
    expect(within(ask).getByRole('radio', { name: 'Off' })).toBeChecked();
    // Turning off See research and evidence turns off what needs it, and says so.
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: /^See research and evidence/ })).getByRole('radio', { name: 'Off' }));
    expect(within(sheet).getByText(/Also turned off: .*Start research/)).toBeInTheDocument();
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: /^See research and evidence/ })).getByRole('radio', { name: /Role default/ }));
    fireEvent.click(within(ask).getByRole('radio', { name: /Role default/ }));
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: /^See team analytics/ })).getByRole('radio', { name: 'On' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(services.saveMemberAccess).toHaveBeenCalledTimes(1));
    expect(services.saveMemberAccess.mock.calls[0][0]).toMatchObject({ id: 'm-riley', grants: ['seeAnalytics'] });
    expect(services.saveMember).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Riley Jones' })).not.toBeInTheDocument());
  });

  it('edits details, shows role cards with what each can do, and shows errors inline', async () => {
    const services = api({ saveMember: vi.fn(async () => { throw new Error('Someone in the studio already uses that email.'); }) });
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    const sheet = screen.getByRole('dialog', { name: 'Riley Jones' });
    expect(within(sheet).getByLabelText('Name')).toHaveFocus();
    expect(within(sheet).getByRole('radio', { name: /^Editor/ })).toHaveAccessibleName(/Finds trends, writes and edits reports, makes assets for any channel\./);
    expect(within(sheet).getByRole('radio', { name: /^Viewer/ })).toHaveAccessibleName(/Can: See research and evidence, Read reports and assets/);
    fireEvent.change(within(sheet).getByLabelText('Work email'), { target: { value: 'riley' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('That doesn’t look like an email address.');
    fireEvent.change(within(sheet).getByLabelText('Work email'), { target: { value: 'sam@semrush.com' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(await within(sheet).findByText('Someone in the studio already uses that email.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Work email')).toHaveValue('sam@semrush.com');
  });
});

describe('The Roles tab', () => {
  it('shows Admin locked, explains locked rows, cascades a change and saves every change in one call', async () => {
    const services = api();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openTab('Roles');
    const table = screen.getByRole('table', { name: 'What each role can do' });
    expect(within(table).getByRole('columnheader', { name: /Admin/ })).toHaveTextContent('Everything. Can’t be changed.');
    expect(within(table).getByRole('switch', { name: /^Admin: Start research\. On\./ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(table).getByRole('switch', { name: /^Editor: Settings and connections\. Off\. Only admins can have/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(table).getByRole('switch', { name: /^Channel owner: Use Ask AI\. Off\. Channel owners see only their channel/ })).toBeInTheDocument();
    const research = within(table).getByRole('switch', { name: 'Editor: See research and evidence' });
    expect(research).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(research);
    expect(research).toHaveAttribute('aria-checked', 'false');
    expect(within(table).getByRole('switch', { name: /^Editor: Start research, not saved yet/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(table).getByText(/Editor: also turned off .*Start research/)).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Unsaved role changes' });
    expect(bar).toHaveTextContent(/\d+ changes · affects 1 person/);
    fireEvent.click(within(bar).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('region', { name: 'Unsaved role changes' })).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole('switch', { name: 'Editor: See team analytics' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Unsaved role changes' })).getByRole('button', { name: 'Review and save' }));
    await waitFor(() => expect(services.saveRolePolicy).toHaveBeenCalledWith({ rev: ACCESS.rev, builtIn: { editor: { grant: ['seeAnalytics'], deny: [] } } }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Editor: turns on See team analytics'));
  });

  it('says who saved first when the policy changed underneath, with Reload', async () => {
    const services = api({ saveRolePolicy: vi.fn(async () => { throw Object.assign(new Error('Alex changed roles at Oct 17, 10:42 AM, after you opened them. Reload to see the latest.'), { status: 409, code: 'policyConflict' }); }) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openTab('Roles');
    fireEvent.click(screen.getByRole('switch', { name: 'Channel owner: Make channel assets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }));
    expect(await screen.findByText(/Alex changed roles at .*Reload to see the latest\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(services.getTeam).toHaveBeenCalledTimes(2));
  });

  it('makes a new role from a template', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openTab('Roles');
    fireEvent.click(screen.getByRole('button', { name: 'New role' }));
    const dialog = screen.getByRole('dialog', { name: 'New role' });
    fireEvent.change(within(dialog).getByLabelText('Role name'), { target: { value: 'Reviewers' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Channel reviewer/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make role' }));
    await waitFor(() => expect(services.saveRole).toHaveBeenCalledWith({ label: 'Reviewers', description: '', base: 'channel', template: 'channel-reviewer', rev: ACCESS.rev }));
  });
});

describe('The Access log tab', () => {
  it('reads sentences, opens a row to its changes, and pages back with Load older', async () => {
    const services = api();
    render(<PeopleView api={services} web viewer={sam} />);
    await screen.findByRole('table');
    openTab('Access log');
    const list = await screen.findByRole('list', { name: 'Access log' });
    expect(list).toHaveTextContent('Sam turned off Edit AI prompts for Editor · affects 4 people ·');
    fireEvent.click(within(list).getByRole('button', { name: 'Show 1 change' }));
    expect(within(list).getByText('Edit AI prompts: On → Off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(services.readAccessLog).toHaveBeenLastCalledWith({ limit: 50, before: 'audit-2' }));
    expect(await screen.findByText('Sam added Riley Jones as Editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'What' }), { target: { value: 'roles' } });
    await waitFor(() => expect(services.readAccessLog).toHaveBeenLastCalledWith({ limit: 50, kinds: ['role-created', 'role-changed', 'role-deleted'] }));
  });

  it('remembers the open tab', async () => {
    render(<PeopleView api={api()} web viewer={sam} />);
    await screen.findByRole('table');
    openTab('Roles');
    cleanup();
    render(<PeopleView api={api()} web viewer={sam} />);
    expect(await screen.findByRole('table', { name: 'What each role can do' })).toBeInTheDocument();
  });
});

describe('Preview as', () => {
  it('previews any role, a channel role with its channel, or one person, with a setViewAs payload', async () => {
    const onPreview = vi.fn();
    render(<PeopleView api={api()} web viewer={sam} onPreview={onPreview} />);
    await screen.findByRole('table');
    openMenu('Riley Jones');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preview as Riley' }));
    expect(onPreview).toHaveBeenCalledWith({ memberId: 'm-riley' });
    fireEvent.click(screen.getByRole('button', { name: /Preview as…/ }));
    const dialog = screen.getByRole('dialog', { name: 'Preview what someone sees' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Role' }), { target: { value: 'channel' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Channel' }), { target: { value: 'social' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(onPreview).toHaveBeenLastCalledWith({ role: 'channel', channelId: 'social' });
  });
});

describe('People & access on the Mac', () => {
  it('explains that only you use this Mac and offers previews, while Roles and the access log still work', async () => {
    const onPreview = vi.fn();
    render(<PeopleView api={api()} web={false} viewer={{ ...sam, channels }} onPreview={onPreview} />);
    expect(await screen.findByText('People sign in to the browser version of the studio. On this Mac you’re the only user and always an admin. To check what someone else sees, use View as in the sidebar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite people/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview what Semrush Blog’s owner sees' }));
    expect(onPreview).toHaveBeenCalledWith({ role: 'channel', channelId: 'blog' });
    fireEvent.click(screen.getByRole('button', { name: /Preview as an editor/ }));
    expect(onPreview).toHaveBeenLastCalledWith({ role: 'editor' });
    openTab('Roles');
    expect(screen.getByRole('table', { name: 'What each role can do' })).toBeInTheDocument();
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

  it('filters and sorts people, words last active, and parses pasted emails', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    expect(filterPeople(members(), { status: 'never' }, now).map((member) => member.id)).toEqual(['m-riley']);
    expect(filterPeople(members(), { status: 'active' }, now).map((member) => member.id)).toEqual(['m-alex', 'm-jordan', 'm-sam']);
    expect(filterPeople(members(), { sort: 'role' }, now).map((member) => member.base)).toEqual(['admin', 'admin', 'editor', 'channel']);
    expect(filterPeople(members(), { channel: 'blog' }, now).map((member) => member.id)).toEqual(['m-alex']);
    expect(lastActive(new Date(now - 5 * 60000).toISOString(), now)).toBe('Active now');
    expect(lastActive('', now)).toBe('Never signed in');
    expect(lastActive('2026-10-13T12:00:00.000Z', now)).toBe('3 days ago');
    expect(parseEmails('Pat Lee <Pat.Lee@semrush.com>; sam@semrush.com\nmailto:riley@semrush.com')).toEqual(['pat.lee@semrush.com', 'sam@semrush.com', 'riley@semrush.com']);
    expect(parseEmails('just words')).toEqual(['just', 'words']);
    expect(accessLogCsv([{ at: '2026-10-17T10:42:00.000Z', by: { name: 'Sam, Admin' }, text: 'Sam said "hi"', affected: 2, kind: 'policy-changed' }])).toBe('When,Who,What,Affects,Kind\n2026-10-17T10:42:00.000Z,"Sam, Admin","Sam said ""hi""",2,policy-changed');
  });

  it('switches prerequisites on and dependents off together for one person', () => {
    const rules = capabilityRules(ACCESS);
    const editor = ACCESS.roles.find((role) => role.id === 'editor');
    // A reader who can see costs but not research: Start research brings See research and evidence with it.
    const reader = { roleCaps: ['core', 'readAssets', 'seeCosts'], grants: [], denies: [], base: 'editor', byId: rules.byId };
    expect(setPersonState(reader, 'startResearch', 'on')).toEqual({ grants: ['readResearch', 'startResearch'], denies: [], note: 'Also turned on: See research and evidence' });
    // On for something whose prerequisite they denied undoes that deny.
    const undone = setPersonState({ ...reader, roleCaps: editor.capabilities, denies: ['readResearch'] }, 'approveTrends', 'on');
    expect(undone.grants).toEqual(['approveTrends']);
    expect(undone.denies).not.toContain('readResearch');
    const context = { roleCaps: editor.capabilities, grants: [], denies: [], base: 'editor', byId: rules.byId };
    const off = setPersonState(context, 'seeCosts', 'off');
    expect(off.denies).toEqual(expect.arrayContaining(['seeCosts', 'startResearch', 'askAi', 'dataTools']));
    expect(off.note).toMatch(/^Also turned off: /);
  });
});
