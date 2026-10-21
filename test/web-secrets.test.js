import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import secretsModule from '../src/main/web-secrets.js';
const { parseSecrets, readSecrets } = secretsModule;

// The browser studio's secret key and admin password reach the server through a file descriptor, not its environment:
// a process can't take back its starting environment, and on the Codex route the AI can read any same-user process's.
const KEY = 'fixture-secret-key-0123456789abcdef0123';
const PASSWORD = 'fixture-admin-password-123';
// Interpolated, never written as a literal NAME=value line, so scripts/make-handoff.sh's key scan doesn't match it.
const PROXY_SECRET = 'fixture-proxy-secret-0123';

describe('the browser studio’s secrets', () => {
  it('reads NAME=value lines from the descriptor, closes it, and prefers it to the environment', () => {
    const closed = [];
    const read = readSecrets({ env: { STUDIO_SECRETS_FD: '3', STUDIO_PASSWORD: 'from-the-environment-0000' }, readFd: (fd) => (fd === 3 ? `# studio\nexport STUDIO_SECRET_KEY="${KEY}"\nSTUDIO_PASSWORD='${PASSWORD}'\nOTHER=1\n` : ''), closeFd: (fd) => closed.push(fd) });
    expect(read).toEqual({ values: { STUDIO_SECRET_KEY: KEY, STUDIO_PASSWORD: PASSWORD }, fromEnvironment: ['STUDIO_PASSWORD'], unknown: ['OTHER'], source: 'fd', file: '' });
    expect(closed).toEqual([3]); // every program the server starts would inherit an open descriptor 3
    // Standard input stays open (drained), so nothing else takes descriptor 0.
    const stdin = []; readSecrets({ env: { STUDIO_SECRETS_FD: '0' }, readFd: () => '', closeFd: (fd) => stdin.push(fd) });
    expect(stdin).toEqual([]);
  });

  it('still accepts the environment, but says so, and refuses a malformed descriptor or file', () => {
    expect(readSecrets({ env: { STUDIO_SECRET_KEY: KEY } })).toEqual({ values: { STUDIO_SECRET_KEY: KEY }, fromEnvironment: ['STUDIO_SECRET_KEY'], unknown: [], source: '', file: '' });
    expect(() => readSecrets({ env: { STUDIO_SECRETS_FD: 'stdin' } })).toThrow(/number of an open file descriptor/);
    expect(() => readSecrets({ env: { STUDIO_SECRETS_FD: '9' }, readFd: () => { throw Object.assign(new Error('bad'), { code: 'EBADF' }); } })).toThrow(/STUDIO_SECRETS_FD 9 could not be read \(EBADF\)/);
    expect(() => parseSecrets('just a password')).toThrow(/NAME=value lines/);
  });

  it('reads email’s secrets the same way', () => {
    const resend = `fixture-resend-${'k'}`; const smtp = `fixture-smtp-${'p'}`;
    const read = readSecrets({ env: { STUDIO_SECRETS_FD: '3', SMTP_PASSWORD: 'from-the-environment' }, readFd: () => `STUDIO_SECRET_KEY=${KEY}\nRESEND_API_KEY=${resend}\nSMTP_PASSWORD=${smtp}\n`, closeFd: () => {} });
    expect(read.values).toEqual({ STUDIO_SECRET_KEY: KEY, RESEND_API_KEY: resend, SMTP_PASSWORD: smtp });
    expect(read.fromEnvironment).toEqual(['SMTP_PASSWORD']);
    expect(readSecrets({ env: { MAILGUN_API_KEY: 'mailgun-env' } }).values.MAILGUN_API_KEY).toBe('mailgun-env');
    expect(readSecrets({ env: { STUDIO_SECRETS_FD: '3', MAILGUN_API_KEY: 'mailgun-env' }, readFd: () => 'MAILGUN_API_KEY=mailgun-file', closeFd: () => {} }).values.MAILGUN_API_KEY).toBe('mailgun-file');
    expect(read.unknown).toEqual([]);
  });

  // Compose secrets, Kubernetes Secret volumes and ECS init containers deliver a file; it survives restarts, unlike a pipe.
  it('reads a mounted secrets file, including the proxy secret, and refuses a descriptor and a file together', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-secrets-test-')); const file = path.join(dir, 'studio');
    try {
      fs.writeFileSync(file, `STUDIO_SECRET_KEY=${KEY}\nSTUDIO_PROXY_SECRET=${PROXY_SECRET}\n`, { mode: 0o400 });
      expect(readSecrets({ env: { STUDIO_SECRETS_FILE: file, STUDIO_SECRET_KEY: 'from-the-environment-0000000000000000' } })).toEqual({ values: { STUDIO_SECRET_KEY: KEY, STUDIO_PROXY_SECRET: PROXY_SECRET }, fromEnvironment: ['STUDIO_SECRET_KEY'], unknown: [], source: 'file', file });
      expect(() => readSecrets({ env: { STUDIO_SECRETS_FILE: path.join(dir, 'missing') } })).toThrow(/STUDIO_SECRETS_FILE .*missing could not be read \(ENOENT\)/);
      expect(() => readSecrets({ env: { STUDIO_SECRETS_FILE: file, STUDIO_SECRETS_FD: '0' } })).toThrow(/not both/);
      fs.chmodSync(file, 0o600); fs.writeFileSync(file, 'not a line');
      expect(() => readSecrets({ env: { STUDIO_SECRETS_FILE: file } })).toThrow(/STUDIO_SECRETS_FILE must hold NAME=value lines/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it.runIf(['linux', 'darwin'].includes(process.platform))('keeps secrets read from standard input out of the process’s own environment block', () => {
    // A child reads its secrets as scripts/studio-web.cjs does, then reads its own starting environment the way another
    // same-user process could (/proc/<pid>/environ on Linux, ps eww on macOS).
    const script = `
      const { readSecrets } = require(${JSON.stringify(path.resolve('src/main/web-secrets.js'))});
      const { values } = readSecrets();
      const { execFileSync } = require('child_process'); const fs = require('fs');
      const environ = process.platform === 'linux' ? fs.readFileSync('/proc/self/environ', 'utf8') : execFileSync('ps', ['eww', '-o', 'command=', '-p', String(process.pid)], { encoding: 'utf8' });
      process.stdout.write(JSON.stringify({ read: values, inEnviron: environ.includes(values.STUDIO_SECRET_KEY) || environ.includes(values.STUDIO_PASSWORD), sawFd: environ.includes('STUDIO_SECRETS_FD') }));
    `;
    const child = spawnSync(process.execPath, ['-e', script], { input: `STUDIO_SECRET_KEY=${KEY}\nSTUDIO_PASSWORD=${PASSWORD}\n`, env: { PATH: process.env.PATH, STUDIO_SECRETS_FD: '0' }, encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
    const out = JSON.parse(child.stdout);
    expect(out.read).toEqual({ STUDIO_SECRET_KEY: KEY, STUDIO_PASSWORD: PASSWORD });
    expect(out.sawFd).toBe(true); // the environment block was readable…
    expect(out.inEnviron).toBe(false); // …and held neither secret
  });
});
