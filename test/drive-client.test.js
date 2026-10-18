import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import client from '../src/main/drive-client.js';

// The Google Drive folder sync's client (src/main/drive-client.js): the service account key, the signed JWT and its
// token exchange, Drive REST with retries, and the plain-language errors. Mocked fetch only; nothing leaves the machine.
const { parseServiceAccount, signJwt, createServiceAccountAuth, createDriveClient, parseFolderLink, friendly, TOKEN_URL, DRIVE_SCOPE } = client;
// A throwaway RSA key made per run, so no key-shaped text is ever committed.
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const KEY_JSON = JSON.stringify({ type: 'service_account', project_id: 'studio-fixture', private_key_id: 'kid-fixture', private_key: PEM, client_email: 'studio-sync@studio-fixture.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://attacker.example/token' });
const reply = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const decode = (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

describe('service account key', () => {
  it('keeps only the fields it needs from a pasted JSON key', () => {
    const key = parseServiceAccount(KEY_JSON);
    expect(key).toEqual({ type: 'service_account', client_email: 'studio-sync@studio-fixture.iam.gserviceaccount.com', private_key: PEM, private_key_id: 'kid-fixture', project_id: 'studio-fixture' });
    expect(key.token_uri).toBeUndefined();
  });

  it('says plainly what is wrong with a bad paste', () => {
    expect(() => parseServiceAccount('')).toThrow('Paste the service account’s JSON key.');
    expect(() => parseServiceAccount('not json')).toThrow(/That isn’t a JSON key/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toThrow(/isn’t a service account key/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'someone@example.com', private_key: PEM }))).toThrow(/no service account email/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'a@b.iam.gserviceaccount.com', private_key: 'broken' }))).toThrow(/private_key can’t be read/);
  });
});

describe('JWT and token exchange', () => {
  it('signs an RS256 assertion for the Drive scope that the public key verifies', () => {
    const key = parseServiceAccount(KEY_JSON);
    const jwt = signJwt(key, Date.UTC(2026, 9, 18, 12));
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-fixture' });
    expect(decode(claims)).toEqual({ iss: key.client_email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: 1792324800, exp: 1792328400 });
    expect(crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(pair.publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))).toBe(true);
  });

  it('exchanges it at Google’s token endpoint (never the key file’s token_uri) and caches the token until it expires', async () => {
    let clock = Date.UTC(2026, 9, 18, 12);
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(options.method).toBe('POST');
      const form = new URLSearchParams(options.body);
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(form.get('assertion').split('.')).toHaveLength(3);
      return reply({ access_token: `token-${fetchImpl.mock.calls.length}`, expires_in: 3600, token_type: 'Bearer' });
    });
    const auth = createServiceAccountAuth({ key: parseServiceAccount(KEY_JSON), fetchImpl, now: () => clock });
    expect(await Promise.all([auth.token(), auth.token()])).toEqual(['token-1', 'token-1']); // one exchange for both
    clock += 58 * 60 * 1000; expect(await auth.token()).toBe('token-1');
    clock += 2 * 60 * 1000; expect(await auth.token()).toBe('token-2'); // within a minute of expiry: a fresh one
    auth.refresh(); expect(await auth.token()).toBe('token-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('turns a refused key into one plain sentence', async () => {
    const auth = createServiceAccountAuth({ key: parseServiceAccount(KEY_JSON), fetchImpl: async () => reply({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400) });
    await expect(auth.token()).rejects.toMatchObject({ code: 'driveKeyRejected', message: expect.stringMatching(/didn’t accept this service account key.*clock is wrong/) });
    const offline = createServiceAccountAuth({ key: parseServiceAccount(KEY_JSON), fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await expect(offline.token()).rejects.toMatchObject({ code: 'driveNetwork', retryable: true });
  });
});

describe('Drive REST', () => {
  const quiet = { sleep: async () => {} };

  it('asks for shared drives on every call and retries 429 and 5xx with backoff', async () => {
    const answers = [reply({ error: { code: 503 } }, 503), reply({ error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } }, 429, { 'retry-after': '2' }), reply({ id: 'folder-1', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' })];
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (url, options) => { expect(url).toContain('supportsAllDrives=true'); expect(options.headers.Authorization).toBe('Bearer drive-token'); expect(options.redirect).toBe('error'); return answers.shift(); });
    const drive = createDriveClient({ getToken: () => 'drive-token', fetchImpl, sleep });
    expect((await drive.folder('folder-1')).name).toBe('Reports');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[1][0]).toBe(2000); // Retry-After is honored
  });

  it('gets a new token once after a 401', async () => {
    const tokens = ['old-token', 'new-token']; const refresh = vi.fn(() => tokens.shift());
    const fetchImpl = vi.fn(async (_url, options) => (options.headers.Authorization === 'Bearer old-token' ? reply({ error: { code: 401 } }, 401) : reply({ id: 'x' })));
    const drive = createDriveClient({ getToken: () => tokens[0], refresh, fetchImpl, ...quiet });
    expect(await drive.folder('x')).toEqual({ id: 'x' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('maps Drive’s answers to plain language, naming the service account to share with', () => {
    const who = 'studio-sync@studio-fixture.iam.gserviceaccount.com';
    expect(friendly(404, {}, who).message).toBe(`The studio can’t see that folder or file. Share the folder with ${who} as Editor (in a shared drive: Contributor or higher), and check the link.`);
    expect(friendly(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } }, who).message).toMatch(/can see the folder but can’t add files to it. Share the folder with studio-sync@/);
    expect(friendly(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, who)).toMatchObject({ code: 'driveQuota', message: expect.stringMatching(/use a folder in a shared drive/) });
    expect(friendly(403, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Google Drive API has not been used in project 1' } }, who).code).toBe('driveApiOff');
    expect(friendly(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, who)).toMatchObject({ code: 'driveRate', retryable: true });
    expect(friendly(401, {}, '').message).toMatch(/access token was refused or has expired/);
    expect(friendly(500, {}, who)).toMatchObject({ code: 'driveBusy', retryable: true });
  });

  it('stops retrying a lasting failure and throws the mapped sentence', async () => {
    const fetchImpl = vi.fn(async () => reply({ error: { code: 503 } }, 503));
    const drive = createDriveClient({ getToken: () => 't', fetchImpl, retries: 3, ...quiet });
    await expect(drive.folder('x')).rejects.toMatchObject({ code: 'driveBusy', httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('never sends a create twice when Drive may already have made it (5xx or no answer), but retries a rate limit', async () => {
    const doc = { parentId: 'folder-1', name: 'Report', mimeType: 'application/vnd.google-apps.document', media: Buffer.from('<p>Hi</p>'), mediaType: 'text/html; charset=UTF-8' };
    const busy = vi.fn(async () => reply({ error: { code: 503 } }, 503));
    await expect(createDriveClient({ getToken: () => 't', fetchImpl: busy, ...quiet }).createFile(doc)).rejects.toMatchObject({ code: 'driveBusy', retryable: true });
    expect(busy).toHaveBeenCalledTimes(1);
    const dropped = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(createDriveClient({ getToken: () => 't', fetchImpl: dropped, ...quiet }).createFolder('folder-1', 'Run')).rejects.toMatchObject({ code: 'driveNetwork', retryable: true });
    expect(dropped).toHaveBeenCalledTimes(1);
    const answers = [reply({ error: { code: 429 } }, 429), reply({ id: 'doc-1' })];
    const limited = vi.fn(async () => answers.shift());
    expect(await createDriveClient({ getToken: () => 't', fetchImpl: limited, ...quiet }).createFile(doc)).toEqual({ id: 'doc-1' });
    expect(limited).toHaveBeenCalledTimes(2);
  });

  it('uploads HTML as a Google Doc and updates the same file in place', async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (url, options) => { seen.push({ url, method: options.method, type: options.headers['Content-Type'], body: Buffer.from(options.body).toString('utf8') }); return reply({ id: 'doc-1', mimeType: 'application/vnd.google-apps.document' }); });
    const drive = createDriveClient({ getToken: () => 't', fetchImpl, ...quiet });
    await drive.createFile({ parentId: 'folder-1', name: 'Trend — Trends report', mimeType: 'application/vnd.google-apps.document', media: Buffer.from('<html><body><p>Hi</p></body></html>'), mediaType: 'text/html; charset=UTF-8', appProperties: { studioAsset: 'asset-1' } });
    await drive.updateFile('doc-1', { name: 'Trend — Trends report', media: Buffer.from('<html><body><p>Edited</p></body></html>'), mediaType: 'text/html; charset=UTF-8' });
    expect(seen[0]).toMatchObject({ method: 'POST', type: expect.stringMatching(/^multipart\/related; boundary=/) });
    expect(seen[0].url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id%2Cname%2CmimeType%2Cparents%2CdriveId%2Ctrashed%2CwebViewLink%2CappProperties');
    expect(seen[0].body).toContain('"parents":["folder-1"]'); expect(seen[0].body).toContain('"studioAsset":"asset-1"'); expect(seen[0].body).toContain('<p>Hi</p>');
    expect(seen[1]).toMatchObject({ method: 'PATCH' }); expect(seen[1].url).toContain('/upload/drive/v3/files/doc-1?uploadType=multipart&supportsAllDrives=true');
    expect(seen[1].body).toContain('<p>Edited</p>');
    expect(drive.fileUrl({ id: 'doc-1', mimeType: 'application/vnd.google-apps.document' })).toBe('https://docs.google.com/document/d/doc-1/edit');
    await expect(drive.createFile({ parentId: 'f', name: 'big', mimeType: 'image/png', media: Buffer.alloc(5 * 1024 * 1024 + 1), mediaType: 'image/png' })).rejects.toMatchObject({ code: 'driveTooLarge' });
  });

  it('escapes names in Drive queries', async () => {
    let query = '';
    const drive = createDriveClient({ getToken: () => 't', fetchImpl: async (url) => { query = new URL(url).searchParams.get('q'); return reply({ files: [] }); }, ...quiet });
    await drive.findByName('parent-1', "It's a \\ test", { driveId: 'shared-1' });
    expect(query).toBe("'parent-1' in parents and name = 'It\\'s a \\\\ test' and trashed = false and mimeType = 'application/vnd.google-apps.folder'");
  });
});

describe('folder links', () => {
  it('reads every link shape Drive gives out, and refuses other sites', () => {
    expect(parseFolderLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseFolderLink('https://drive.google.com/drive/u/1/folders/0AbCdEfGhIjKlMnOpUk9PVA?usp=sharing')).toBe('0AbCdEfGhIjKlMnOpUk9PVA');
    expect(parseFolderLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseFolderLink('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseFolderLink('https://example.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe('');
    expect(parseFolderLink('http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe('');
    expect(parseFolderLink('not a link')).toBe('');
  });
});
