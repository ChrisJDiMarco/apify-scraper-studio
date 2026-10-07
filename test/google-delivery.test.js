import { describe, expect, it } from 'vitest';
import delivery from '../src/main/google-delivery.js';
import content from '../src/shared/content-studio.js';
const { createGoogleDelivery, safeGoogleDocHtml, MAX_UPLOAD_BYTES } = delivery;
const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture pixels')]);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><title>Embedded raster image — pixels are not editable vectors</title><image width="1536" height="1024" href="data:image/png;base64,${PNG.toString('base64')}"/></svg>`;
const html = content.renderContentExport({ title: 'Fixture report', summary: 'A source-grounded summary.', sections: [{ id: 'evidence', heading: 'Evidence', body: 'Source context & detail.', items: [], evidenceIds: [], productIds: [] }], caveats: ['Human review before distribution.'] }, { format: 'html' });
const reports = () => [{ id: 'report-1', title: 'Evidence report', channel: 'Research', kind: 'text', html }];
const images = () => [{ id: 'image-1', title: 'Editorial visual', channel: 'Social', kind: 'image', png: PNG, svg }];
const copy = value => JSON.parse(JSON.stringify(value));
const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
function decodePost(options) {
  if (!Buffer.isBuffer(options.body)) return { metadata: JSON.parse(options.body), media: null };
  const boundary = options.headers['Content-Type'].split('boundary=')[1];
  const parts = options.body.toString('latin1').split(`--${boundary}`);
  return { metadata: JSON.parse(Buffer.from(parts[1].split('\r\n\r\n')[1].slice(0, -2), 'latin1').toString('utf8')), media: Buffer.from(parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2), 'latin1'), mediaType: parts[2].split('\r\n')[1] };
}
function driveFixture({ beforePost, afterPost, listOverride } = {}) {
  const files = new Map(); const posts = []; const requests = []; let sequence = 0;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); requests.push({ url, options });
    expect(parsed.origin).toBe('https://www.googleapis.com'); expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe('Bearer fixture-token');
    if (options.method === 'POST') {
      const payload = decodePost(options); if (beforePost) { const override = await beforePost(payload, posts.length); if (override) return override; }
      const file = { id: `fixture_${++sequence}`, ...payload.metadata, trashed: false };
      files.set(file.id, file); posts.push({ file, ...payload, url });
      if (afterPost) { const override = await afterPost(payload, file, posts.length); if (override) return override; }
      return reply(file);
    }
    const fileMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([a-zA-Z0-9_-]+)$/);
    if (fileMatch) return files.has(fileMatch[1]) ? reply(files.get(fileMatch[1])) : new Response('', { status: 404 });
    expect(parsed.pathname).toBe('/drive/v3/files');
    const operationId = parsed.searchParams.get('q')?.match(/value='([a-f0-9]+)'/)?.[1];
    const found = [...files.values()].filter(file => !file.trashed && file.appProperties.studioOperation === operationId);
    return reply(listOverride ? listOverride(found) : { files: found });
  };
  return { files, posts, requests, fetchImpl, adapter: createGoogleDelivery({ getAccessToken: () => 'fixture-token', fetchImpl }) };
}
function campaign(options = {}) { return { campaignId: 'fixture-campaign', title: 'Fixture campaign', assets: reports(), onProgress: async () => {}, ...options }; }
async function failure(promise) { try { await promise; throw new Error('Expected fixture operation to fail'); } catch (error) { return error; } }

describe('explicit checkpointed Google Drive delivery', () => {
  it('delivers semantic native Docs and PNG/SVG under campaign and channel folders', async () => {
    const checkpoints = []; const fixture = driveFixture({ beforePost: ({ metadata }) => {
      const checkpoint = checkpoints.at(-1); expect(checkpoint.phase).toBe('before-write');
      expect(checkpoint.receipt.operations.find(operation => operation.operationId === metadata.appProperties.studioOperation).status).toBe('pending');
    } });
    const receipt = await fixture.adapter.publishCampaign(campaign({ assets: [...reports(), ...images()], onProgress: async event => { checkpoints.push(copy(event)); } }));
    expect(fixture.posts).toHaveLength(6); expect(receipt.status).toBe('succeeded'); expect(receipt.assets).toHaveLength(2); expect(receipt.channelFolders).toHaveLength(2);
    expect(fixture.posts[0].metadata.mimeType).toBe(FOLDER); expect(fixture.posts[0].metadata.parents).toBeUndefined();
    expect(receipt.folderUrl).toBe(`https://drive.google.com/drive/folders/${receipt.campaignFolder.id}`);
    const doc = fixture.posts.find(post => post.metadata.mimeType === DOC);
    expect(doc.url).toContain('uploadType=multipart'); expect(doc.mediaType).toBe('Content-Type: text/html; charset=UTF-8');
    expect(doc.media.toString()).toContain('Source context &amp; detail.'); expect(doc.media.toString()).not.toContain('<style>');
    expect(doc.metadata.parents).toEqual([receipt.channelFolders.find(folder => folder.channel === 'Research').id]);
    expect(receipt.assets[0].files[0].url).toMatch(/^https:\/\/docs.google.com\/document\/d\/fixture_\d+\/edit$/);
    expect(fixture.posts.find(post => post.metadata.mimeType === 'image/png').media.equals(PNG)).toBe(true);
    expect(fixture.posts.find(post => post.metadata.mimeType === 'image/svg+xml').media.toString()).toBe(svg);
    expect(checkpoints.at(-1).phase).toBe('complete'); expect(JSON.stringify(receipt)).not.toContain('fixture-token');
  });
  it('requires durable checkpointing, stops before a write when saving fails, and creates nothing', async () => {
    const fixture = driveFixture();
    await expect(fixture.adapter.publishCampaign(campaign({ onProgress: undefined }))).rejects.toMatchObject({ field: 'onProgress' });
    expect(fixture.requests).toHaveLength(0);
    const error = await failure(fixture.adapter.publishCampaign(campaign({ onProgress: async () => { throw new Error('private storage detail'); } })));
    expect(error.code).toBe('GOOGLE_CHECKPOINT_FAILED'); expect(error.receipt.operations[0].status).toBe('pending'); expect(fixture.posts).toHaveLength(0); expect(error.message).not.toContain('private storage');
  });
  it('reuses successful receipt files without additional writes and rejects changed asset content', async () => {
    const fixture = driveFixture(); const receipt = await fixture.adapter.publishCampaign(campaign()); const count = fixture.posts.length;
    const repeated = await fixture.adapter.publishCampaign(campaign({ previousReceipt: receipt })); expect(repeated.assets).toEqual(receipt.assets); expect(fixture.posts).toHaveLength(count);
    await expect(fixture.adapter.publishCampaign(campaign({ previousReceipt: repeated, assets: [{ ...reports()[0], html: html.replace('A source-grounded summary.', 'Changed summary.') }] }))).rejects.toMatchObject({ code: 'GOOGLE_CONTENT_CHANGED' });
    expect(fixture.posts).toHaveLength(count);
  });
  it('recovers an interrupted successful upload using its operation property instead of duplicating it', async () => {
    let failed = false; const fixture = driveFixture({ afterPost: (_payload, _file, count) => { if (count === 3 && !failed) { failed = true; throw new Error('provider socket/private detail'); } } });
    const error = await failure(fixture.adapter.publishCampaign(campaign())); expect(error.code).toBe('GOOGLE_NETWORK_ERROR'); expect(error.receipt.status).toBe('needs-reconciliation'); expect(fixture.posts).toHaveLength(3);
    const receipt = await fixture.adapter.publishCampaign(campaign({ previousReceipt: error.receipt })); expect(receipt.status).toBe('succeeded'); expect(receipt.error).toBeUndefined(); expect(fixture.posts).toHaveLength(3); expect(receipt.operations.at(-1).recovered).toBe(true);
  });
  it('does not recreate an ambiguous write that is not visible yet', async () => {
    const fixture = driveFixture({ beforePost: () => { throw new Error('connection reset'); } });
    const first = await failure(fixture.adapter.publishCampaign(campaign())); expect(first.receipt.operations[0].status).toBe('unknown'); const requests = fixture.requests.length;
    const retry = await failure(fixture.adapter.publishCampaign(campaign({ previousReceipt: first.receipt }))); expect(retry.code).toBe('GOOGLE_RECONCILIATION_REQUIRED'); expect(fixture.posts).toHaveLength(0);
    expect(fixture.requests.slice(requests).every(request => request.options.method === 'GET')).toBe(true);
  });
  it('can retry a definitive rejected write after access is restored without persisting provider details', async () => {
    let reject = true; const fixture = driveFixture({ beforePost: () => { if (reject) { reject = false; return new Response('private-provider-body fixture-token', { status: 403 }); } } });
    const denied = await failure(fixture.adapter.publishCampaign(campaign())); expect(denied.receipt.operations[0].status).toBe('rejected'); expect(JSON.stringify(denied.receipt)).not.toContain('fixture-token'); expect(denied.message).toContain('denied access');
    const receipt = await fixture.adapter.publishCampaign(campaign({ previousReceipt: denied.receipt })); expect(receipt.status).toBe('succeeded'); expect(fixture.posts).toHaveLength(3);
  });
  it('preserves a completed write when its post-write checkpoint fails', async () => {
    const fixture = driveFixture(); let saved;
    const error = await failure(fixture.adapter.publishCampaign(campaign({ onProgress: async event => { if (event.phase === 'before-write') saved = copy(event.receipt); if (event.phase === 'saved') throw new Error('disk full'); } })));
    expect(error.code).toBe('GOOGLE_CHECKPOINT_FAILED'); expect(fixture.posts).toHaveLength(1);
    const receipt = await fixture.adapter.publishCampaign(campaign({ previousReceipt: saved })); expect(receipt.status).toBe('succeeded'); expect(fixture.posts).toHaveLength(3);
  });
  it('stops when a saved file moved, was trashed, or had its operation metadata changed', async () => {
    for (const change of [file => { file.parents = ['elsewhere']; }, file => { file.trashed = true; }, file => { file.appProperties.studioFingerprint = 'changed'; }]) {
      const fixture = driveFixture(); const receipt = await fixture.adapter.publishCampaign(campaign()); const count = fixture.posts.length;
      change(fixture.files.get(receipt.assets[0].files[0].id));
      await expect(fixture.adapter.publishCampaign(campaign({ previousReceipt: receipt }))).rejects.toMatchObject({ code: 'GOOGLE_RECONCILIATION_REQUIRED' }); expect(fixture.posts).toHaveLength(count);
    }
  });
  it('rejects duplicate search matches rather than picking an arbitrary file', async () => {
    const fixture = driveFixture({ listOverride: found => ({ files: found.length ? [found[0], found[0]] : [] }) });
    await fixture.adapter.publishCampaign(campaign()); const count = fixture.posts.length;
    await expect(fixture.adapter.publishCampaign(campaign())).rejects.toMatchObject({ code: 'GOOGLE_RECONCILIATION_REQUIRED' }); expect(fixture.posts).toHaveLength(count);
  });
  it('prevalidates every asset, including unsafe HTML/SVG and oversized media, before any remote calls', async () => {
    for (const bad of [
      { ...reports()[0], html: '<html><body><script>alert(1)</script></body></html>' },
      { ...reports()[0], html: '<html><body><p onclick="alert(1)">text</p></body></html>' },
      { ...reports()[0], html: '<html><body><a href="https://example.com/?token=private">link</a></body></html>' },
      { ...images()[0], svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/image.png"/></svg>' },
      { ...images()[0], svg: '<svg xmlns="http://www.w3.org/2000/svg" style="filter:url(https://example.com/filter)"></svg>' },
      { ...images()[0], png: Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]) },
      { ...images()[0], png: Buffer.from('not a PNG') },
    ]) {
      const fixture = driveFixture(); await expect(fixture.adapter.publishCampaign(campaign({ assets: [{ ...reports()[0], id: 'valid-first' }, bad] }))).rejects.toThrow(); expect(fixture.requests).toHaveLength(0);
    }
  });
  it('strips layout styles while retaining escaped content and safe source links', () => {
    const input = '<!doctype html><html><head><style>body { color: red; }</style><title>Hidden metadata</title></head><body><section class="card"><h1>Evidence &amp; context</h1><p>&lt;script&gt; stays text<br>Next line <a href="https://example.com/source?a=1&amp;b=2">Source</a></p></section></body></html>';
    const output = safeGoogleDocHtml(input); expect(output).toContain('<div><h1>Evidence &amp; context</h1>'); expect(output).toContain('&lt;script&gt; stays text<br>'); expect(output).toContain('href="https://example.com/source?a=1&amp;b=2"'); expect(output).not.toMatch(/class=|color: red|Hidden metadata/);
    expect(() => safeGoogleDocHtml('<!DOCTYPE html [<!ENTITY remote SYSTEM "https://example.com">]><html><body><p>&remote;</p></body></html>')).toThrow(); expect(() => safeGoogleDocHtml('<html><body><p>broken</body></html>')).toThrow();
  });
  it('bounds response bodies and sanitizes token provider failures', async () => {
    for (const response of [new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } }), new Response('x'.repeat(1024 * 1024 + 1))]) {
      const adapter = createGoogleDelivery({ getAccessToken: () => 'fixture', fetchImpl: async () => response }); await expect(adapter.publishCampaign(campaign())).rejects.toThrow('oversized receipt');
    }
    const adapter = createGoogleDelivery({ getAccessToken: () => { throw new Error('sensitive-token-detail'); }, fetchImpl: async () => { throw new Error('must not call'); } });
    const error = await failure(adapter.publishCampaign(campaign())); expect(error.code).toBe('GOOGLE_AUTH_REQUIRED'); expect(JSON.stringify(error.receipt)).not.toContain('sensitive-token-detail');
  });
  it('serializes the same campaign within an adapter while leaving future retry possible', async () => {
    let release; let entered; const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; }); let first = true;
    const fixture = driveFixture({ beforePost: async () => { if (first) { first = false; entered(); await gate; } } });
    const running = fixture.adapter.publishCampaign(campaign()); await started;
    await expect(fixture.adapter.publishCampaign(campaign())).rejects.toMatchObject({ code: 'GOOGLE_DELIVERY_BUSY' }); release(); const receipt = await running; expect(receipt.status).toBe('succeeded');
  });
});
