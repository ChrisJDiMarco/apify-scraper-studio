// Explicit, checkpointed Google Drive delivery. No calls occur until publishCampaign.
const { createHash, randomUUID } = require('node:crypto');
const { SaxesParser } = require('saxes');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const FILE_FIELDS = 'id,name,mimeType,parents,appProperties,webViewLink,trashed';
const stamp = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
function fail(field, message, code = 'GOOGLE_DELIVERY_INVALID') { const error = new Error(message); error.field = field; error.code = code; throw error; }
function text(value, field, max = 240) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(field, `${field} must contain 1–${max} characters.`); return value.trim(); }
function fileId(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) fail('previousReceipt', 'Google Drive returned an invalid file identity.'); return value; }
function escape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function safeLink(value) { let parsed; try { parsed = new URL(value); } catch (_) { fail('assets.html', 'A report contains an invalid source link.'); } if (parsed.protocol !== 'https:' || parsed.username || parsed.password || [...parsed.searchParams.keys()].some(key => /^(token|api[-_]?key|access[-_]?token|secret|password|signature)$/i.test(key))) fail('assets.html', 'Report links must use HTTPS without embedded credentials.'); return parsed.href; }
function safeGoogleDocHtml(html) {
  if (typeof html !== 'string' || !html.trim() || Buffer.byteLength(html) > MAX_UPLOAD_BYTES) fail('assets.html', 'Provide a rendered report HTML document no larger than 5 MB.');
  // The host passes renderContentExport HTML. Parse that controlled, XML-compatible
  // subset and rebuild semantic HTML for Docs conversion; never upload raw AI markup.
  const source = html.replace(/^\s*<!doctype html\s*>/i, '').replace(/<(meta|br|hr)(\s[^<>]*?)?\s*\/?\s*>/gi, (_, tag, attrs = '') => `<${tag}${attrs.replace(/\/$/, '')}/>`);
  const parser = new SaxesParser(); const stack = []; const output = []; let bodyDepth = 0; let ignored = 0; let nodes = 0; let bodySeen = false;
  const allowed = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'header', 'main', 'section', 'aside', 'article', 'div', 'span', 'small', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br', 'hr']);
  const containers = new Set(['header', 'main', 'section', 'aside', 'article']);
  parser.on('doctype', () => fail('assets.html', 'External declarations are not permitted in report HTML.'));
  parser.on('error', () => fail('assets.html', 'Use the app-rendered report HTML, not raw or malformed model HTML.'));
  parser.on('opentag', node => {
    const name = node.name.toLowerCase(); if (++nodes > 100000 || stack.length > 100 || !allowed.has(name)) fail('assets.html', 'The report contains unsupported or executable markup.');
    if (Object.keys(node.attributes).some(key => /^on/i.test(key))) fail('assets.html', 'Event handlers are not permitted in report HTML.');
    if (name === 'body') { bodySeen = true; bodyDepth++; }
    const skip = ['head', 'style', 'title'].includes(name); if (skip) ignored++;
    const mapped = containers.has(name) ? 'div' : name === 'small' ? 'span' : name;
    const emit = Boolean(bodyDepth) && !ignored && name !== 'body'; stack.push({ name, mapped, emit, skip });
    if (!emit) return;
    const attrs = name === 'a' && node.attributes.href ? ` href="${escape(safeLink(node.attributes.href))}"` : '';
    output.push(`<${mapped}${attrs}>`);
  });
  parser.on('text', value => { if (bodyDepth && !ignored) output.push(escape(value)); });
  parser.on('cdata', value => { if (bodyDepth && !ignored) output.push(escape(value)); });
  parser.on('closetag', () => { const node = stack.pop(); if (!node) return; if (node.emit && !['br', 'hr'].includes(node.name)) output.push(`</${node.mapped}>`); if (node.skip) ignored--; if (node.name === 'body') bodyDepth--; });
  parser.write(source).close();
  if (!bodySeen || !output.length) fail('assets.html', 'The rendered report has no document body.');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${output.join('')}</body></html>`;
}
function safeSvg(svg) {
  const value = Buffer.isBuffer(svg) ? svg.toString('utf8') : svg;
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_UPLOAD_BYTES) fail('assets.svg', 'Use an SVG export no larger than 5 MB.');
  const parser = new SaxesParser({ xmlns: true }); let root = false; let nodes = 0; let depth = 0;
  const attributes = new Set(['xmlns', 'width', 'height', 'viewBox', 'x', 'y', 'href', 'preserveAspectRatio']);
  parser.on('doctype', () => fail('assets.svg', 'SVG external declarations are not permitted.'));
  parser.on('error', () => fail('assets.svg', 'The SVG export is malformed.'));
  parser.on('opentag', node => { if (++nodes > 100000 || ++depth > 100 || node.uri !== 'http://www.w3.org/2000/svg' || !['svg', 'title', 'desc', 'g', 'image'].includes(node.local)) fail('assets.svg', 'Only the app-created raster SVG wrapper can be delivered.'); if (node.local === 'svg') root = true; for (const attr of Object.values(node.attributes)) { if (!attributes.has(attr.name) || (attr.uri && attr.uri !== 'http://www.w3.org/2000/xmlns/')) fail('assets.svg', 'The SVG export contains unsupported styling or external references.'); if (/^on/i.test(attr.local)) fail('assets.svg', 'SVG event handlers are not permitted.'); if (attr.local === 'href' && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(attr.value)) fail('assets.svg', 'SVG references must contain the embedded PNG, never external URLs.'); } });
  parser.on('closetag', () => { depth--; });
  parser.write(value).close(); if (!root) fail('assets.svg', 'The export is not an SVG.'); return Buffer.from(value);
}
function prepareAssets(assets) {
  if (!Array.isArray(assets) || !assets.length || assets.length > 200) fail('assets', 'Choose between 1 and 200 finished assets.');
  const seen = new Set();
  return assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') fail('assets', 'Each delivery asset must be an object.');
    const id = text(asset.id, `assets.${index}.id`, 180); if (seen.has(id)) fail('assets', 'Asset IDs must be unique.'); seen.add(id);
    const title = text(asset.title, `assets.${index}.title`); const channel = text(asset.channel, `assets.${index}.channel`, 100);
    const files = [];
    // n8n names (Priority_Trends_<Theme>_<date>, <Theme>__<date>) arrive as docName.
    const docName = typeof asset.docName === 'string' && asset.docName.trim() && asset.docName.length <= 240 ? asset.docName.trim() : title;
    if (asset.kind === 'text') files.push({ format: 'google-doc', name: docName, mimeType: DOC_MIME, uploadMimeType: 'text/html; charset=UTF-8', buffer: Buffer.from(safeGoogleDocHtml(asset.html)) });
    else if (asset.kind === 'image') {
      if (!Buffer.isBuffer(asset.png) || asset.png.length < 8 || asset.png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`assets.${index}.png`, 'Image delivery requires an existing PNG asset.');
      files.push({ format: 'png', name: `${title}.png`, mimeType: 'image/png', uploadMimeType: 'image/png', buffer: asset.png });
      if (asset.svg != null) files.push({ format: 'svg', name: `${title}.svg`, mimeType: 'image/svg+xml', uploadMimeType: 'image/svg+xml', buffer: safeSvg(asset.svg) });
    } else fail(`assets.${index}.kind`, 'Deliver finished text reports or image assets.');
    if (files.some(file => file.buffer.length > MAX_UPLOAD_BYTES)) fail(`assets.${index}`, 'Each delivered file must be 5 MB or smaller. Use local export for larger files.');
    return { id, title, channel, kind: asset.kind, files };
  });
}
function multipart(metadata, media, mimeType) {
  const boundary = `studio_${randomUUID().replaceAll('-', '')}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), media, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}
function createGoogleDelivery({ getAccessToken, fetchImpl = globalThis.fetch } = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') fail('googleConnection', 'Google delivery needs a token provider and an HTTP host.');
  const activeCampaigns = new Set();
  async function request(route, options = {}) {
    let token;
    try { token = await getAccessToken(); } catch (_) { fail('googleConnection', 'The Google Drive access token could not be loaded. Reconnect before publishing.', 'GOOGLE_AUTH_REQUIRED'); }
    if (typeof token !== 'string' || !token.trim() || token.length > 12000 || /[\r\n]/.test(token)) fail('googleConnection', 'Connect Google Drive with permission to create files before publishing.', 'GOOGLE_AUTH_REQUIRED');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetchImpl(`https://www.googleapis.com${route}`, { method: options.method || 'GET', headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json', ...(options.contentType ? { 'Content-Type': options.contentType } : {}) }, body: options.body, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        const error = new Error([401, 403].includes(response.status) ? 'Google Drive denied access. Reconnect with Drive file-creation permission; the access token may have expired.' : `Google Drive delivery failed with status ${response.status}.`);
        error.field = [401, 403].includes(response.status) ? 'googleConnection' : 'googleDelivery'; error.code = 'GOOGLE_HTTP_ERROR'; error.definitiveRejected = response.status >= 400 && response.status < 500 && response.status !== 408; error.httpStatus = response.status; throw error;
      }
      if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) fail('googleDelivery', 'Google Drive returned an oversized receipt.', 'GOOGLE_RECEIPT_INVALID');
      if (!response.body || typeof response.body.getReader !== 'function') fail('googleDelivery', 'Google Drive returned an unreadable receipt.', 'GOOGLE_RECEIPT_INVALID');
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('googleDelivery', 'Google Drive returned an oversized receipt.', 'GOOGLE_RECEIPT_INVALID'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { fail('googleDelivery', 'Google Drive returned an invalid receipt. Retry will reconcile the operation before any new write.', 'GOOGLE_RECEIPT_INVALID'); }
    } catch (error) { if (error.field) throw error; fail('googleDelivery', controller.signal.aborted ? 'Google Drive delivery timed out. Its outcome will be reconciled before retry.' : 'Google Drive could not be reached. Its outcome will be reconciled before retry.', 'GOOGLE_NETWORK_ERROR'); }
    finally { clearTimeout(timer); }
  }
  async function publishCampaign({ campaignId, title, assets, previousReceipt, onProgress } = {}) {
    campaignId = text(campaignId, 'campaignId', 180); title = text(title, 'title');
    if (typeof onProgress !== 'function') fail('onProgress', 'A durable receipt checkpoint callback is required before publishing.');
    const prepared = prepareAssets(assets);
    if (activeCampaigns.has(campaignId)) fail('campaignId', 'This campaign is already being delivered. Wait for the active publish operation.', 'GOOGLE_DELIVERY_BUSY');
    let receipt;
    if (previousReceipt != null) {
      if (!previousReceipt || previousReceipt.version !== 1 || previousReceipt.campaignId !== campaignId || !Array.isArray(previousReceipt.operations) || !Array.isArray(previousReceipt.assets) || !Array.isArray(previousReceipt.channelFolders)) fail('previousReceipt', 'This delivery receipt does not belong to the campaign.');
      receipt = clone(previousReceipt);
    } else receipt = { version: 1, campaignId, title, startedAt: stamp(), status: 'publishing', campaignFolder: null, folderUrl: '', channelFolders: [], assets: [], operations: [] };
    receipt.status = 'publishing'; delete receipt.error; delete receipt.completedAt; activeCampaigns.add(campaignId);
    async function checkpoint(phase, operationId) {
      receipt.updatedAt = stamp();
      try { await onProgress({ phase, ...(operationId ? { operationId } : {}), receipt: clone(receipt) }); }
      catch (_) { fail('deliveryCheckpoint', 'The delivery receipt could not be saved. Publishing stopped to avoid duplicate files.', 'GOOGLE_CHECKPOINT_FAILED'); }
    }
    function fileReceipt(file, expected) {
      const id = fileId(file?.id);
      if (file.trashed || file.mimeType !== expected.mimeType || file.appProperties?.studioOperation !== expected.operationId || file.appProperties?.studioFingerprint !== expected.fingerprint || file.appProperties?.studioCampaign !== hash(campaignId) || (expected.parentId && !file.parents?.includes(expected.parentId))) fail('previousReceipt', 'A Google file no longer matches this delivery checkpoint. Reconcile the changed or moved file before continuing.', 'GOOGLE_RECONCILIATION_REQUIRED');
      return { id, name: String(file.name || expected.name), mimeType: file.mimeType, url: file.mimeType === FOLDER_MIME ? `https://drive.google.com/drive/folders/${id}` : file.mimeType === DOC_MIME ? `https://docs.google.com/document/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view` };
    }
    async function ensure(logicalKey, spec) {
      const operationId = hash(`${campaignId}\n${logicalKey}`);
      const fingerprint = hash(Buffer.concat([Buffer.from(JSON.stringify({ name: spec.name, mimeType: spec.mimeType, parentId: spec.parentId || '' })), spec.buffer || Buffer.alloc(0)]));
      const expected = { ...spec, operationId, fingerprint };
      let operation = receipt.operations.find(entry => entry.operationId === operationId);
      if (operation && operation.fingerprint !== fingerprint) fail('assets', 'A previously delivered asset changed. Publish it as a new campaign version instead of replacing the original.', 'GOOGLE_CONTENT_CHANGED');
      if (operation?.file) {
        const known = await request(`/drive/v3/files/${fileId(operation.file.id)}?fields=${encodeURIComponent(FILE_FIELDS)}`);
        operation.file = fileReceipt(known, expected); operation.status = 'succeeded'; return operation.file;
      }
      const query = `trashed = false and appProperties has { key='studioOperation' and value='${operationId}' }`;
      const found = await request(`/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=100&fields=${encodeURIComponent(`nextPageToken,files(${FILE_FIELDS})`)}`);
      if (!Array.isArray(found.files) || found.files.length > 1 || found.nextPageToken) fail('previousReceipt', 'Multiple or invalid Google records match this operation. Reconcile them before continuing.', 'GOOGLE_RECONCILIATION_REQUIRED');
      if (found.files.length === 1) {
        const recovered = fileReceipt(found.files[0], expected);
        if (!operation) { operation = { operationId, logicalKey, fingerprint }; receipt.operations.push(operation); }
        Object.assign(operation, { status: 'succeeded', file: recovered, completedAt: stamp(), recovered: true }); await checkpoint('recovered', operationId); return recovered;
      }
      if (operation && ['pending', 'unknown'].includes(operation.status)) fail('previousReceipt', 'The previous write outcome is still unknown and no matching Google file is visible yet. Retry reconciliation later; no duplicate file was created.', 'GOOGLE_RECONCILIATION_REQUIRED');
      if (!operation) { operation = { operationId, logicalKey, fingerprint }; receipt.operations.push(operation); }
      Object.assign(operation, { status: 'pending', startedAt: stamp() }); await checkpoint('before-write', operationId);
      const metadata = { name: spec.name, mimeType: spec.mimeType, ...(spec.parentId ? { parents: [spec.parentId] } : {}), appProperties: { studioCampaign: hash(campaignId), studioOperation: operationId, studioFingerprint: fingerprint } };
      try {
        const upload = spec.buffer ? multipart(metadata, spec.buffer, spec.uploadMimeType) : { body: JSON.stringify(metadata), contentType: 'application/json; charset=UTF-8' };
        const route = spec.buffer ? `/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}` : `/drive/v3/files?fields=${encodeURIComponent(FILE_FIELDS)}`;
        const created = await request(route, { method: 'POST', ...upload });
        operation.file = fileReceipt(created, expected); operation.status = 'succeeded'; operation.completedAt = stamp(); await checkpoint('saved', operationId); return operation.file;
      } catch (error) {
        if (operation.status !== 'succeeded') operation.status = error.definitiveRejected ? 'rejected' : 'unknown';
        throw error;
      }
    }
    try {
      receipt.campaignFolder = await ensure('campaign-folder', { name: title, mimeType: FOLDER_MIME }); receipt.folderUrl = receipt.campaignFolder.url; await checkpoint('campaign-ready');
      for (const asset of prepared) {
        const channelKey = hash(asset.channel);
        let channel = receipt.channelFolders.find(entry => entry.channel === asset.channel);
        const folder = await ensure(`channel-${channelKey}`, { name: asset.channel, mimeType: FOLDER_MIME, parentId: receipt.campaignFolder.id });
        if (!channel) { channel = { channel: asset.channel, ...folder }; receipt.channelFolders.push(channel); } else Object.assign(channel, folder);
        let record = receipt.assets.find(entry => entry.assetId === asset.id);
        if (!record) { record = { assetId: asset.id, title: asset.title, channel: asset.channel, status: 'publishing', files: [] }; receipt.assets.push(record); }
        for (const part of asset.files) {
          const delivered = await ensure(`asset-${asset.id}-${part.format}`, { ...part, parentId: folder.id });
          const existing = record.files.find(entry => entry.format === part.format); const next = { format: part.format, ...delivered }; if (existing) Object.assign(existing, next); else record.files.push(next);
          await checkpoint('asset-file-ready');
        }
        record.status = 'succeeded'; await checkpoint('asset-ready');
      }
      receipt.status = 'succeeded'; receipt.completedAt = stamp(); await checkpoint('complete'); return clone(receipt);
    } catch (error) {
      receipt.status = error.code === 'GOOGLE_RECONCILIATION_REQUIRED' || receipt.operations.some(operation => ['unknown', 'pending'].includes(operation.status)) ? 'needs-reconciliation' : 'failed';
      receipt.error = { code: error.code || 'GOOGLE_DELIVERY_FAILED', message: error.message };
      if (error.code !== 'GOOGLE_CHECKPOINT_FAILED') { try { await checkpoint('error'); } catch (_) { /* The caller still receives the last in-memory receipt. */ } }
      error.receipt = clone(receipt); throw error;
    } finally { activeCampaigns.delete(campaignId); }
  }
  return { publishCampaign };
}
module.exports = { createGoogleDelivery, safeGoogleDocHtml, MAX_UPLOAD_BYTES };
