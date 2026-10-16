import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import teamStoreModule from '../src/main/team-store.js';
const { createTeamStore, migrate, TEAM_VERSION } = teamStoreModule;
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
    expect(h.store.prefsFor('local')).toEqual({ uiMode: '', welcomedAt: '' });
    expect(fs.existsSync(path.join(h.root, 'team.json'))).toBe(false);
    h.store.saveMember({ name: 'Alex', email: 'Alex@Semrush.com ', role: 'channel', channelId: 'blog' }, ADMIN);
    const saved = h.file();
    expect(saved).toMatchObject({ version: TEAM_VERSION, members: [{ name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false, createdBy: { id: 'owner', name: 'Studio admin' }, lastSeenAt: '', link: null }], adoptions: [], activity: [], prefs: {} });
    expect(saved.members[0].id).toMatch(/^member-[0-9a-f-]{36}$/);
    expect(fs.readdirSync(h.root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(fs.statSync(path.join(h.root, 'team.json')).mode & 0o777).toBe(0o600);
    expect(h.open().listMembers()).toEqual(h.store.listMembers()); // load once, then everything is in memory
  });

  it('refuses a damaged file or one from a newer studio instead of starting empty', () => {
    for (const text of ['{ not json', '', '[]', '{"version":1,"members":{}}', '{"version":1,"members":[{"name":"No id"}]}', '{"version":0}']) {
      const h = harness({ files: { 'team.json': text }, openNow: false });
      expect(() => h.open()).toThrow('Team data could not be read (content-studio/team.json). Restore it from a backup before starting.');
    }
    expect(() => harness({ files: { 'team.json': JSON.stringify({ version: TEAM_VERSION + 1, members: [] }) }, openNow: false }).open()).toThrow('This team file is from a newer Scraper Studio. Update the app or server.');
    const legacy = harness({ files: { 'team.json': JSON.stringify({ members: [{ id: 'member-1', name: 'Pat', email: 'pat@semrush.com', role: 'editor' }] }) } });
    expect(legacy.store.listMembers()).toMatchObject([{ id: 'member-1', role: 'editor', channelId: null, disabled: false, link: null, serverAdmin: false }]);
    expect(migrate({ version: 1, members: [] })).toEqual({ version: 1, members: [] });
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
    expect(() => store.saveMember({ name: 'Pat', email: 'a@semrush.com', role: 'owner' }, ADMIN)).toThrow('Choose Admin, Editor or Channel owner.');
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
    expect(store.prefsFor(alex.id)).toEqual({ uiMode: '', welcomedAt: '' });
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
    expect(store.fromProxyEmail('Riley@Semrush.com')).toEqual({ id: riley.id, name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'proxy', disabled: false, memberSince: riley.createdAt });
    store.saveMember({ id: riley.id, disabled: true }, ADMIN);
    expect(store.fromProxyEmail('riley@semrush.com')).toMatchObject({ id: riley.id, role: null, disabled: true });
    expect(store.fromProxyEmail('pat@semrush.com')).toEqual({ id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, channelId: null, via: 'proxy', disabled: false, memberSince: null });
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
  it('keeps only the layout and the welcome date', () => {
    const h = harness(); const { store } = h;
    expect(store.setPrefs('owner', { uiMode: 'classic', viewAs: { role: 'channel', channelId: 'blog' }, theme: 'dark' })).toEqual({ uiMode: 'classic', welcomedAt: '' });
    expect(h.file().prefs).toEqual({ owner: { uiMode: 'classic' } });
    expect(store.setPrefs('owner', { welcomedAt: '2026-10-16T09:00:00Z' })).toEqual({ uiMode: 'classic', welcomedAt: '2026-10-16T09:00:00.000Z' });
    expect(() => store.setPrefs('owner', { uiMode: 'advanced' })).toThrow('Choose Simple or Advanced.');
    expect(() => store.setPrefs('owner', { welcomedAt: 'yesterday' })).toThrow('Choose a valid date.');
    expect(() => store.setPrefs('__proto__', { uiMode: 'simple' })).toThrow(/Sign in/);
    expect(() => store.setPrefs('', { uiMode: 'simple' })).toThrow(/Sign in/);
    const writes = vi.spyOn(fs, 'renameSync');
    store.setPrefs('owner', { uiMode: 'classic' });
    expect(writes).not.toHaveBeenCalled();
    store.setPrefs('owner', { uiMode: 'simple', welcomedAt: '' });
    expect(h.file().prefs).toEqual({ owner: { uiMode: 'simple' } });
    expect(store.prefsFor('local')).toEqual({ uiMode: '', welcomedAt: '' });
    expect(store.prefsFor('toString')).toEqual({ uiMode: '', welcomedAt: '' });
  });
});
