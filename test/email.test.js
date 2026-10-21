import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// src/main/email.js (providers) and src/main/email-templates.js. Nothing here reaches the network: Resend is a fake
// fetch, SMTP a fake nodemailer transport, and preview writes into a temporary folder.
const require = createRequire(import.meta.url);
const { createMailer, readConfig, redact, RESEND_URL, PREVIEW_KEEP } = require('../src/main/email.js');
const { inviteEmail, firstSignInEmail } = require('../src/main/email-templates.js');
const roots = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-')); roots.push(dir); return dir; };
afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });
const TOKEN = 'a'.repeat(64);
const message = { to: 'Pat@Semrush.com', subject: 'You’ve been invited', text: `Sign in: https://studio.example.com/#signin=${TOKEN}`, html: '<p>Hi</p>', kind: 'invite' };
const forbiddenFetch = () => { throw new Error('No network in this test.'); };

describe('email settings', () => {
  it('is off by default and when EMAIL_PROVIDER is off', async () => {
    for (const env of [{}, { EMAIL_PROVIDER: '' }, { EMAIL_PROVIDER: 'off' }, { EMAIL_PROVIDER: ' OFF ' }]) {
      const mailer = createMailer({ env, fetch: forbiddenFetch });
      expect(mailer.status()).toEqual({ provider: 'off', ready: false, problem: '' });
      await expect(mailer.send(message)).rejects.toMatchObject({ code: 'emailOff' });
    }
  });

  it('says what is missing instead of sending', () => {
    expect(readConfig({ EMAIL_PROVIDER: 'mailchimp' })).toMatchObject({ provider: 'off', ready: false, problem: expect.stringContaining('isn\'t one of off, preview, resend, smtp') });
    expect(readConfig({ EMAIL_PROVIDER: 'resend' })).toMatchObject({ ready: false, problem: expect.stringContaining('EMAIL_FROM') });
    expect(readConfig({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'studio@example.com' })).toMatchObject({ ready: false, problem: expect.stringContaining('RESEND_API_KEY') });
    expect(readConfig({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'studio@example.com' })).toMatchObject({ ready: false, problem: expect.stringContaining('SMTP_HOST') });
    expect(readConfig({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'abc' })).toMatchObject({ ready: false, problem: expect.stringContaining('SMTP_PORT') });
    expect(readConfig({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey' })).toMatchObject({ ready: false, problem: expect.stringContaining('SMTP_PASSWORD') });
    expect(readConfig({ EMAIL_PROVIDER: 'preview', EMAIL_FROM: 'Studio\r\nBcc: x@evil.com <a@b.co>' })).toMatchObject({ ready: false, problem: expect.stringContaining('EMAIL_FROM') });
    expect(readConfig({ EMAIL_PROVIDER: 'preview', EMAIL_REPLY_TO: 'a@b.co, c@d.co' })).toMatchObject({ ready: false, problem: expect.stringContaining('EMAIL_REPLY_TO') });
  });

  it('reads the SMTP settings, with TLS from the port unless SMTP_SECURE says otherwise', () => {
    const base = { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Golden Thread <studio@example.com>', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'apikey' };
    expect(readConfig(base, { SMTP_PASSWORD: 'pw' }).smtp).toEqual({ host: 'smtp.example.com', port: 587, secure: false, user: 'apikey', pass: 'pw' });
    expect(readConfig({ ...base, SMTP_PORT: '465' }, { SMTP_PASSWORD: 'pw' }).smtp).toMatchObject({ port: 465, secure: true });
    expect(readConfig({ ...base, SMTP_PORT: '2525', SMTP_SECURE: '1' }, { SMTP_PASSWORD: 'pw' }).smtp).toMatchObject({ port: 2525, secure: true });
    expect(readConfig({ ...base, SMTP_USER: '' }).smtp).toMatchObject({ user: '', pass: '' }); // a relay with no sign-in
  });

  it('refuses an address that is not one plain email', async () => {
    const mailer = createMailer({ env: { EMAIL_PROVIDER: 'preview' }, dataDir: tempDir() });
    for (const to of ['', 'pat', 'pat@x.com, sam@y.com', 'pat@x.com\r\nBcc: sam@y.com', 'Pat <pat@x.com>']) await expect(mailer.send({ ...message, to })).rejects.toMatchObject({ code: 'emailAddress' });
  });
});

describe('the preview provider', () => {
  it('writes each email as a private .eml file in the data folder instead of sending it', async () => {
    const dataDir = tempDir();
    const mailer = createMailer({ env: { EMAIL_PROVIDER: 'preview' }, dataDir, fetch: forbiddenFetch, now: () => new Date('2026-10-21T12:00:00Z') });
    expect(mailer.status()).toEqual({ provider: 'preview', ready: true, problem: '' });
    const sent = await mailer.send(message);
    expect(sent).toMatchObject({ provider: 'preview', file: expect.stringMatching(/email-preview[\\/]2026-10-21T12-00-00-000Z-invite-[0-9a-f]{6}\.eml$/) });
    const eml = fs.readFileSync(sent.file, 'utf8');
    expect(eml).toMatch(/^To: pat@semrush\.com$/m);
    expect(eml).toMatch(/^From: Golden Thread <studio@example\.com>$/m);
    expect(eml).toMatch(/^X-Golden-Thread-Email: invite$/m);
    expect(eml).toContain('multipart/alternative');
    if (process.platform !== 'win32') {
      expect(fs.statSync(sent.file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dataDir, 'email-preview')).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps only the newest files', async () => {
    const dataDir = tempDir(); const folder = path.join(dataDir, 'email-preview'); fs.mkdirSync(folder);
    for (let i = 0; i < PREVIEW_KEEP + 3; i++) fs.writeFileSync(path.join(folder, `2026-01-01T00-00-${String(i).padStart(3, '0')}-invite-000000.eml`), 'old');
    await createMailer({ env: { EMAIL_PROVIDER: 'preview' }, dataDir }).send(message);
    const files = fs.readdirSync(folder).sort();
    expect(files).toHaveLength(PREVIEW_KEEP);
    expect(files[0]).toBe('2026-01-01T00-00-004-invite-000000.eml');
  });
});

describe('the Resend provider', () => {
  const env = { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Golden Thread <studio@searchengineland.com>', EMAIL_REPLY_TO: 'john@semrush.com' };
  it('posts the email to Resend’s API with the key from the secrets', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'email-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const mailer = createMailer({ env, secrets: { RESEND_API_KEY: 're_test_key_123456' }, fetch });
    expect(await mailer.send(message)).toEqual({ provider: 'resend', id: 'email-123' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key_123456');
    expect(JSON.parse(init.body)).toEqual({ from: env.EMAIL_FROM, to: ['pat@semrush.com'], subject: message.subject, text: message.text, html: message.html, reply_to: 'john@semrush.com', tags: [{ name: 'kind', value: 'invite' }] });
  });

  it('rejects with a loggable reason when Resend refuses or can’t be reached', async () => {
    const refused = createMailer({ env, secrets: { RESEND_API_KEY: 're_test_key_123456' }, fetch: async () => new Response(JSON.stringify({ name: 'validation_error', message: `Bad link #signin=${TOKEN}` }), { status: 422 }) });
    const error = await refused.send(message).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'emailRejected', message: 'Resend refused the email (422 validation_error: Bad link #signin=[redacted]).' });
    const offline = createMailer({ env, secrets: { RESEND_API_KEY: 're_test_key_123456' }, fetch: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); } });
    await expect(offline.send(message)).rejects.toMatchObject({ code: 'emailNetwork', message: 'Resend couldn’t be reached (ENOTFOUND).' });
    const slow = createMailer({ env, secrets: { RESEND_API_KEY: 're_test_key_123456' }, fetch: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); } });
    await expect(slow.send(message)).rejects.toMatchObject({ code: 'emailTimeout' });
  });
});

describe('the Mailgun HTTPS provider', () => {
  const env = { EMAIL_PROVIDER: 'mailgun', EMAIL_FROM: 'Golden Thread <studio@searchengineland.com>', MAILGUN_DOMAIN: 'searchengineland.com' };
  const secrets = { MAILGUN_API_KEY: 'test-mailgun-secret' };
  it('requires a domain, a valid region and a secret supplied through the secret reader', () => {
    expect(readConfig({ ...env, MAILGUN_DOMAIN: '../evil' }, secrets).ready).toBe(false);
    expect(readConfig({ ...env, MAILGUN_REGION: 'other' }, secrets).ready).toBe(false);
    expect(readConfig({ ...env, MAILGUN_API_KEY: secrets.MAILGUN_API_KEY }).ready).toBe(false);
    expect(readConfig(env, secrets).ready).toBe(true);
  });
  it.each(['us', 'eu'])('sends multipart messages to the fixed %s API with tracking disabled', async (region) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'mailgun-123' })));
    const mailer = createMailer({ env: { ...env, MAILGUN_REGION: region, EMAIL_REPLY_TO: 'john@semrush.com' }, secrets, fetch });
    expect(await mailer.send(message)).toEqual({ provider: 'mailgun', id: 'mailgun-123' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://${region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'}/v3/searchengineland.com/messages`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Basic ${Buffer.from('api:test-mailgun-secret').toString('base64')}` } });
    expect(Object.fromEntries(init.body)).toEqual({ from: env.EMAIL_FROM, to: 'pat@semrush.com', subject: message.subject, text: message.text, html: message.html, 'h:Reply-To': 'john@semrush.com', 'o:tag': 'invite', 'o:tracking': 'no', 'o:tracking-clicks': 'no', 'o:tracking-opens': 'no' });
  });
  it('never exposes provider responses, credentials or sign-in links in errors', async () => {
    const rejected = createMailer({ env, secrets, fetch: async () => new Response(JSON.stringify({ message: `${secrets.MAILGUN_API_KEY} ${message.text}` }), { status: 401 }) });
    await expect(rejected.send(message)).rejects.toMatchObject({ code: 'emailRejected', message: 'Mailgun refused the email (HTTP 401).' });
    const offline = createMailer({ env, secrets, fetch: async () => { throw Error(`${secrets.MAILGUN_API_KEY} ${message.text}`); } });
    await expect(offline.send(message)).rejects.toMatchObject({ code: 'emailNetwork', message: 'Mailgun could not be reached.' });
    const slow = createMailer({ env, secrets, fetch: async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }); } });
    await expect(slow.send(message)).rejects.toMatchObject({ code: 'emailTimeout' });
  });
  it('rejects malformed success replies rather than reporting a sent email', async () => {
    for (const body of ['not-json', '{}']) {
      await expect(createMailer({ env, secrets, fetch: async () => new Response(body) }).send(message)).rejects.toMatchObject({ code: 'emailRejected' });
    }
  });
});

describe('the SMTP provider', () => {
  const env = { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'apikey' };
  it('sends through one transport made from the SMTP settings', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<m1@example.com>' }));
    const createTransport = vi.fn(() => ({ sendMail }));
    const mailer = createMailer({ env, secrets: { SMTP_PASSWORD: 'smtp-pass' }, createTransport, fetch: forbiddenFetch });
    expect(await mailer.send(message)).toEqual({ provider: 'smtp', id: '<m1@example.com>' });
    await mailer.send({ ...message, to: 'sam@semrush.com' });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0][0]).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'apikey', pass: 'smtp-pass' }, disableFileAccess: true, disableUrlAccess: true });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'studio@example.com', to: 'pat@semrush.com', subject: message.subject, text: message.text, html: message.html, disableFileAccess: true, disableUrlAccess: true });
  });

  it('rejects with the server’s code, never its whole answer', async () => {
    const createTransport = () => ({ sendMail: async () => { throw Object.assign(new Error(`550 rejected ${TOKEN}`), { code: 'EENVELOPE', responseCode: 550 }); } });
    const error = await createMailer({ env, secrets: { SMTP_PASSWORD: 'smtp-pass' }, createTransport }).send(message).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'emailRejected', message: 'The SMTP server didn’t take the email (EENVELOPE 550).' });
  });
});

describe('redaction', () => {
  it('takes sign-in links, keys and long hex out of anything that may be logged', () => {
    expect(redact(`https://studio.example.com/#signin=${TOKEN} failed`)).toBe('https://studio.example.com/#signin=[redacted] failed');
    expect(redact('Bearer re_abcdefgh12345 and re_live_key_abcdef')).not.toMatch(/re_abcdefgh12345|re_live_key_abcdef/);
    expect(redact(TOKEN)).toBe('[redacted]');
  });
});

describe('email templates', () => {
  it('invites with the person’s own sign-in link', () => {
    const url = `https://goldenthread.searchengineland.com/#signin=${TOKEN}`;
    const email = inviteEmail({ name: 'Pat Lee', inviter: 'John Blanchard', roleLabel: 'Editor', url, expiresAt: '2026-11-20T15:00:00.000Z' });
    expect(email.subject).toBe('You’ve been invited to the Golden Thread studio');
    expect(email.text).toContain('Hi Pat Lee,');
    expect(email.text).toContain('John Blanchard invited you to the Golden Thread studio as an Editor.');
    expect(email.text).toContain(`Sign in with your personal link:\n${url}`);
    expect(email.text).toContain('It works until Nov 20, 2026.');
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain('Sign in to Golden Thread');
    expect(email.html).toContain('You’ve been invited to the studio');
  });

  it('tells people to use their company account when the studio uses company sign-in', () => {
    const email = inviteEmail({ name: 'Pat', inviter: 'John', roleLabel: 'Channel owner', sso: true, origin: 'https://goldenthread.searchengineland.com' });
    expect(email.text).toContain('as a Channel owner');
    expect(email.text).toContain('Sign in with your company account at https://goldenthread.searchengineland.com.');
    expect(email.text).not.toContain('#signin=');
    expect(email.html).toContain('company account');
  });

  it('escapes what people typed in the HTML', () => {
    const email = inviteEmail({ name: '<script>alert(1)</script>', inviter: 'A & B', url: 'https://x.example.com/#signin=abc"onmouseover="x' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B');
    expect(email.html).not.toContain('"onmouseover="');
  });

  it('tells admins about a first sign-in', () => {
    const email = firstSignInEmail({ name: 'Pat Lee', email: 'pat@semrush.com', roleLabel: 'Editor', at: '2026-10-21T18:00:00Z', origin: 'https://goldenthread.searchengineland.com' });
    expect(email.subject).toBe('Pat Lee just signed in for the first time');
    expect(email.text).toContain('Pat Lee (pat@semrush.com, Editor) just signed in to Golden Thread for the first time on Oct 21, 2026.');
    expect(email.text).toContain('People: https://goldenthread.searchengineland.com');
    expect(email.html).toContain('Pat Lee just signed in for the first time');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(firstSignInEmail({ name: 'Evil\r\nBcc: x@y.com' }).subject).toBe('Evil Bcc: x@y.com just signed in for the first time');
  });
});
