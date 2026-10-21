import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import studio from './helpers/roles-studio.js';

// Email on the real main process (src/main/index.js) under the browser studio's runtime, as roles-gate.test.js loads it:
// EMAIL_PROVIDER=resend with a fake fetch that records each email, and fails any to fail@semrush.com. Invites email
// each person their link, a first sign-in (link or company sign-in) emails the other admins once, a failed email never
// fails the invite, and no sign-in link or address reaches the log.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const { MEMBERS, identity, seedStudio } = studio;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roots = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function loadStudio({ env, emailSecrets, fetch }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-hooks-')); roots.push(root);
  const dataDir = path.join(root, 'data'); seedStudio(dataDir);
  const runtime = mainRequire('./web-runtime');
  runtime.configure({ dataDir, secretKey: 'email-hooks-test-secret-0123456789abcdef', emailSecrets });
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    require: (name) => (name === 'child_process' ? { spawn: () => { throw new Error('No AI in this test.'); } } : mainRequire(name)),
    process: { pid: process.pid, platform: 'darwin', env: { STUDIO_RUNTIME: 'web', STUDIO_PASSWORD: 'email-hooks-admin-password', ...env }, argv: [] },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, fetch,
  }, { filename: mainPath });
  return { runtime, dataDir };
}

describe('email from the browser studio', () => {
  let runtime; let dataDir; let logs; const sent = [];
  const session = { expires: Date.now() + 3600000, kind: 'link', memberId: MEMBERS.chris.id, linkId: 'fixture', viewAs: null };
  const chris = (channel, payload) => runtime.invoke(channel, payload, { user: identity(MEMBERS.chris), session, origin: 'https://studio.example.com' }).then((outcome) => outcome.result);
  const people = () => runtime.provided('people');
  async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await sleep(10); } throw new Error('Timed out waiting.'); }

  beforeAll(async () => {
    const write = process.stdout.write.bind(process.stdout); logs = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => { logs.push(String(chunk)); return /"event":"email-/.test(String(chunk)) ? true : write(chunk, ...rest); });
    const fetch = async (url, init) => {
      const body = JSON.parse(init.body); sent.push({ url, auth: init.headers.Authorization, ...body });
      return body.to[0] === 'fail@semrush.com' ? new Response(JSON.stringify({ name: 'internal_server_error', message: 'Down' }), { status: 500 }) : new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    };
    ({ runtime, dataDir } = loadStudio({ env: { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Golden Thread <studio@searchengineland.com>', STUDIO_PUBLIC_ORIGIN: 'https://studio.example.com' }, emailSecrets: { RESEND_API_KEY: 're_test_hooks_key' }, fetch }));
    await sleep(50);
  });
  afterAll(() => { vi.restoreAllMocks(); runtime?.shutdown(); });

  it('says email is on, so the invite form can say so', async () => {
    expect((await chris('team:list')).signIn).toEqual({ web: true, sso: false, links: true, linkDays: 30, email: true });
  });

  it('emails each new person their own sign-in link, and a failed email still invites them', async () => {
    const result = await chris('team:invite', { people: [{ email: 'Jordan@Semrush.com' }, { email: 'fail@semrush.com', name: 'Fay' }], role: 'editor' });
    const [jordan, fay] = result.members;
    expect(result.members.map((member) => member.email)).toEqual(['jordan@semrush.com', 'fail@semrush.com']);
    expect(result.emails).toEqual([{ id: jordan.id, status: 'sent' }, { id: fay.id, status: 'failed' }]);
    expect(result.links.map((link) => link.id)).toEqual([jordan.id, fay.id]); // the fallback to copy is still there
    const toJordan = sent.find((email) => email.to[0] === 'jordan@semrush.com');
    const jordanLink = result.links.find((link) => link.id === jordan.id).url;
    expect(toJordan).toMatchObject({ auth: 'Bearer re_test_hooks_key', from: 'Golden Thread <studio@searchengineland.com>', subject: 'You’ve been invited to the Golden Thread studio', tags: [{ name: 'kind', value: 'invite' }] });
    expect(toJordan.text).toContain(jordanLink);
    expect(toJordan.text).toContain('Chris invited you to the Golden Thread studio as an Editor.');
    // Each link goes only to its own person.
    const fayLink = result.links.find((link) => link.id === fay.id).url;
    expect(sent.filter((email) => email.text.includes(jordanLink)).map((email) => email.to)).toEqual([['jordan@semrush.com']]);
    expect(sent.filter((email) => email.text.includes(fayLink)).map((email) => email.to)).toEqual([['fail@semrush.com']]);
    expect((await chris('team:list')).members.map((member) => member.email)).toEqual(expect.arrayContaining(['jordan@semrush.com', 'fail@semrush.com']));
  });

  it('tells the other admins once when someone signs in for the first time with their link', async () => {
    const result = await chris('team:invite', { people: [{ email: 'casey@semrush.com', name: 'Casey Kim' }], role: 'editor' });
    const token = result.links[0].url.split('#signin=')[1];
    const before = sent.length;
    expect(people().linkLogin(token, { origin: 'https://studio.example.com' })).toMatchObject({ memberId: result.members[0].id });
    await until(() => sent.length > before);
    const notices = sent.slice(before);
    expect(notices.map((email) => email.to[0])).toEqual(['chris@semrush.com']); // the only admin, and never Casey
    expect(notices[0]).toMatchObject({ subject: 'Casey Kim just signed in for the first time', tags: [{ name: 'kind', value: 'first-sign-in' }] });
    expect(notices[0].text).toContain('Casey Kim (casey@semrush.com, Editor) just signed in to Golden Thread for the first time');
    expect(notices[0].text).toContain('https://studio.example.com');
    expect(notices[0].text).not.toContain(token);
    // Signing in again, or after a restart reads team.json back, is not a first time.
    people().linkLogin(token, { origin: 'https://studio.example.com' });
    await sleep(50);
    expect(sent.length).toBe(before + 1);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'content-studio', 'team.json'), 'utf8')).members.find((member) => member.email === 'casey@semrush.com');
    expect(saved.firstSignInAt).toEqual(expect.any(String));
  });

  it('tells admins about a first company sign-in, but not about someone seen before', async () => {
    const before = sent.length;
    // Riley is in the seeded team and has never signed in. (With email off, roles-gate.test.js sees no emails.)
    const teamFile = path.join(dataDir, 'content-studio', 'team.json');
    expect(people().fromProxyEmail('riley@semrush.com')).toMatchObject({ id: MEMBERS.riley.id, role: 'editor' });
    await until(() => sent.length > before);
    expect(sent.slice(before).map((email) => [email.to[0], email.subject])).toEqual([['chris@semrush.com', 'Riley just signed in for the first time']]);
    people().fromProxyEmail('riley@semrush.com');
    expect(people().fromProxyEmail('nobody@semrush.com')).toMatchObject({ role: null }); // a guest is nobody's first sign-in
    await sleep(50);
    expect(sent.length).toBe(before + 1);
    expect(JSON.parse(fs.readFileSync(teamFile, 'utf8')).members.find((member) => member.id === MEMBERS.riley.id).firstSignInAt).toEqual(expect.any(String));
  });

  it('keeps sign-in links, addresses and the key out of the log', () => {
    const lines = logs.filter((line) => /"event":"email-/.test(line));
    expect(lines.some((line) => line.includes('"event":"email-sent"'))).toBe(true);
    expect(lines.some((line) => line.includes('"event":"email-failed"') && line.includes('"code":"emailRejected"'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(/#signin=[0-9a-f]|[0-9a-f]{64}/);
      expect(line).not.toMatch(/@semrush\.com/);
      expect(line).not.toContain('re_test_hooks_key');
    }
  });
});

