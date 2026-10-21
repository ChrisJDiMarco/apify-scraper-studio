'use strict';
// The browser studio's email: invites and admin notices (docs/web-deploy.md#email). One send() for every provider,
// chosen by EMAIL_PROVIDER:
// - off (the default): nothing is sent, and the studio behaves as it always has.
// - preview: each email is written as an .eml file to <data folder>/email-preview instead of being sent, so it can be
//   read with no email account. The files hold real sign-in links, so the folder is 0700 and only the newest 200 stay.
// - resend: Resend's HTTP API, with RESEND_API_KEY.
// - smtp: any SMTP server, with SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD. SendGrid, Mailgun,
//   Postmark, Amazon SES, Google Workspace and Microsoft 365 all take SMTP, so another service is settings, not code.
// EMAIL_FROM is the sender ("Golden Thread <studio@example.com>"); EMAIL_REPLY_TO is optional. The two secrets come
// from the secrets file like STUDIO_PASSWORD (scripts/studio-web.cjs), never from process.env once the server starts.
// A failure rejects with an Error whose code and message are safe to log: never an address's link, a key or a body.
// CommonJS, Electron-free.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDERS = Object.freeze(['off', 'preview', 'resend', 'smtp']);
const RESEND_URL = 'https://api.resend.com/emails';
const PREVIEW_KEEP = 200;
const TIMEOUT_MS = 15000;
// One plain address: no display name, no list, no line breaks.
const ADDRESS = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
// "Name <address>" or a bare address, with no line breaks (they would start a new header).
const SENDER = /^(?:[^\r\n<>]{0,120}<[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+>|[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+)$/;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const fail = (code, message) => Object.assign(new Error(message), { code });
// Sign-in links and anything shaped like a token or key, out of a message that may reach the log.
const redact = (value) => String(value ?? '').replace(/#signin=[^\s"'<>]*/gi, '#signin=[redacted]').replace(/(?:Bearer\s+|re_|sk-)[\w.-]{8,}|[0-9a-f]{32,}/gi, '[redacted]').slice(0, 300);

// What EMAIL_PROVIDER and its settings amount to: { provider, ready, problem, from, replyTo, resend?, smtp? }. A
// provider that is set but missing a setting is not ready, and problem says what to set.
function readConfig(env = {}, secrets = {}) {
  const raw = text(env.EMAIL_PROVIDER).toLowerCase();
  const provider = raw || 'off';
  if (!PROVIDERS.includes(provider)) return { provider: 'off', ready: false, problem: `EMAIL_PROVIDER "${raw.slice(0, 40)}" isn't one of ${PROVIDERS.join(', ')}, so no email is sent.` };
  if (provider === 'off') return { provider, ready: false, problem: '' };
  const from = text(env.EMAIL_FROM) || (provider === 'preview' ? 'Golden Thread <studio@example.com>' : '');
  const replyTo = text(env.EMAIL_REPLY_TO);
  const base = { provider, from, replyTo };
  if (!from) return { ...base, ready: false, problem: `Set EMAIL_FROM, the address emails come from, to send with ${provider}.` };
  if (!SENDER.test(from)) return { ...base, ready: false, problem: 'EMAIL_FROM must be an address, or a name and <address>.' };
  if (replyTo && !ADDRESS.test(replyTo)) return { ...base, ready: false, problem: 'EMAIL_REPLY_TO must be one email address.' };
  if (provider === 'resend') {
    const apiKey = text(secrets.RESEND_API_KEY);
    return apiKey ? { ...base, ready: true, problem: '', resend: { apiKey } } : { ...base, ready: false, problem: 'Set RESEND_API_KEY in the secrets to send with Resend.' };
  }
  if (provider === 'smtp') {
    const host = text(env.SMTP_HOST);
    if (!host) return { ...base, ready: false, problem: 'Set SMTP_HOST to send with SMTP.' };
    const portRaw = text(env.SMTP_PORT); const port = portRaw ? Number(portRaw) : 587;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ...base, ready: false, problem: 'SMTP_PORT must be a port number, such as 587 or 465.' };
    const secureRaw = text(env.SMTP_SECURE);
    const secure = secureRaw ? secureRaw === '1' || secureRaw.toLowerCase() === 'true' : port === 465;
    const user = text(env.SMTP_USER); const pass = typeof secrets.SMTP_PASSWORD === 'string' ? secrets.SMTP_PASSWORD : '';
    if (user && !pass) return { ...base, ready: false, problem: 'Set SMTP_PASSWORD in the secrets for SMTP_USER.' };
    return { ...base, ready: true, problem: '', smtp: { host, port, secure, user, pass } };
  }
  return { ...base, ready: true, problem: '' };
}

// createMailer({ env, secrets, dataDir, fetch, createTransport, now }) → { status(), send(message) }. fetch and
// createTransport are swappable for tests; createTransport is nodemailer's, loaded only for preview and smtp.
function createMailer({ env = process.env, secrets = {}, dataDir = '', fetch = globalThis.fetch, createTransport = null, now = () => new Date(), timeoutMs = TIMEOUT_MS } = {}) {
  const config = readConfig(env, secrets);
  const transportFactory = () => createTransport || require('nodemailer').createTransport;
  let smtpTransport = null;
  const status = () => ({ provider: config.provider, ready: config.ready, problem: config.problem });

  // Nodemailer builds the message for preview and smtp. Message-level file and URL access stay off, so nothing in a
  // message can make it read a file or fetch a URL.
  function nodemailerMessage({ to, subject, text: plain, html, kind }) {
    return { from: config.from, to, ...(config.replyTo ? { replyTo: config.replyTo } : {}), subject, text: plain, html, disableFileAccess: true, disableUrlAccess: true, headers: { 'X-Golden-Thread-Email': kind } };
  }
  async function preview(message) {
    if (!dataDir) throw fail('emailPreviewFolder', 'The preview has no data folder to write to.');
    const folder = path.join(dataDir, 'email-preview');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const transport = transportFactory()({ streamTransport: true, buffer: true, newline: 'unix' });
    const built = await transport.sendMail(nodemailerMessage(message));
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const file = path.join(folder, `${stamp}-${message.kind}-${crypto.randomBytes(3).toString('hex')}.eml`);
    fs.writeFileSync(file, built.message, { mode: 0o600 });
    prunePreviews(folder);
    return { provider: 'preview', id: path.basename(file), file };
  }
  async function resend(message) {
    if (typeof fetch !== 'function') throw fail('emailNoFetch', 'This server can’t make web requests.');
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    let response;
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'golden-thread-studio' },
        body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html, ...(config.replyTo ? { reply_to: config.replyTo } : {}), tags: [{ name: 'kind', value: message.kind }] }),
      });
    } catch (error) { throw fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'emailTimeout' : 'emailNetwork', `Resend couldn’t be reached (${redact(error?.code || error?.name || error?.message)}).`); }
    let body = null; try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) throw fail('emailRejected', `Resend refused the email (${response.status}${body?.name ? ` ${redact(body.name)}` : ''}${body?.message ? `: ${redact(body.message)}` : ''}).`);
    return { provider: 'resend', id: typeof body?.id === 'string' ? body.id : '' };
  }
  async function smtp(message) {
    if (!smtpTransport) {
      const { host, port, secure, user, pass } = config.smtp;
      smtpTransport = transportFactory()({ host, port, secure, requireTLS: !secure, ...(user ? { auth: { user, pass } } : {}), connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs, disableFileAccess: true, disableUrlAccess: true });
    }
    try {
      const info = await smtpTransport.sendMail(nodemailerMessage(message));
      return { provider: 'smtp', id: typeof info?.messageId === 'string' ? info.messageId : '' };
    } catch (error) {
      throw fail(error?.responseCode ? 'emailRejected' : 'emailNetwork', `The SMTP server didn’t take the email (${redact([error?.code, error?.responseCode].filter(Boolean).join(' ') || 'error')}).`);
    }
  }

  // send({ to, subject, text, html, kind }) → { provider, id, file? }. Rejects when email is off or not set up, or the
  // provider refuses; callers log that and carry on.
  async function send(message = {}) {
    if (!config.ready) throw fail(config.provider === 'off' && !config.problem ? 'emailOff' : 'emailNotConfigured', config.problem || 'Email is off.');
    const to = text(message.to).toLowerCase();
    if (!ADDRESS.test(to) || to.length > 254) throw fail('emailAddress', 'That isn’t an email address.');
    const subject = text(message.subject).replace(/[\r\n]+/g, ' ').slice(0, 200);
    if (!subject || typeof message.text !== 'string') throw fail('emailEmpty', 'An email needs a subject and a body.');
    const kind = /^[a-z][a-z0-9-]{0,40}$/.test(message.kind || '') ? message.kind : 'notice';
    const clean = { to, subject, text: message.text, html: typeof message.html === 'string' ? message.html : undefined, kind };
    if (config.provider === 'preview') return preview(clean);
    if (config.provider === 'resend') return resend(clean);
    return smtp(clean);
  }
  return { status, send };
}

// Keeps the newest PREVIEW_KEEP files (their names start with the time they were written).
function prunePreviews(folder) {
  try {
    const files = fs.readdirSync(folder).filter((name) => name.endsWith('.eml')).sort();
    for (const name of files.slice(0, Math.max(0, files.length - PREVIEW_KEEP))) fs.rmSync(path.join(folder, name), { force: true });
  } catch (_) { /* an untidy preview folder never fails a send */ }
}

module.exports = { createMailer, readConfig, redact, PROVIDERS, RESEND_URL, PREVIEW_KEEP };
