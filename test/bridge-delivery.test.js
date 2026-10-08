import { describe, expect, it } from 'vitest';
import bridge from '../src/main/bridge-delivery.js';
import delivery from '../src/main/google-delivery.js';
const { createBridgeDelivery, docName } = bridge;
const { safeGoogleDocHtml } = delivery;

const DOC = 'application/vnd.google-apps.document';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture pixels')]);
const html = (title = 'Fixture report', body = 'Source context &amp; detail.') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body { color: red; }</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const copy = value => JSON.parse(JSON.stringify(value));
const STARTED = new Date(2026, 9, 7, 9, 5); // local time: names use this computer's time zone, like n8n's $now
const trend = { id: 'report-1', title: 'Generative Visibility: evidence report', channel: 'Research', kind: 'text', deliverableId: 'evidence-report', theme: 'Generative Visibility', html: html('Evidence report') };
const toolkit = { id: 'toolkit-1', title: 'Editorial toolkit', channel: 'Research', kind: 'text', deliverableId: 'editorial-toolkit', theme: 'Generative Visibility', html: html('Editorial toolkit') };
const blog = { id: 'blog-1', title: 'Short blog post', channel: 'Blog', kind: 'text', deliverableId: 'blogshort', html: html('Short blog post') };

// A fake Apps Script bridge: remembers each requestId's result like the real script, and can fail on demand.
function fakeBridge({ fail } = {}) {
  const results = new Map(); const calls = []; const created = []; let sequence = 0;
  async function callBridge(request) {
    calls.push(copy(request));
    const mode = fail?.(request, calls.length);
    if (mode === 'before') { const error = new Error('Exception: Service invoked too many times'); error.retryable = true; throw error; }
    if (results.has(request.requestId)) return { ...results.get(request.requestId), duplicate: true };
    const id = `fixture_${String(++sequence).padStart(6, '0')}`;
    const result = request.action === 'createDoc'
      ? { ok: true, action: 'createDoc', requestId: request.requestId, documentId: id, url: `https://docs.google.com/document/d/${id}/edit`, name: request.title, folderId: request.folderId || '' }
      : { ok: true, action: 'createFile', requestId: request.requestId, fileId: id, url: `https://drive.google.com/file/d/${id}/view`, name: request.name, folderId: request.folderId || '' };
    results.set(request.requestId, result); created.push({ id, request: copy(request) });
    if (mode === 'lost') throw new Error('fetch failed'); // created, but the response never arrived
    return result;
  }
  return { callBridge, calls, created, results };
}
function setup({ folders = { default: '', byDeliverable: {} }, fail } = {}) {
  const fixture = fakeBridge({ fail });
  return { ...fixture, adapter: createBridgeDelivery({ callBridge: fixture.callBridge, getFolders: () => folders, clock: () => STARTED }) };
}
function campaign(options = {}) { return { campaignId: 'fixture-campaign', title: 'Fixture campaign', assets: [trend], onProgress: async () => {}, ...options }; }
async function failure(promise) { try { await promise; throw new Error('Expected the publish to fail'); } catch (error) { return error; } }

describe('Google Docs delivery through the Sheets bridge', () => {
  it('creates native Docs with n8n names in the folder chosen for each deliverable', async () => {
    const checkpoints = [];
    const fixture = setup({ folders: { default: 'folder_default', byDeliverable: { 'evidence-report': 'folder_trends', 'editorial-toolkit': '' } } });
    const seenAtCall = [];
    const callBridge = fixture.callBridge;
    const adapter = createBridgeDelivery({ callBridge: async request => { seenAtCall.push(copy(checkpoints.at(-1))); return callBridge(request); }, getFolders: () => ({ default: 'folder_default', byDeliverable: { 'evidence-report': 'folder_trends', 'editorial-toolkit': '' } }), clock: () => STARTED });
    const receipt = await adapter.publishCampaign(campaign({ assets: [trend, toolkit, blog], onProgress: async event => { checkpoints.push(copy(event)); } }));

    expect(fixture.calls.map(call => [call.action, call.title, call.folderId])).toEqual([
      ['createDoc', 'Priority_Trends_Generative Visibility_2026-10-07_09-05', 'folder_trends'],
      ['createDoc', 'Generative Visibility__2026-10-07_09-05', 'folder_default'],
      ['createDoc', 'Short blog post', 'folder_default'],
    ]);
    // A durable checkpoint with the operation pending is saved before every write.
    for (const [index, checkpoint] of seenAtCall.entries()) {
      expect(checkpoint.phase).toBe('before-write');
      expect(checkpoint.receipt.operations[index].status).toBe('pending');
    }
    expect(receipt).toMatchObject({ version: 1, via: 'bridge', campaignId: 'fixture-campaign', title: 'Fixture campaign', status: 'succeeded', campaignFolder: null, channelFolders: [], folderUrl: 'https://drive.google.com/drive/folders/folder_default' });
    expect(receipt.assets.map(asset => [asset.assetId, asset.status, asset.deliverableId])).toEqual([['report-1', 'succeeded', 'evidence-report'], ['toolkit-1', 'succeeded', 'editorial-toolkit'], ['blog-1', 'succeeded', 'blogshort']]);
    for (const asset of receipt.assets) {
      expect(asset.files).toHaveLength(1);
      expect(asset.files[0]).toMatchObject({ format: 'google-doc', mimeType: DOC });
      expect(asset.files[0].url).toMatch(/^https:\/\/docs\.google\.com\/document\/d\/fixture_\d+\/edit$/);
    }
    expect(receipt.assets[0].files[0]).toMatchObject({ name: 'Priority_Trends_Generative Visibility_2026-10-07_09-05', folderId: 'folder_trends' });
    expect(receipt.operations.every(operation => operation.status === 'succeeded' && /^studio-doc-[a-f0-9]{40}$/.test(operation.requestId))).toBe(true);
    expect(checkpoints.at(-1).phase).toBe('complete');
  });

  it('uploads the same sanitized HTML the Drive adapter would and uses My Drive when no folder is set', async () => {
    const fixture = setup();
    const receipt = await fixture.adapter.publishCampaign(campaign());
    expect(fixture.calls[0].html).toBe(safeGoogleDocHtml(trend.html));
    expect(fixture.calls[0].html).not.toContain('<style>');
    expect(fixture.calls[0]).not.toHaveProperty('folderId');
    expect(receipt.folderUrl).toBe('');
    await expect(setup().adapter.publishCampaign(campaign({ assets: [{ ...blog, html: '<script>alert(1)</script>' }] }))).rejects.toMatchObject({ code: 'GOOGLE_DELIVERY_INVALID' });
  });

  it('honours a docName and keeps a stable name across retries', () => {
    expect(docName({ ...trend, docName: 'Custom name' }, STARTED.toISOString())).toBe('Custom name');
    expect(docName({ ...trend, theme: '' }, STARTED.toISOString())).toBe('Priority_Trends_Generative Visibility: evidence report_2026-10-07_09-05');
    expect(docName(blog, STARTED.toISOString())).toBe('Short blog post');
  });

  it('replays the same requestId after a lost response instead of creating a second Doc', async () => {
    let lost = false;
    const fixture = setup({ fail: () => { if (!lost) { lost = true; return 'lost'; } return null; } });
    const error = await failure(fixture.adapter.publishCampaign(campaign()));
    expect(error.code).toBe('GOOGLE_BRIDGE_ERROR');
    expect(error.receipt).toMatchObject({ status: 'failed', error: { code: 'GOOGLE_BRIDGE_ERROR' } });
    expect(error.receipt.operations[0].status).toBe('failed');
    expect(error.receipt.assets[0].status).toBe('failed');
    expect(fixture.created).toHaveLength(1);

    const receipt = await fixture.adapter.publishCampaign(campaign({ previousReceipt: error.receipt }));
    expect(receipt.status).toBe('succeeded'); expect(receipt.error).toBeUndefined();
    expect(fixture.calls.map(call => call.requestId)).toEqual([fixture.calls[0].requestId, fixture.calls[0].requestId]);
    expect(fixture.created).toHaveLength(1); // the bridge returned the Doc it already made
    expect(receipt.operations[0]).toMatchObject({ status: 'succeeded', replayed: true });
    expect(receipt.assets[0].files[0].id).toBe(fixture.created[0].id);
  });

  it('resumes a failed publish without touching assets that already finished', async () => {
    let failedOnce = false;
    const fixture = setup({ fail: request => { if (request.title === 'Short blog post' && !failedOnce) { failedOnce = true; return 'before'; } return null; } });
    const error = await failure(fixture.adapter.publishCampaign(campaign({ assets: [trend, blog, toolkit] })));
    expect(error.receipt.status).toBe('failed');
    expect(error.receipt.assets.map(asset => [asset.assetId, asset.status])).toEqual([['report-1', 'succeeded'], ['blog-1', 'failed']]);
    expect(error.retryable).toBe(true);
    const before = fixture.calls.length;

    const receipt = await fixture.adapter.publishCampaign(campaign({ assets: [trend, blog, toolkit], previousReceipt: error.receipt }));
    expect(fixture.calls.slice(before).map(call => call.title)).toEqual(['Short blog post', 'Generative Visibility__2026-10-07_09-05']);
    expect(receipt.assets.map(asset => asset.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(receipt.assets[0]).toEqual(error.receipt.assets[0]);
    expect(fixture.created).toHaveLength(3);

    // Publishing a finished campaign again sends nothing.
    const again = await fixture.adapter.publishCampaign(campaign({ assets: [trend, blog, toolkit], previousReceipt: receipt }));
    expect(fixture.calls.length).toBe(before + 2);
    expect(again.assets).toEqual(receipt.assets);
  });

  it('derives requestIds from the campaign, asset and format', async () => {
    const first = setup(); const second = setup(); const other = setup();
    await first.adapter.publishCampaign(campaign());
    await second.adapter.publishCampaign(campaign());
    await other.adapter.publishCampaign(campaign({ campaignId: 'another-campaign' }));
    expect(first.calls[0].requestId).toBe(second.calls[0].requestId);
    expect(other.calls[0].requestId).not.toBe(first.calls[0].requestId);
  });

  it('refuses changed content for a delivered asset, and stops before writing when a checkpoint cannot be saved', async () => {
    const fixture = setup(); const receipt = await fixture.adapter.publishCampaign(campaign()); const count = fixture.calls.length;
    await expect(fixture.adapter.publishCampaign(campaign({ previousReceipt: receipt, assets: [{ ...trend, html: html('Evidence report', 'Changed.') }] }))).rejects.toMatchObject({ code: 'GOOGLE_CONTENT_CHANGED' });
    expect(fixture.calls).toHaveLength(count);

    const fresh = setup();
    await expect(fresh.adapter.publishCampaign(campaign({ onProgress: undefined }))).rejects.toMatchObject({ field: 'onProgress' });
    const error = await failure(fresh.adapter.publishCampaign(campaign({ onProgress: async () => { throw new Error('disk full'); } })));
    expect(error.code).toBe('GOOGLE_CHECKPOINT_FAILED'); expect(error.message).not.toContain('disk full');
    expect(error.receipt.operations[0].status).toBe('pending');
    expect(fresh.calls).toHaveLength(0);
    await expect(fresh.adapter.publishCampaign(campaign({ previousReceipt: { version: 1, campaignId: 'someone-else', operations: [], assets: [], channelFolders: [] } }))).rejects.toMatchObject({ field: 'previousReceipt' });
  });

  it('uploads image PNGs with createFile and links them as Drive files', async () => {
    const fixture = setup({ folders: { default: 'folder_default', byDeliverable: {} } });
    const receipt = await fixture.adapter.publishCampaign(campaign({ assets: [{ id: 'image-1', title: 'Editorial visual', channel: 'Social', kind: 'image', png: PNG, svg: '<svg/>' }] }));
    expect(fixture.calls).toEqual([expect.objectContaining({ action: 'createFile', name: 'Editorial visual.png', mimeType: 'image/png', base64: PNG.toString('base64'), folderId: 'folder_default' })]);
    expect(receipt.assets[0].files).toEqual([expect.objectContaining({ format: 'png', mimeType: 'image/png', url: `https://drive.google.com/file/d/${fixture.created[0].id}/view` })]);
    expect(receipt.operations[0].requestId).toMatch(/^studio-file-[a-f0-9]{40}$/);
    await expect(fixture.adapter.publishCampaign(campaign({ assets: [{ id: 'image-2', title: 'Bad', channel: 'Social', kind: 'image', png: Buffer.from('not a png') }] }))).rejects.toMatchObject({ field: 'assets.0.png' });
  });

  it('marks the receipt failed when the bridge returns no file, and refuses a second concurrent publish', async () => {
    const broken = createBridgeDelivery({ callBridge: async () => ({ ok: true }), clock: () => STARTED });
    const error = await failure(broken.publishCampaign(campaign()));
    expect(error.code).toBe('GOOGLE_RECEIPT_INVALID');
    expect(error.receipt).toMatchObject({ status: 'failed', error: { code: 'GOOGLE_RECEIPT_INVALID' } });

    let release; const gate = new Promise(resolve => { release = resolve; });
    const slow = fakeBridge();
    const adapter = createBridgeDelivery({ callBridge: async request => { await gate; return slow.callBridge(request); }, clock: () => STARTED });
    const running = adapter.publishCampaign(campaign());
    await expect(adapter.publishCampaign(campaign())).rejects.toMatchObject({ code: 'GOOGLE_DELIVERY_BUSY' });
    release(); await expect(running).resolves.toMatchObject({ status: 'succeeded' });
    await expect(createBridgeDelivery({ callBridge: async () => ({}), getFolders: () => ({ default: 'not a folder!' }) }).publishCampaign(campaign())).rejects.toMatchObject({ field: 'folders' });
  });

  it('finishes a campaign that started with the Drive token without re-creating its delivered files', async () => {
    const tokenReceipt = { version: 1, campaignId: 'fixture-campaign', title: 'Fixture campaign', startedAt: STARTED.toISOString(), status: 'failed', campaignFolder: { id: 'campaign_folder_1', url: 'https://drive.google.com/drive/folders/campaign_folder_1' }, folderUrl: 'https://drive.google.com/drive/folders/campaign_folder_1', channelFolders: [{ channel: 'Research', id: 'channel_folder_1' }],
      assets: [{ assetId: 'report-1', title: trend.title, channel: 'Research', status: 'succeeded', files: [{ format: 'google-doc', id: 'token_doc_000001', mimeType: DOC, url: 'https://docs.google.com/document/d/token_doc_000001/edit' }] }], operations: [{ operationId: 'abc', status: 'succeeded' }] };
    const fixture = setup();
    const receipt = await fixture.adapter.publishCampaign(campaign({ assets: [trend, toolkit], previousReceipt: tokenReceipt }));
    expect(fixture.calls.map(call => call.title)).toEqual(['Generative Visibility__2026-10-07_09-05']);
    expect(receipt).toMatchObject({ via: 'bridge', status: 'succeeded', folderUrl: tokenReceipt.folderUrl });
    expect(receipt.assets[0].files[0].url).toBe('https://docs.google.com/document/d/token_doc_000001/edit');
  });
});
