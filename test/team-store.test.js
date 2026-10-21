import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import teamStoreModule from '../src/main/team-store.js';
const { createTeamStore, migrate, auditForMember, nameFromEmail, TEAM_VERSION, AUDIT_LIMIT } = teamStoreModule;
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const ADMIN = { id: 'owner', name: 'Studio admin', via: 'password' };
function harness({ adminEmails = [], start = '2026-10-16T09:00:00.000Z', files = {}, openNow = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'team-store-')); roots.push(root);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  const clock = { ms: Date.parse(start) };
  const open = () => createTeamStore({ root, now: () => new Date(clock.ms), adminEmails });
  const file = () => JSON.parse(fs.readFileSync(path.join(root, 'team.json'), 'utf8'));
  return { root, clock, open, file, store: openNow ? open() : null, advance: (ms) => { clock.ms += ms; } };
}
const MINUTE = 60000; const DAY = 86400000;

describe('team file', () => {
  it('treats a missing file as an empty team and creates it only on the first write', () => {
    const h = harness();
    expect(h.store.listMembers()).toEqual([]);
    expect(h.store.admins()).toEqual([]);
    expect(h.store.prefsFor('local')).toEqual({ uiMode: '', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null });
    expect(fs.existsSync(path.join(h.root, 'team.json'))).toBe(false);
    h.store.saveMember({ name: 'Alex', email: 'Alex@Semrush.com ', role: 'channel', channelId: 'blog' }, ADMIN);
    const saved = h.file();
    expect(saved).toMatchObject({ version: TEAM_VERSION, members: [{ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', grants: [], denies: [], disabled: false, createdBy: { id: 'owner', name: 'Studio admin' }, lastSeenAt: '', link: null }], roles: [], rolePolicy: { rev: 0, builtIn: {} }, adoptions: [], activity: [], audit: [], prefs: {} });
    expect(TEAM_VERSION).toBe(3);
    expect(saved.members[0].id).toMatch(/^member-[0-9a-f-]{36}$/);
    expect(fs.readdirSync(h.root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(h.root, 'team.json')).mode & 0o777).toBe(0o600);
    expect(h.open().listMembers()).toEqual(h.store.listMembers()); // load once, then everything is in memory
  });

  it('refuses a damaged file or one from a newer studio instead of starting empty', () => {
    for (const text of ['{ not json', '', '[]', '{"version":1,"members":{}}', '{"version":1,"members":[{"name":"No id"}]}', '{"version":0}']) {
      const h = harness({ files: { 'team.json': text }, openNow: false });
      expect(() => h.open()).toThrow('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
    }
    expect(() => harness({ files: { 'team.json': JSON.stringify({ version: TEAM_VERSION + 1, members: [] }) }, openNow: false }).open()).toThrow('This team file is from a newer Golden Thread. Update the app or server.');
    const legacy = harness({ files: { 'team.json': JSON.stringify({ members: [{ id: 'member-1', name: 'Pat', email: 'pat@semrush.com', role: 'editor' }] }) } });
    expect(legacy.store.listMembers()).toMatchObject([{ id: 'member-1', role: 'editor', channelId: null, grants: [], denies: [], disabled: false, link: null, serverAdmin: false }]);
    // Version 1 becomes version 2 with no access changes (everyone keeps exactly what they had), then 3, which only
    // touches custom roles (a v1 file has none).
    expect(migrate({ version: 1, members: [{ id: 'member-1', role: 'editor' }] })).toEqual({ version: 3, members: [{ id: 'member-1', role: 'editor', grants: [], denies: [] }], roles: [], rolePolicy: { rev: 0, updatedAt: '', updatedBy: null, builtIn: {} }, audit: [] });
    expect(legacy.store.identityFor(legacy.store.memberById('member-1'))).toMatchObject({ role: 'editor', roleId: 'editor' });
  });

  it('undoes a change in memory when it cannot be written', () => {
    const h = harness();
    const alex = h.store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    expect(() => h.store.saveMember({ id: alex.id, name: 'Alex B' }, ADMIN)).toThrow('disk full');
    expect(h.store.memberById(alex.id).name).toBe('Alex');
    expect(h.file().members[0].name).toBe('Alex');
  });
});

describe('members', () => {
  it('validates names, roles, emails and channels', () => {
    const { store } = harness();
    expect(() => store.saveMember({ name: ' ', email: 'a@semrush.com', role: 'editor' }, ADMIN)).toThrow('Enter a name of up to 120 characters.');
    expect(() => store.saveMember({ name: 'x'.repeat(121), email: 'a@semrush.com', role: 'editor' }, ADMIN)).toThrow(/120 characters/);
    expect(() => store.saveMember({ name: 'Pat', email: 'a@semrush.com', role: 'owner' }, ADMIN)).toThrow('Choose a role for this person.');
    expect(() => store.saveMember({ name: 'Pat', email: 'a@semrush.com', role: 'role-missing-0000' }, ADMIN)).toThrow('Choose a role for this person.');
    expect(() => store.saveMember({ name: 'Pat', email: 'not an email', role: 'editor' }, ADMIN)).toThrow(/work email/);
    expect(() => store.saveMember({ name: 'Pat', role: 'editor' }, ADMIN)).toThrow('Add their work email so they can sign in.');
    expect(() => store.saveMember({ name: 'Pat', email: 'p@semrush.com', role: 'channel' }, ADMIN)).toThrow('Choose the channel this person owns.');
    expect(() => store.saveMember({ name: 'Pat', email: 'p@semrush.com', role: 'channel', channelId: 'Semrush Blog' }, ADMIN)).toThrow('Choose the channel this person owns.');
    expect(() => store.saveMember({ id: 'member-missing', name: 'Pat', email: 'p@semrush.com', role: 'editor' }, ADMIN)).toThrow('That person isn’t in the studio anymore.');
    // On the Mac nobody else signs in, so an email is optional there.
    expect(store.saveMember({ name: 'Desk', role: 'editor', channelId: 'blog' }, { id: 'local', name: 'chris', via: 'desktop' })).toMatchObject({ email: '', channelId: null });
    store.saveMember({ name: 'Pat', email: 'pat@semrush.com', role: 'editor' }, ADMIN);
    let error; try { store.saveMember({ name: 'Pat 2', email: 'PAT@semrush.com', role: 'editor' }, ADMIN); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ message: 'Someone in the studio already uses that email.', status: 409 });
    expect(store.memberByEmail('PAT@SEMRUSH.COM')).toMatchObject({ name: 'Pat' });
  });

  it('changes a role, clears the channel when it no longer applies, and keeps fields left out', () => {
    const { store } = harness();
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    expect(store.saveMember({ id: alex.id, channelId: 'social' }, ADMIN)).toMatchObject({ name: 'Alex', role: 'channel', channelId: 'social' });
    expect(store.saveMember({ id: alex.id, role: 'editor' }, ADMIN)).toMatchObject({ role: 'editor', channelId: null, email: 'alex@semrush.com' });
  });

  it('guards against changing yourself, the last admin and server admins', () => {
    const { store } = harness({ adminEmails: ['Boss@Semrush.com'] });
    const chris = store.saveMember({ name: 'Chris', email: 'chris@semrush.com', role: 'admin' }, ADMIN);
    const me = { id: chris.id, name: 'Chris', via: 'proxy' };
    const refusal = (fn) => { try { fn(); } catch (error) { return { message: error.message, status: error.status, code: error.code }; } return null; };
    expect(refusal(() => store.saveMember({ id: chris.id, role: 'editor' }, me))).toEqual({ message: 'You can’t change your own access. Ask another admin.', status: 403, code: 'selfChange' });
    expect(refusal(() => store.saveMember({ id: chris.id, disabled: true }, me))?.code).toBe('selfChange');
    expect(refusal(() => store.removeMember(chris.id, me))?.code).toBe('selfChange');
    expect(store.saveMember({ id: chris.id, name: 'Chris D' }, me)).toMatchObject({ name: 'Chris D', role: 'admin' });
    // Through the admin password, Chris is the last enabled admin.
    expect(refusal(() => store.saveMember({ id: chris.id, role: 'editor' }, ADMIN))).toEqual({ message: 'The studio needs at least one admin.', status: 403, code: 'lastAdmin' });
    expect(refusal(() => store.saveMember({ id: chris.id, disabled: true }, ADMIN))?.code).toBe('lastAdmin');
    expect(refusal(() => store.removeMember(chris.id, ADMIN))?.code).toBe('lastAdmin');
    const dana = store.saveMember({ name: 'Dana', email: 'dana@semrush.com', role: 'admin', disabled: true }, ADMIN);
    expect(refusal(() => store.saveMember({ id: chris.id, role: 'editor' }, ADMIN))?.code).toBe('lastAdmin'); // a disabled admin doesn't count
    store.saveMember({ id: dana.id, disabled: false }, ADMIN);
    expect(store.saveMember({ id: chris.id, role: 'editor' }, ADMIN)).toMatchObject({ role: 'editor' });
    // A server admin's access is set by STUDIO_ADMIN_EMAILS.
    const boss = store.fromProxyEmail('boss@semrush.com');
    expect(store.memberById(boss.id)).toMatchObject({ serverAdmin: true, role: 'admin' });
    expect(refusal(() => store.saveMember({ id: boss.id, role: 'editor' }, ADMIN))).toEqual({ message: 'This person is an admin in the server settings.', status: 403, code: 'serverAdmin' });
    expect(refusal(() => store.saveMember({ id: boss.id, email: 'boss2@semrush.com' }, ADMIN))?.code).toBe('serverAdmin');
    expect(refusal(() => store.removeMember(boss.id, ADMIN))?.code).toBe('serverAdmin');
    expect(refusal(() => store.saveMember({ name: 'Imposter', email: 'boss@semrush.com', role: 'editor' }, ADMIN))?.message).toMatch(/already uses that email|server settings/);
    expect(store.saveMember({ id: boss.id, name: 'The Boss' }, ADMIN)).toMatchObject({ name: 'The Boss', role: 'admin' });
  });

  it('pauses and removes people: links and prefs go, answers and activity stay', () => {
    const h = harness(); const { store } = h;
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    const { token } = store.issueLink(alex.id, ADMIN, { days: 30 });
    store.setPrefs(alex.id, { uiMode: 'simple', welcomedAt: '2026-10-16T09:00:00Z' });
    store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'using' }, { id: alex.id, name: 'Alex' });
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'blog', status: 'using' }, { id: alex.id, name: 'Alex' });
    const paused = store.saveMember({ id: alex.id, disabled: true }, ADMIN);
    expect(paused).toMatchObject({ disabled: true, link: null });
    expect(store.prefsFor(alex.id)).toEqual({ uiMode: '', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null });
    expect(store.memberByLinkToken(token)).toBeNull();
    expect(store.identityFor(store.memberById(alex.id))).toMatchObject({ role: null, channelId: null, disabled: true });
    expect(() => store.issueLink(alex.id, ADMIN)).toThrow('Turn this person back on before making a sign-in link.');
    const removed = store.removeMember(alex.id, ADMIN);
    expect(removed).toMatchObject({ id: alex.id, name: 'Alex' });
    expect(store.memberById(alex.id)).toBeNull();
    expect(store.adoptionsFor('semrush')).toMatchObject([{ by: { name: 'Alex' } }]);
    expect(store.activityFor('semrush')).toMatchObject([{ by: { name: 'Alex' } }]);
    expect(h.file().prefs).toEqual({});
    // Re-adding the same email is a new person.
    expect(store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN).id).not.toBe(alex.id);
  });
});

describe('sign-in links', () => {
  it('issues a link once, stores only its hash and finds the member from the token', () => {
    const h = harness(); const { store } = h;
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    const issued = store.issueLink(alex.id, ADMIN, { days: 30 });
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.link).toEqual({ createdAt: '2026-10-16T09:00:00.000Z', expiresAt: '2026-11-15T09:00:00.000Z', lastUsedAt: '' });
    const raw = fs.readFileSync(path.join(h.root, 'team.json'), 'utf8');
    expect(raw).not.toContain(issued.token);
    const stored = h.file().members[0].link;
    expect(stored.hash).toBe(crypto.createHash('sha256').update(issued.token).digest('hex'));
    expect(stored.id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(store.listMembers())).not.toContain(stored.hash);
    h.advance(MINUTE);
    const found = store.memberByLinkToken(issued.token);
    expect(found).toMatchObject({ member: { id: alex.id, lastSeenAt: '2026-10-16T09:01:00.000Z', link: { lastUsedAt: '2026-10-16T09:01:00.000Z' } }, linkId: stored.id });
    expect(found.member.link).not.toHaveProperty('hash');
    expect(store.memberByLinkToken(issued.token.toUpperCase())?.member.id).toBe(alex.id);
    for (const bad of ['', 'abc', 'g'.repeat(64), null, 42, crypto.randomBytes(32).toString('hex')]) expect(store.memberByLinkToken(bad)).toBeNull();
  });

  it('compares every stored hash in constant time', () => {
    const { store } = harness();
    const ids = ['Ann', 'Bea', 'Cal'].map((name) => store.saveMember({ name, email: `${name.toLowerCase()}@semrush.com`, role: 'editor' }, ADMIN).id);
    const tokens = ids.map((id) => store.issueLink(id, ADMIN).token);
    const compare = vi.spyOn(crypto, 'timingSafeEqual');
    expect(store.memberByLinkToken(tokens[0]).member.name).toBe('Ann');
    expect(compare).toHaveBeenCalledTimes(3); // no early exit on the first match
  });

  it('expires links, keeps never-expiring ones and replaces or revokes them', () => {
    const h = harness(); const { store } = h;
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    const first = store.issueLink(alex.id, ADMIN, { days: 2 });
    h.advance(2 * DAY - MINUTE); expect(store.memberByLinkToken(first.token)).not.toBeNull();
    h.advance(MINUTE); expect(store.memberByLinkToken(first.token)).toBeNull();
    const forever = store.issueLink(alex.id, ADMIN, { days: 0 });
    expect(forever.link.expiresAt).toBeNull();
    h.advance(4000 * DAY); expect(store.memberByLinkToken(forever.token)).not.toBeNull();
    expect(store.issueLink(alex.id, ADMIN, { days: 'not a number' }).link.expiresAt).toBe(new Date(h.clock.ms + 30 * DAY).toISOString());
    // A fraction of a day is a short link, never one that lasts forever (STUDIO_LINK_DAYS=0.5).
    const half = store.issueLink(alex.id, ADMIN, { days: 0.5 });
    expect(half.link.expiresAt).toBe(new Date(h.clock.ms + DAY / 2).toISOString());
    h.advance(DAY / 2 - MINUTE); expect(store.memberByLinkToken(half.token)).not.toBeNull();
    h.advance(MINUTE); expect(store.memberByLinkToken(half.token)).toBeNull();
    const oldLinkId = store.memberById(alex.id).link.id;
    const fresh = store.issueLink(alex.id, ADMIN);
    expect(store.memberById(alex.id).link.id).not.toBe(oldLinkId); // sessions bound to the old link end
    expect(store.memberByLinkToken(forever.token)).toBeNull();
    expect(store.revokeLink(alex.id, ADMIN)).toMatchObject({ link: null });
    expect(store.memberByLinkToken(fresh.token)).toBeNull();
    expect(store.revokeLink(alex.id, ADMIN)).toMatchObject({ link: null });
    expect(() => store.issueLink('member-missing', ADMIN)).toThrow(/isn’t in the studio/);
  });
});

describe('SSO sign-in', () => {
  it('makes a listed server admin an enabled admin, creating or restoring them', () => {
    const h = harness({ adminEmails: [' Boss@Semrush.com ', ''] }); const { store } = h;
    const boss = store.fromProxyEmail('BOSS@semrush.com');
    expect(boss).toMatchObject({ name: 'boss', email: 'boss@semrush.com', role: 'admin', channelId: null, via: 'proxy', disabled: false, memberSince: '2026-10-16T09:00:00.000Z' });
    expect(boss.id).toMatch(/^member-/);
    expect(store.isServerAdmin('boss@SEMRUSH.com')).toBe(true);
    expect(store.isServerAdmin('')).toBe(false);
    expect(store.admins()).toEqual([{ id: boss.id, name: 'boss' }]);
    expect(store.fromProxyEmail('boss@semrush.com').id).toBe(boss.id); // no second record
    // Someone edited team.json by hand: the server setting wins at the next sign-in.
    const file = h.file(); Object.assign(file.members[0], { role: 'channel', channelId: 'blog', disabled: true });
    fs.writeFileSync(path.join(h.root, 'team.json'), JSON.stringify(file));
    expect(h.open().fromProxyEmail('boss@semrush.com')).toMatchObject({ id: boss.id, role: 'admin', channelId: null, disabled: false });
  });

  it('gives members their role, disabled members none, and strangers a guest identity', () => {
    const { store } = harness();
    const riley = store.saveMember({ name: 'Riley', email: 'riley@semrush.com', role: 'editor' }, ADMIN);
    expect(store.fromProxyEmail('Riley@Semrush.com')).toEqual({ id: riley.id, name: 'Riley', email: 'riley@semrush.com', role: 'editor', roleId: 'editor', channelId: null, via: 'proxy', disabled: false, memberSince: riley.createdAt });
    store.saveMember({ id: riley.id, disabled: true }, ADMIN);
    expect(store.fromProxyEmail('riley@semrush.com')).toMatchObject({ id: riley.id, role: null, disabled: true });
    expect(store.fromProxyEmail('pat@semrush.com')).toEqual({ id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, roleId: null, channelId: null, via: 'proxy', disabled: false, memberSince: null });
    expect(store.fromProxyEmail('')).toBeNull();
    expect(store.fromProxyEmail('nonsense')).toBeNull();
    expect(store.listMembers()).toHaveLength(1);
  });
});

describe('last seen', () => {
  it('keeps lastSeenAt current in memory and writes it at most every 5 minutes per member', () => {
    const h = harness(); const { store } = h;
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    const writes = vi.spyOn(fs, 'renameSync');
    store.touch(alex.id);
    expect(writes).toHaveBeenCalledTimes(1);
    h.advance(MINUTE); store.touch(alex.id); h.advance(3 * MINUTE); store.touch(alex.id);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.memberById(alex.id).lastSeenAt).toBe('2026-10-16T09:04:00.000Z');
    expect(h.file().members[0].lastSeenAt).toBe('2026-10-16T09:00:00.000Z');
    h.advance(MINUTE); store.touch(alex.id);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(h.file().members[0].lastSeenAt).toBe('2026-10-16T09:05:00.000Z');
    store.touch('owner'); store.touch('guest:pat@semrush.com'); store.touch(undefined);
    expect(writes).toHaveBeenCalledTimes(2);
    // After a restart the saved value counts, so a busy server doesn't write again straight away.
    const reopened = h.open(); h.advance(MINUTE); reopened.touch(alex.id);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('never fails the request when the lastSeenAt write fails', () => {
    const h = harness();
    const alex = h.store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); });
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(() => h.store.touch(alex.id)).not.toThrow();
    const lines = out.mock.calls.map(([text]) => String(text)).filter((text) => text.includes('team-write-failed'));
    expect(lines.map((text) => JSON.parse(text))).toMatchObject([{ event: 'team-write-failed', what: 'last-seen', code: 'EROFS' }]);
    expect(fs.readdirSync(h.root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('trend adoptions', () => {
  const alex = { id: 'member-alex', name: 'Alex' };
  it('validates the answer, the link and the note', () => {
    const { store } = harness();
    const base = { workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'using' };
    expect(() => store.setAdoption({ ...base, workspaceId: '' }, alex)).toThrow('Choose a workspace first.');
    expect(() => store.setAdoption({ ...base, themeId: '../x' }, alex)).toThrow('Choose a trend.');
    expect(() => store.setAdoption({ ...base, channelId: 'Semrush Blog' }, alex)).toThrow('Choose a channel.');
    expect(() => store.setAdoption({ ...base, status: 'maybe' }, alex)).toThrow('Choose Using, Not for us or Clear.');
    for (const link of ['javascript:alert(1)', 'ftp://semrush.com/file', 'https://user:pass@semrush.com/', 'not a link', 'mailto:alex@semrush.com', 'intranet', `https://semrush.com/${'a'.repeat(2050)}`]) {
      let error; try { store.setAdoption({ ...base, link }, alex); } catch (caught) { error = caught; }
      expect({ link, message: error?.message, status: error?.status }).toEqual({ link, message: 'That doesn’t look like a web link.', status: 400 });
    }
    expect(() => store.setAdoption({ ...base, note: 'n'.repeat(501) }, alex)).toThrow('Keep the note to 500 characters or fewer.');
    expect(store.setAdoption({ ...base, link: 'semrush.com/blog/ai-overviews', note: ' Live on the blog. ' }, alex)).toMatchObject({ link: 'https://semrush.com/blog/ai-overviews', note: 'Live on the blog.' });
    expect(store.setAdoption({ ...base, link: 'http://example.org' }, alex).link).toBe('http://example.org/');
    expect(store.setAdoption({ ...base, link: '' }, alex).link).toBe('');
    // A planned date: a real calendar day; Not for us clears it; left out keeps it.
    for (const plannedFor of ['2026-02-30', 'next week', '2026-10-24T00:00:00Z']) expect(() => store.setAdoption({ ...base, plannedFor }, alex)).toThrow('Choose a planned date like 2026-10-24.');
    expect(store.setAdoption({ ...base, plannedFor: '2026-10-24' }, alex).plannedFor).toBe('2026-10-24');
    expect(store.setAdoption({ ...base, note: 'Live soon' }, alex).plannedFor).toBe('2026-10-24');
    expect(store.setAdoption({ ...base, plannedFor: '' }, alex).plannedFor).toBe('');
    store.setAdoption({ ...base, plannedFor: '2026-10-25' }, alex);
    expect(store.setAdoption({ ...base, status: 'not-using' }, alex).plannedFor).toBe('');
  });

  it('keeps one answer per workspace, trend and channel, records who answered, and clears it', () => {
    const h = harness(); const { store } = h;
    const first = store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'using', trendName: 'AI Overviews' }, alex);
    expect(first).toMatchObject({ status: 'using', link: '', trendName: 'AI Overviews', by: alex, at: '2026-10-16T09:00:00.000Z', updatedAt: '2026-10-16T09:00:00.000Z' });
    h.advance(MINUTE);
    // A teammate adds the link later: the answer is still Alex's.
    const linked = store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'using', link: 'semrush.com/blog/x' }, { id: 'member-ana', name: 'Ana' });
    expect(linked).toMatchObject({ id: first.id, link: 'https://semrush.com/blog/x', by: alex, at: first.at, updatedAt: '2026-10-16T09:01:00.000Z', trendName: 'AI Overviews' });
    h.advance(MINUTE);
    const changed = store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'not-using' }, { id: 'member-ana', name: 'Ana' });
    expect(changed).toMatchObject({ id: first.id, status: 'not-using', link: 'https://semrush.com/blog/x', by: { name: 'Ana' }, at: '2026-10-16T09:02:00.000Z' });
    store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'social', status: 'using' }, alex);
    store.setAdoption({ workspaceId: 'general', themeId: 'theme-aio', channelId: 'blog', status: 'using' }, alex);
    expect(store.adoptionsFor('semrush')).toHaveLength(2);
    expect(store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'clear' }, alex)).toBeNull();
    expect(store.setAdoption({ workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'clear' }, alex)).toBeNull();
    expect(store.adoptionsFor('semrush').map((row) => row.channelId)).toEqual(['social']);
    expect(h.file().adoptions).toHaveLength(2);
  });
});

describe('activity', () => {
  it('logs plain rows, drops secrets, and merges repeated answers within 10 minutes', () => {
    const h = harness(); const { store } = h;
    const alex = { id: 'member-alex', name: 'Alex' };
    expect(() => store.log('hacked', 'semrush', {}, alex)).toThrow('Unknown kind of activity.');
    const row = store.log('link-issued', '', { memberId: 'member-alex', name: 'Alex', token: 'TOKEN-VALUE', linkHash: 'HASH-VALUE', nested: { password: 'PASSWORD-VALUE', ok: 1 } }, { id: 'owner', name: 'Studio admin' });
    expect(row).toMatchObject({ kind: 'link-issued', workspaceId: '', by: { id: 'owner', name: 'Studio admin' }, detail: { memberId: 'member-alex', name: 'Alex', nested: { ok: 1 } } });
    expect(JSON.stringify(h.file().activity)).not.toMatch(/TOKEN-VALUE|HASH-VALUE|PASSWORD-VALUE|password/);
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'blog', status: 'using' }, alex);
    h.advance(5 * MINUTE);
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'blog', status: 'not-using' }, alex);
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'social', status: 'using' }, alex);
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'blog', status: 'using' }, { id: 'member-ana', name: 'Ana' });
    expect(store.activityFor('semrush', 10).map((entry) => [entry.by.name, entry.detail.channelId || '', entry.detail.status || entry.kind])).toEqual([['Ana', 'blog', 'using'], ['Alex', 'social', 'using'], ['Alex', 'blog', 'not-using'], ['Studio admin', '', 'link-issued']]);
    h.advance(11 * MINUTE);
    store.log('adoption', 'semrush', { themeId: 'theme-aio', channelId: 'blog', status: 'using' }, alex);
    expect(store.activityFor('semrush').filter((entry) => entry.by.name === 'Alex' && entry.detail.channelId === 'blog')).toHaveLength(2);
    expect(store.activityFor('general').map((entry) => entry.kind)).toEqual(['link-issued']); // studio-wide rows show everywhere
    expect(store.activityFor('semrush', 1)).toHaveLength(1);
    expect(store.activityFor(undefined).length).toBe(store.activityFor('semrush', 100).length);
  });

  it('keeps only the newest 5,000 rows', () => {
    const h = harness({ files: { 'team.json': JSON.stringify({ version: 1, members: [], adoptions: [], prefs: {}, activity: Array.from({ length: 5000 }, (_, index) => ({ id: `activity-${index}`, workspaceId: 'semrush', at: '2026-10-01T00:00:00.000Z', by: { id: 'x', name: 'X' }, kind: 'report-edited', detail: { index } })) }) } });
    h.store.log('research-started', 'semrush', { programName: 'Pulse' }, { id: 'member-ana', name: 'Ana' });
    const saved = h.file().activity;
    expect(saved).toHaveLength(5000);
    expect(saved[0].id).toBe('activity-1');
    expect(saved[4999]).toMatchObject({ kind: 'research-started' });
  });

  it('writes event lines without tokens, hashes or payloads', () => {
    const { store } = harness();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    store.logEvent({ event: 'denied', identityId: 'member-alex', role: 'channel', method: 'saveSettings', payload: { keyName: 'APIFY' }, linkToken: 'a'.repeat(64), session: 'f'.repeat(64), hash: 'x', ok: true, count: 2, nested: { a: 1 } });
    const line = out.mock.calls.map(([text]) => String(text)).find((text) => text.includes('"event":"denied"'));
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ at: '2026-10-16T09:00:00.000Z', event: 'denied', identityId: 'member-alex', role: 'channel', method: 'saveSettings', ok: true, count: 2 });
  });
});

describe('preferences', () => {
  it('keeps only the layout, the welcome and Inbox dates, the person’s channels and the sidebar rail', () => {
    const h = harness(); const { store } = h;
    expect(store.setPrefs('owner', { uiMode: 'classic', viewAs: { role: 'channel', channelId: 'blog' }, theme: 'dark' })).toEqual({ uiMode: 'classic', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null });
    expect(h.file().prefs).toEqual({ owner: { uiMode: 'classic' } });
    expect(store.setPrefs('owner', { welcomedAt: '2026-10-16T09:00:00Z' })).toMatchObject({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z' });
    expect(store.setPrefs('owner', { inboxSeenAt: '2026-10-17T08:00:00Z', focusChannels: ['blog', 'social', 'blog'], navRail: false })).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z', inboxSeenAt: '2026-10-17T08:00:00.000Z', focusChannels: ['blog', 'social'], navRail: false });
    expect(h.file().prefs.owner).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z', inboxSeenAt: '2026-10-17T08:00:00.000Z', focusChannels: ['blog', 'social'], navRail: false });
    expect(() => store.setPrefs('owner', { focusChannels: ['Semrush Blog'] })).toThrow('Choose channels from the list.');
    expect(() => store.setPrefs('owner', { navRail: 'yes' })).toThrow(/sidebar/);
    expect(() => store.setPrefs('owner', { inboxSeenAt: 'soon' })).toThrow('Choose a valid date.');
    store.setPrefs('owner', { inboxSeenAt: '', focusChannels: [], navRail: null, welcomedAt: '' });
    expect(h.file().prefs).toEqual({ owner: { uiMode: 'classic' } });
    expect(() => store.setPrefs('owner', { uiMode: 'advanced' })).toThrow('Choose Simple or Advanced.');
    expect(() => store.setPrefs('owner', { welcomedAt: 'yesterday' })).toThrow('Choose a valid date.');
    expect(() => store.setPrefs('__proto__', { uiMode: 'simple' })).toThrow(/Sign in/);
    expect(() => store.setPrefs('', { uiMode: 'simple' })).toThrow(/Sign in/);
    const writes = vi.spyOn(fs, 'renameSync');
    store.setPrefs('owner', { uiMode: 'classic' });
    expect(writes).not.toHaveBeenCalled();
    store.setPrefs('owner', { uiMode: 'simple', welcomedAt: '' });
    expect(h.file().prefs).toEqual({ owner: { uiMode: 'simple' } });
    expect(store.prefsFor('local')).toEqual({ uiMode: '', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null });
    expect(store.prefsFor('toString')).toEqual({ uiMode: '', welcomedAt: '', inboxSeenAt: '', focusChannels: [], navRail: null });
  });
});

describe('roles and access (team.json v2)', () => {
  const refusal = (fn) => { try { fn(); } catch (error) { return { message: error.message, status: error.status, code: error.code }; } return null; };
  function team() {
    const h = harness(); const { store } = h;
    const alex = store.saveMember({ name: 'Alex', email: 'alex@semrush.com', role: 'admin' }, ADMIN);
    const riley = store.saveMember({ name: 'Riley', email: 'riley@semrush.com', role: 'editor' }, ADMIN);
    const sam = store.saveMember({ name: 'Sam', email: 'sam@semrush.com', role: 'channel', channelId: 'blog' }, ADMIN);
    return { h, store, alex, riley, sam };
  }

  it('saves the built-in role policy with a rev, refusing a stale one, locked capabilities and missing requirements', () => {
    const { h, store, alex } = team();
    const by = { id: alex.id, name: 'Alex' };
    expect(store.accessSummary()).toMatchObject({ rev: 0, roles: [{ id: 'admin', memberCount: 1 }, { id: 'editor', memberCount: 1 }, { id: 'channel', memberCount: 1 }] });
    const saved = store.saveRolePolicy({ rev: 0, builtIn: { editor: { grant: ['seeAnalytics'], deny: ['editPrompts'] } } }, by);
    expect(saved.affected).toBe(1);
    expect(saved.audit.map((row) => [row.kind, row.target.id, row.changes[0].capability, row.changes[0].to])).toEqual([['policy-changed', 'editor', 'editPrompts', false], ['policy-changed', 'editor', 'seeAnalytics', true]]);
    expect(saved.access.rev).toBe(1);
    expect(h.file().rolePolicy).toMatchObject({ rev: 1, updatedBy: { id: alex.id, name: 'Alex' }, builtIn: { editor: { grant: ['seeAnalytics'], deny: ['editPrompts'] } } });
    expect(store.identityFor(store.memberByEmail('riley@semrush.com'))).toMatchObject({ role: 'editor', roleId: 'editor' });
    expect(store.accessPolicy().roles.get('editor').capabilities).toContain('seeAnalytics');
    expect(refusal(() => store.saveRolePolicy({ rev: 0, builtIn: { editor: { grant: [], deny: [] } } }, by))).toMatchObject({ status: 409, code: 'policyConflict', message: expect.stringMatching(/^Alex changed roles at .+, after you opened them\. Reload to see the latest\.$/) });
    expect(refusal(() => store.saveRolePolicy({ rev: 1, builtIn: { admin: { deny: ['settings'] } } }, by))).toMatchObject({ code: 'adminAccess', status: 400 });
    expect(refusal(() => store.saveRolePolicy({ rev: 1, builtIn: { editor: { grant: ['settings'] } } }, by))).toMatchObject({ code: 'lockedCapability', message: 'Only admins can have “Settings and connections”.' });
    expect(refusal(() => store.saveRolePolicy({ rev: 1, builtIn: { channel: { grant: ['readResearch'] } } }, by))).toMatchObject({ code: 'notForChannelRoles' });
    expect(refusal(() => store.saveRolePolicy({ rev: 1, builtIn: { editor: { deny: ['readResearch'] } } }, by))).toMatchObject({ code: 'needsCapability' });
    expect(refusal(() => store.saveRolePolicy({ rev: 1, builtIn: { editor: { grant: ['teleport'] } } }, by))?.status).toBe(400);
    // Saving the defaults back clears the adjustment.
    expect(store.saveRolePolicy({ rev: 1, builtIn: { editor: { grant: [], deny: [] } } }, by).access.rev).toBe(2);
    expect(h.file().rolePolicy.builtIn).toEqual({});
    expect(store.saveRolePolicy({ rev: 2, builtIn: { editor: { grant: [], deny: [] } } }, by)).toMatchObject({ affected: 0, audit: [] }); // nothing changed, nothing written
  });

  it('makes, renames and deletes custom roles, moving their people in the same write', () => {
    const { h, store, riley, sam } = team();
    const made = store.saveRole({ label: 'Viewer', base: 'editor', template: 'viewer', rev: 0 }, ADMIN);
    expect(made.role).toMatchObject({ label: 'Viewer', base: 'editor', capabilities: ['askAi', 'core', 'readAssets', 'readResearch'], template: 'viewer', policyVersion: 3 });
    expect(made.role.id).toMatch(/^role-viewer-[0-9a-f]{4}$/);
    expect(made.audit[0]).toMatchObject({ kind: 'role-created', target: { type: 'role', id: made.role.id, name: 'Viewer' } });
    expect(refusal(() => store.saveRole({ label: 'viewer', base: 'editor', rev: 1 }, ADMIN))).toMatchObject({ code: 'roleName' });
    expect(refusal(() => store.saveRole({ label: 'Editor', base: 'editor', rev: 1 }, ADMIN))).toMatchObject({ code: 'roleName' });
    expect(refusal(() => store.saveRole({ id: made.role.id, base: 'channel', rev: 1 }, ADMIN))).toMatchObject({ code: 'roleBase' });
    expect(refusal(() => store.saveRole({ label: 'Reviewers', base: 'channel', template: 'viewer', rev: 1 }, ADMIN))?.message).toMatch(/different kind of role/);
    expect(refusal(() => store.saveRole({ label: 'Boss', base: 'admin', rev: 1 }, ADMIN))?.status).toBe(400);
    expect(refusal(() => store.saveRole({ label: 'Late', base: 'editor', rev: 0 }, ADMIN))?.code).toBe('policyConflict');
    const renamed = store.saveRole({ id: made.role.id, label: 'Readers', description: 'Read only.', capabilities: ['askAi', 'readAssets', 'readResearch', 'sheets'], rev: 1 }, ADMIN);
    expect(renamed.role).toMatchObject({ label: 'Readers', description: 'Read only.', capabilities: ['askAi', 'core', 'readAssets', 'readResearch', 'sheets'] });
    expect(renamed.audit[0].changes.map((change) => change.field)).toEqual(['label', 'description', 'capability']);
    // People can have it; their identity carries the base and the role.
    store.saveMember({ id: riley.id, role: made.role.id }, ADMIN);
    expect(store.identityFor(store.memberById(riley.id))).toMatchObject({ role: 'editor', roleId: made.role.id });
    expect(refusal(() => store.saveMember({ id: sam.id, role: made.role.id }, ADMIN))).toBeNull(); // channel → editor base is allowed; the channel goes
    expect(store.memberById(sam.id)).toMatchObject({ role: made.role.id, channelId: null });
    expect(refusal(() => store.deleteRole({ id: made.role.id, rev: 2 }, ADMIN))).toMatchObject({ status: 409, code: 'roleInUse', message: 'This role has 2 people. Choose a role to move them to first.' });
    expect(refusal(() => store.deleteRole({ id: made.role.id, moveTo: 'channel', rev: 2 }, ADMIN))?.message).toMatch(/same kind/);
    expect(refusal(() => store.deleteRole({ id: 'editor', rev: 2 }, ADMIN))?.message).toBe('Built-in roles can’t be deleted.');
    const deleted = store.deleteRole({ id: made.role.id, moveTo: 'editor', rev: 2 }, ADMIN);
    expect(deleted).toMatchObject({ ok: true, moved: 2 });
    expect(deleted.audit.map((row) => row.kind)).toEqual(['role-deleted', 'member-changed', 'member-changed']);
    expect(store.memberById(riley.id).role).toBe('editor');
    expect(h.file().roles).toEqual([]);
  });

  it('gives no access to someone whose role was removed by hand', () => {
    const h = harness({ files: { 'team.json': JSON.stringify({ version: 2, members: [{ id: 'member-1', name: 'Pat', email: 'pat@semrush.com', role: 'role-gone-0000', grants: ['settings'], denies: [] }], roles: [], rolePolicy: { rev: 0, builtIn: {} }, audit: [] }) } });
    expect(h.store.identityFor(h.store.memberById('member-1'))).toMatchObject({ role: null, roleId: null });
  });

  it('adjusts one person’s access, with the guards: admins, yourself, locked and out-of-base capabilities, requirements', () => {
    const { store, alex, riley, sam } = team();
    const result = store.saveMemberAccess({ id: riley.id, grants: ['seeAnalytics', 'askAi'], denies: ['askAi', 'editPrompts'] }, ADMIN);
    expect(result.member).toMatchObject({ grants: ['seeAnalytics'], denies: ['askAi', 'editPrompts'] }); // deny wins
    expect(result.audit[0]).toMatchObject({ kind: 'member-access', target: { id: riley.id, name: 'Riley' } });
    expect(result.audit[0].changes).toEqual([{ field: 'capability', capability: 'askAi', from: 'default', to: 'off' }, { field: 'capability', capability: 'editPrompts', from: 'default', to: 'off' }, { field: 'capability', capability: 'seeAnalytics', from: 'default', to: 'on' }]);
    expect(store.accessFor(riley.id)).toEqual({ grants: ['seeAnalytics'], denies: ['askAi', 'editPrompts'] });
    expect(store.saveMemberAccess({ id: riley.id, grants: ['seeAnalytics'], denies: ['askAi', 'editPrompts'] }, ADMIN).audit).toEqual([]); // no change
    expect(refusal(() => store.saveMemberAccess({ id: alex.id, grants: ['askAi'] }, ADMIN))).toMatchObject({ code: 'adminAccess' });
    expect(refusal(() => store.saveMemberAccess({ id: riley.id, grants: ['settings'] }, ADMIN))).toMatchObject({ code: 'lockedCapability' });
    expect(refusal(() => store.saveMemberAccess({ id: sam.id, grants: ['readResearch'] }, ADMIN))).toMatchObject({ code: 'notForChannelRoles' });
    expect(refusal(() => store.saveMemberAccess({ id: riley.id, grants: ['startResearch'], denies: ['readResearch'] }, ADMIN))).toMatchObject({ code: 'needsCapability', message: '“Start research” also needs “See research and evidence”.' });
    expect(refusal(() => store.saveMemberAccess({ id: riley.id, grants: [] }, { id: riley.id, name: 'Riley' }))).toMatchObject({ code: 'selfChange' });
    expect(refusal(() => store.saveMemberAccess({ id: 'member-missing' }, ADMIN))?.status).toBe(404);
    // Moving to another kind of role clears their own changes.
    store.saveMember({ id: riley.id, role: 'channel', channelId: 'pr' }, ADMIN);
    expect(store.accessFor(riley.id)).toEqual({ grants: [], denies: [] });
    expect(auditForMember(result.member, store.memberById(riley.id), (id) => store.roleLabel(id))).toMatchObject({ kind: 'member-changed', changes: expect.arrayContaining([{ field: 'role', from: 'editor', to: 'channel', fromLabel: 'Editor', toLabel: 'Channel owner' }, { field: 'channelId', from: '', to: 'pr' }, { field: 'grant', capability: 'seeAnalytics', from: true, to: false }]) });
  });

  it('invites people in one write, skipping what can’t be added, with links when asked', () => {
    const { h, store } = team();
    const writes = vi.spyOn(fs, 'renameSync');
    const result = store.inviteMembers({ people: [{ email: 'Pat.Lee@semrush.com' }, 'jordan@semrush.com', { email: 'riley@semrush.com' }, { email: 'pat.lee@semrush.com' }, { email: 'not an email' }], role: 'channel', channelId: 'social', grants: [], denies: ['makeAssets'], makeLinks: true, linkDays: 7 }, ADMIN);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result.members.map((member) => [member.name, member.email, member.role, member.channelId, member.denies])).toEqual([['Pat Lee', 'pat.lee@semrush.com', 'channel', 'social', ['makeAssets']], ['Jordan', 'jordan@semrush.com', 'channel', 'social', ['makeAssets']]]);
    expect(result.skipped).toEqual([{ email: 'riley@semrush.com', reason: 'Already in the studio' }, { email: 'pat.lee@semrush.com', reason: 'Listed twice' }, { email: 'not an email', reason: 'Not an email address' }]);
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toEqual({ id: result.members[0].id, token: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: '2026-10-23T09:00:00.000Z' });
    expect(JSON.stringify(h.file())).not.toContain(result.links[0].token);
    expect(store.memberByLinkToken(result.links[0].token)?.member.id).toBe(result.members[0].id);
    expect(result.audit.map((row) => row.kind)).toEqual(['member-added', 'link-issued', 'member-added', 'link-issued']);
    expect(store.inviteMembers({ people: ['riley@semrush.com'], role: 'editor' }, ADMIN)).toMatchObject({ members: [], skipped: [{ reason: 'Already in the studio' }] });
    expect(() => store.inviteMembers({ people: [], role: 'editor' }, ADMIN)).toThrow('Add between 1 and 50 email addresses.');
    expect(() => store.inviteMembers({ people: ['x@semrush.com'], role: 'channel' }, ADMIN)).toThrow('Choose the channel they own.');
    expect(refusal(() => store.inviteMembers({ people: ['x@semrush.com'], role: 'admin', grants: ['askAi'] }, ADMIN))).toMatchObject({ code: 'adminAccess' });
    expect(nameFromEmail('sam_o-neil+studio@semrush.com')).toBe('Sam O Neil Studio');
  });

  it('keeps an access log of its own: 2,000 rows, filtered and paged, never evicted by activity', () => {
    const h = harness({ files: { 'team.json': JSON.stringify({ version: 2, members: [], roles: [], rolePolicy: { rev: 0, builtIn: {} }, adoptions: [], activity: [], prefs: {}, audit: Array.from({ length: AUDIT_LIMIT }, (_, index) => ({ id: `audit-${index}`, at: '2026-10-01T00:00:00.000Z', by: { id: 'x', name: 'X' }, kind: 'link-issued', target: { type: 'member', id: `member-${index % 3}`, name: 'M' }, changes: [], affected: 1 })) }) } });
    const written = h.store.audit([{ kind: 'policy-changed', target: { type: 'role', id: 'editor', name: 'Editor' }, changes: [{ field: 'capability', capability: 'askAi', from: true, to: false, token: 'secret' }], affected: 3 }, { kind: 'hacked', target: {} }], { id: 'member-alex', name: 'Alex' });
    expect(written).toHaveLength(1);
    expect(h.file().audit).toHaveLength(AUDIT_LIMIT);
    expect(h.file().audit[0].id).toBe('audit-1');
    expect(h.file().audit.at(-1)).toMatchObject({ kind: 'policy-changed', by: { name: 'Alex' }, changes: [{ field: 'capability', capability: 'askAi', from: true, to: false }] });
    expect(JSON.stringify(h.file().audit.at(-1))).not.toContain('secret');
    const first = h.store.auditFor({ limit: 2 });
    expect(first.rows.map((row) => row.kind)).toEqual(['policy-changed', 'link-issued']);
    expect(first).toMatchObject({ more: true, next: first.rows[1].id });
    expect(h.store.auditFor({ limit: 2, before: first.next }).rows[0].id).toBe(`audit-${AUDIT_LIMIT - 2}`);
    expect(h.store.auditFor({ roleId: 'editor' }).rows).toHaveLength(1);
    expect(h.store.auditFor({ kinds: ['link-issued'], memberId: 'member-1', limit: 200 }).rows.every((row) => row.target.id === 'member-1')).toBe(true);
    expect(h.store.auditFor({ memberId: 'member-alex' }).rows).toHaveLength(1); // rows they made
    for (let index = 0; index < 5; index++) h.store.log('research-started', 'semrush', { programName: 'Pulse' }, { id: 'member-alex', name: 'Alex' });
    expect(h.file().audit).toHaveLength(AUDIT_LIMIT);
  });
});

describe('Ask AI on for every role (team.json v3)', () => {
  const AT = '2026-10-10T10:00:00.000Z';
  const member = (id, role, extra = {}) => ({ id, name: id.replace('member-', ''), email: `${id.replace('member-', '')}@example.com`, role, channelId: null, disabled: false, grants: [], denies: [], createdAt: AT, updatedAt: AT, lastSeenAt: '', link: null, ...extra });
  // A v2 studio from before Ask AI was for everyone: custom roles without it, one an admin turned it off for (in the
  // access log), one without the reads Ask AI needs, and an Editor role an admin had turned Ask AI off for.
  const v2 = () => JSON.stringify({
    version: 2,
    members: [member('member-alex', 'admin'), member('member-sam', 'role-readers-0001'), member('member-riley', 'role-reviewers-0002', { channelId: 'blog' }), member('member-jordan', 'channel', { channelId: 'social', denies: ['makeAssets'] })],
    roles: [
      { id: 'role-readers-0001', label: 'Readers', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'], template: 'viewer', policyVersion: 3, createdAt: AT, updatedAt: AT },
      { id: 'role-reviewers-0002', label: 'Reviewers', base: 'channel', capabilities: ['core', 'markTrendsUsed', 'readAssets'], template: 'channel-reviewer', policyVersion: 3, createdAt: AT, updatedAt: AT },
      { id: 'role-quiet-0003', label: 'Quiet', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch', 'sheets'], template: '', policyVersion: 3, createdAt: AT, updatedAt: AT },
      { id: 'role-briefs-0004', label: 'Briefs only', base: 'editor', capabilities: ['core', 'readAssets'], template: '', policyVersion: 3, createdAt: AT, updatedAt: AT },
    ],
    rolePolicy: { rev: 4, updatedAt: AT, updatedBy: { id: 'member-alex', name: 'Alex' }, builtIn: { editor: { grant: [], deny: ['askAi'] } } },
    adoptions: [], activity: [], prefs: {},
    audit: [{ id: 'audit-1', at: AT, by: { id: 'member-alex', name: 'Alex' }, kind: 'role-changed', target: { type: 'role', id: 'role-quiet-0003', name: 'Quiet' }, changes: [{ field: 'capability', capability: 'askAi', from: true, to: false }], affected: 0 }],
  });
  const capsOf = (store, roleId) => store.accessPolicy().roles.get(roleId).capabilities;

  it('turns Ask AI on once for the roles that lack it, and leaves an admin’s Off, the admin role and everything else alone', () => {
    const h = harness({ files: { 'team.json': v2() } });
    const { store } = h;
    expect(capsOf(store, 'role-readers-0001')).toEqual(['askAi', 'core', 'readAssets', 'readResearch']);
    expect(capsOf(store, 'role-reviewers-0002')).toEqual(['askAi', 'core', 'markTrendsUsed', 'readAssets']);
    expect(capsOf(store, 'channel')).toContain('askAi'); // the built-in Channel owner, from roles.json's defaults
    expect(capsOf(store, 'role-quiet-0003')).not.toContain('askAi'); // an admin turned it off for this role
    expect(capsOf(store, 'role-briefs-0004')).toEqual(['core', 'readAssets']); // it lacks See research and evidence, which Ask AI needs on an editor base
    expect(capsOf(store, 'editor')).not.toContain('askAi'); // an admin's Off on the built-in Editor stays
    expect(capsOf(store, 'admin')).toHaveLength(28);
    // People's own access is untouched: Jordan's Off for Make channel assets stays, and Jordan has Ask AI from the role.
    expect(store.accessFor('member-jordan')).toEqual({ grants: [], denies: ['makeAssets'] });
    // The access log says what changed, as Automatic, with who it affects.
    const rows = store.auditFor({}).rows.filter((row) => row.by?.id === 'system');
    expect(rows.map((row) => [row.kind, row.target.id, row.changes[0]])).toEqual([['policy-changed', 'role-reviewers-0002', { field: 'capability', capability: 'askAi', from: false, to: true }], ['policy-changed', 'role-readers-0001', { field: 'capability', capability: 'askAi', from: false, to: true }]]);
    expect(rows.find((row) => row.target.id === 'role-readers-0001').affected).toBe(1);
    // Until the next write the file keeps its old version; opening again gives the same result, with no new rows.
    expect(h.file().version).toBe(2);
    const again = h.open();
    expect(capsOf(again, 'role-readers-0001')).toContain('askAi');
    expect(again.auditFor({}).rows.filter((row) => row.by?.id === 'system')).toHaveLength(2);
  });

  it('keeps an admin’s later Off through restarts and upgrades: the default is applied only once', () => {
    const h = harness({ files: { 'team.json': v2() } });
    const by = { id: 'member-alex', name: 'Alex' };
    const policy = h.store.accessSummary();
    const off = h.store.saveRolePolicy({ rev: policy.rev, builtIn: { channel: { grant: [], deny: ['askAi'] } }, custom: [{ id: 'role-readers-0001', capabilities: ['core', 'readAssets', 'readResearch'] }] }, by);
    expect(off.audit.map((row) => [row.target.id, row.changes[0].capability, row.changes[0].to])).toEqual([['channel', 'askAi', false], ['role-readers-0001', 'askAi', false]]);
    expect(h.file()).toMatchObject({ version: 3, rolePolicy: { builtIn: { channel: { grant: [], deny: ['askAi'] } } } });
    // A restart reads version 3: nothing turns it back on.
    for (let restart = 0; restart < 2; restart++) {
      const store = h.open();
      expect(capsOf(store, 'channel')).not.toContain('askAi');
      expect(capsOf(store, 'role-readers-0001')).not.toContain('askAi');
      expect(capsOf(store, 'role-reviewers-0002')).toContain('askAi');
    }
    // Turned back on, it stays on too.
    const store = h.open();
    store.saveRolePolicy({ rev: store.accessSummary().rev, builtIn: { channel: { grant: [], deny: [] } } }, by);
    expect(capsOf(h.open(), 'channel')).toContain('askAi');
    expect(h.file().rolePolicy.builtIn).not.toHaveProperty('channel');
  });

  it('gives Ask AI back where it went off only because See costs went off, and keeps an Off an admin chose', () => {
    const LATER = '2026-10-12T09:00:00.000Z';
    const row = (id, kind, target, changes) => ({ id, at: kind === 'deliberate' ? LATER : AT, by: { id: 'member-alex', name: 'Alex' }, kind: target.type === 'member' ? 'member-access' : 'role-changed', target, changes, affected: 0 });
    const capChange = (capability, from = true, to = false) => ({ field: 'capability', capability, from, to });
    const file = (editorRows) => JSON.stringify({
      version: 2,
      members: [member('member-alex', 'admin'), member('member-riley', 'editor', { denies: ['askAi', 'seeCosts'] }), member('member-jordan', 'editor', { denies: ['askAi', 'seeCosts'] }), member('member-sam', 'role-analysts-0005')],
      roles: [{ id: 'role-analysts-0005', label: 'Analysts', base: 'editor', capabilities: ['core', 'dataTools', 'readAssets', 'readResearch', 'sheets', 'viewPrompts'], template: 'analyst', policyVersion: 3, createdAt: AT, updatedAt: AT }],
      rolePolicy: { rev: 6, updatedAt: AT, updatedBy: { id: 'member-alex', name: 'Alex' }, builtIn: { editor: { grant: [], deny: ['askAi', 'manageRuns', 'quickScans', 'seeCosts'] } } },
      adoptions: [], activity: [], prefs: {},
      audit: [
        // See costs off for Analysts, in one row with what it turned off.
        row('audit-1', 'cascade', { type: 'role', id: 'role-analysts-0005', name: 'Analysts' }, [capChange('seeCosts'), capChange('askAi'), capChange('quickScans')]),
        // See costs off for Editor: one row per capability, written together.
        ...editorRows,
        // Riley's own See costs Off took Ask AI with it; Jordan's Ask AI Off was its own save.
        row('audit-6', 'cascade', { type: 'member', id: 'member-riley', name: 'riley' }, [capChange('askAi', 'default', 'off'), capChange('seeCosts', 'default', 'off')]),
        row('audit-7', 'cascade', { type: 'member', id: 'member-jordan', name: 'jordan' }, [capChange('seeCosts', 'default', 'off')]),
        row('audit-8', 'deliberate', { type: 'member', id: 'member-jordan', name: 'jordan' }, [capChange('askAi', 'default', 'off')]),
      ],
    });
    const editorTogether = ['seeCosts', 'askAi', 'quickScans', 'manageRuns'].map((capability, at) => ({ ...row(`audit-e${at}`, 'cascade', { type: 'role', id: 'editor', name: 'Editor' }, [capChange(capability)]), kind: 'policy-changed' }));
    const { store } = harness({ files: { 'team.json': file(editorTogether) } });
    expect(capsOf(store, 'role-analysts-0005')).toContain('askAi');
    expect(capsOf(store, 'role-analysts-0005')).not.toContain('seeCosts');
    expect(capsOf(store, 'editor')).toContain('askAi');
    expect(store.accessSummary().roles.find((role) => role.id === 'editor').overrides).toEqual({ grant: [], deny: ['manageRuns', 'quickScans', 'seeCosts'] });
    expect(store.accessFor('member-riley')).toEqual({ grants: [], denies: ['seeCosts'] });
    expect(store.accessFor('member-jordan')).toEqual({ grants: [], denies: ['askAi', 'seeCosts'] }); // an admin turned it off for Jordan
    const automatic = store.auditFor({}).rows.filter((entry) => entry.by?.id === 'system').map((entry) => [entry.kind, entry.target.id, entry.changes[0].from, entry.changes[0].to]);
    expect(automatic).toEqual(expect.arrayContaining([['policy-changed', 'role-analysts-0005', false, true], ['policy-changed', 'editor', false, true], ['member-access', 'member-riley', 'off', 'default']]));
    expect(automatic).toHaveLength(3);
    // An Editor Off that an admin chose before See costs went off stays.
    const chosen = [{ ...row('audit-e9', 'deliberate', { type: 'role', id: 'editor', name: 'Editor' }, [capChange('askAi')]), at: AT, kind: 'policy-changed' }, { ...row('audit-e10', 'deliberate', { type: 'role', id: 'editor', name: 'Editor' }, [capChange('seeCosts')]), kind: 'policy-changed' }];
    expect(capsOf(harness({ files: { 'team.json': file(chosen) } }).store, 'editor')).not.toContain('askAi');
  });

  it('tells People & access what Ask AI needs on each kind of role', () => {
    const { store } = harness();
    const ask = store.accessSummary().capabilities.find((cap) => cap.id === 'askAi');
    expect(ask).toMatchObject({ label: 'Use Ask AI', bases: ['editor', 'channel'], defaults: ['admin', 'editor', 'channel'], spends: true, costsOptional: true, requires: ['readAssets', 'readResearch'], requiresByBase: { channel: ['readAssets'] } });
    expect(ask.description).toMatch(/^Ask questions, find things and make drafts, within this role’s access\./);
    // A new role from any template starts with it.
    for (const template of store.accessSummary().templates) expect(template.capabilities).toContain('askAi');
  });
});
