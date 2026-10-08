// Google Docs delivery through the Apps Script Sheets bridge, so publishing needs no pasted access token.
// publishCampaign has the same contract as google-delivery's: the same arguments, receipt shape and checkpoints.
// Every file gets a requestId derived from the campaign, the asset and the format, and the bridge remembers each
// requestId, so a retry or a resumed publish returns the file it already made instead of creating a copy.
const { createHash } = require('node:crypto');
const { safeGoogleDocHtml, MAX_UPLOAD_BYTES } = require('./google-delivery');

const DOC_MIME = 'application/vnd.google-apps.document';
const FILE_ID = /^[a-zA-Z0-9_-]{10,200}$/;
const FOLDER_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const folderLink = id => `https://drive.google.com/drive/folders/${id}`;
function fail(field, message, code = 'GOOGLE_DELIVERY_INVALID') { const error = new Error(message); error.field = field; error.code = code; throw error; }
function text(value, field, max = 240) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(field, `${field} must contain 1–${max} characters.`); return value.trim(); }
const optional = (value, field, max) => (value == null || value === '' ? '' : text(value, field, max));

// Doc names follow the n8n workflow: Priority_Trends_<Theme>_<yyyy-MM-dd_HH-mm> for trend reports and
// <Theme>__<yyyy-MM-dd_HH-mm> for editorial toolkits, stamped in this computer's time zone when the publish
// started (so a retry keeps the name). Other assets keep their title; an asset's docName always wins.
const NAMES = { 'evidence-report': (theme, when) => `Priority_Trends_${theme}_${when}`, 'editorial-toolkit': (theme, when) => `${theme}__${when}` };
const pad = value => String(value).padStart(2, '0');
function nameStamp(iso) { const date = new Date(iso); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`; }
function docName(asset, startedAt) {
  if (asset.docName) return asset.docName;
  const named = NAMES[asset.deliverableId];
  return named ? named((asset.theme || asset.title).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180), nameStamp(startedAt)) : asset.title;
}

function prepareAssets(assets) {
  if (!Array.isArray(assets) || !assets.length || assets.length > 200) fail('assets', 'Choose between 1 and 200 finished assets.');
  const seen = new Set();
  return assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') fail('assets', 'Each delivery asset must be an object.');
    const id = text(asset.id, `assets.${index}.id`, 180); if (seen.has(id)) fail('assets', 'Asset IDs must be unique.'); seen.add(id);
    const prepared = { id, title: text(asset.title, `assets.${index}.title`), channel: text(asset.channel, `assets.${index}.channel`, 100), kind: asset.kind,
      deliverableId: optional(asset.deliverableId, `assets.${index}.deliverableId`, 120), docName: optional(asset.docName, `assets.${index}.docName`, 240), theme: optional(asset.theme, `assets.${index}.theme`, 240) };
    if (asset.kind === 'text') { prepared.html = safeGoogleDocHtml(asset.html); prepared.fingerprint = hash(prepared.html); }
    else if (asset.kind === 'image') {
      // The PNG is the deliverable; the app's SVG is only a wrapper around the same pixels, so it is not uploaded.
      if (!Buffer.isBuffer(asset.png) || asset.png.length < 8 || asset.png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`assets.${index}.png`, 'Image delivery requires an existing PNG asset.');
      if (asset.png.length > MAX_UPLOAD_BYTES) fail(`assets.${index}`, 'Each delivered file must be 5 MB or smaller. Use local export for larger files.');
      prepared.png = asset.png; prepared.fingerprint = hash(asset.png);
    } else fail(`assets.${index}.kind`, 'Deliver finished text reports or image assets.');
    return prepared;
  });
}

function bridgeError(error) {
  const wrapped = new Error(String(error?.message || 'The Sheets bridge could not create the file.').slice(0, 500));
  wrapped.field = 'googleDelivery'; wrapped.code = 'GOOGLE_BRIDGE_ERROR'; wrapped.retryable = Boolean(error?.retryable);
  return wrapped;
}
function fileId(value) { if (typeof value !== 'string' || !FILE_ID.test(value)) fail('googleDelivery', 'The Sheets bridge returned an invalid file receipt. Redeploy scripts/google-sheets-webhook.gs and retry; the request ID prevents a second copy.', 'GOOGLE_RECEIPT_INVALID'); return value; }

// getFolders() → { default, byDeliverable: { 'evidence-report': folderId, 'editorial-toolkit': folderId } }
function createBridgeDelivery({ callBridge, getFolders = () => ({}), clock = () => new Date() } = {}) {
  if (typeof callBridge !== 'function' || typeof getFolders !== 'function') fail('googleConnection', 'Bridge delivery needs the Sheets bridge and its folder settings.');
  const activeCampaigns = new Set();
  const now = () => new Date(clock()).toISOString();
  function destinations() {
    let value; try { value = getFolders() || {}; } catch (_) { fail('folders', 'The Google Drive folder settings could not be read.'); }
    const check = (id, label) => { const clean = String(id || '').trim(); if (clean && !FOLDER_ID.test(clean)) fail('folders', `The ${label} in Settings → Google Sheets is not a Drive folder ID.`); return clean; };
    const byDeliverable = {}; for (const [key, id] of Object.entries(value.byDeliverable || {})) byDeliverable[key] = check(id, `${key} folder`);
    return { default: check(value.default, 'default Docs folder'), byDeliverable };
  }
  const operationKey = (campaignId, assetId, format) => hash(`bridge\n${campaignId}\nasset-${assetId}-${format}`);

  async function publishCampaign({ campaignId, title, assets, previousReceipt, onProgress } = {}) {
    campaignId = text(campaignId, 'campaignId', 180); title = text(title, 'title');
    if (typeof onProgress !== 'function') fail('onProgress', 'A durable receipt checkpoint callback is required before publishing.');
    const prepared = prepareAssets(assets); const folders = destinations();
    if (activeCampaigns.has(campaignId)) fail('campaignId', 'This campaign is already being delivered. Wait for the active publish operation.', 'GOOGLE_DELIVERY_BUSY');
    let receipt;
    if (previousReceipt != null) {
      if (!previousReceipt || previousReceipt.version !== 1 || previousReceipt.campaignId !== campaignId || !Array.isArray(previousReceipt.operations) || !Array.isArray(previousReceipt.assets) || !Array.isArray(previousReceipt.channelFolders)) fail('previousReceipt', 'This delivery receipt does not belong to the campaign.');
      receipt = clone(previousReceipt);
    } else receipt = { version: 1, campaignId, title, startedAt: now(), status: 'publishing', campaignFolder: null, folderUrl: '', channelFolders: [], assets: [], operations: [] };
    // Marks files made through the bridge, so the token adapter never re-creates them on a later retry.
    receipt.via = 'bridge'; receipt.startedAt ||= now(); receipt.status = 'publishing'; delete receipt.error; delete receipt.completedAt;
    if (!receipt.folderUrl && folders.default) receipt.folderUrl = folderLink(folders.default);
    activeCampaigns.add(campaignId);
    async function checkpoint(phase, operationId) {
      receipt.updatedAt = now();
      try { await onProgress({ phase, ...(operationId ? { operationId } : {}), receipt: clone(receipt) }); }
      catch (_) { fail('deliveryCheckpoint', 'The delivery receipt could not be saved. Publishing stopped to avoid duplicate files.', 'GOOGLE_CHECKPOINT_FAILED'); }
    }
    function part(asset) {
      const folderId = folders.byDeliverable[asset.deliverableId] || folders.default || '';
      const where = folderId ? { folderId } : {};
      if (asset.kind === 'text') {
        const name = docName(asset, receipt.startedAt);
        return { format: 'google-doc', request: { action: 'createDoc', title: name, html: asset.html, ...where },
          file: response => { const id = fileId(response?.documentId); return { id, name: String(response.name || name), mimeType: DOC_MIME, url: `https://docs.google.com/document/d/${id}/edit`, folderId: FOLDER_ID.test(response.folderId || '') ? response.folderId : folderId }; } };
      }
      const name = `${asset.docName || asset.title}.png`;
      return { format: 'png', request: { action: 'createFile', name, mimeType: 'image/png', base64: asset.png.toString('base64'), ...where },
        file: response => { const id = fileId(response?.fileId); return { id, name: String(response.name || name), mimeType: 'image/png', url: `https://drive.google.com/file/d/${id}/view`, folderId: FOLDER_ID.test(response.folderId || '') ? response.folderId : folderId }; } };
    }
    async function deliver(asset, spec) {
      const operationId = operationKey(campaignId, asset.id, spec.format);
      const requestId = `studio-${spec.format === 'google-doc' ? 'doc' : 'file'}-${operationId.slice(0, 40)}`;
      let operation = receipt.operations.find(entry => entry.operationId === operationId);
      if (operation?.status === 'succeeded' && operation.file) return operation.file;
      if (!operation) { operation = { operationId, logicalKey: `asset-${asset.id}-${spec.format}`, requestId, fingerprint: asset.fingerprint }; receipt.operations.push(operation); }
      Object.assign(operation, { requestId, status: 'pending', startedAt: now() }); delete operation.error;
      await checkpoint('before-write', operationId);
      try {
        let response; try { response = await callBridge({ ...spec.request, requestId }); } catch (error) { throw bridgeError(error); }
        operation.file = spec.file(response);
        Object.assign(operation, { status: 'succeeded', completedAt: now(), ...(response.duplicate ? { replayed: true } : {}) });
      } catch (error) { operation.status = 'failed'; operation.error = error.message; throw error; }
      await checkpoint('saved', operationId);
      return operation.file;
    }
    let current = null;
    try {
      for (const asset of prepared) {
        const spec = part(asset);
        const known = receipt.operations.find(entry => entry.operationId === operationKey(campaignId, asset.id, spec.format));
        if (known && known.fingerprint !== asset.fingerprint) fail('assets', 'A previously delivered asset changed. Publish it as a new campaign version instead of replacing the original.', 'GOOGLE_CONTENT_CHANGED');
        let record = receipt.assets.find(entry => entry.assetId === asset.id);
        if (record?.status === 'succeeded' && record.files?.length) continue; // finished by an earlier publish
        if (!record) { record = { assetId: asset.id, title: asset.title, channel: asset.channel, ...(asset.deliverableId ? { deliverableId: asset.deliverableId } : {}), status: 'publishing', files: [] }; receipt.assets.push(record); }
        current = record; record.status = 'publishing'; delete record.error;
        const delivered = await deliver(asset, spec);
        const existing = record.files.find(entry => entry.format === spec.format); const next = { format: spec.format, ...delivered };
        if (existing) Object.assign(existing, next); else record.files.push(next);
        if (!receipt.folderUrl && delivered.folderId) receipt.folderUrl = folderLink(delivered.folderId);
        await checkpoint('asset-file-ready');
        record.status = 'succeeded'; current = null; await checkpoint('asset-ready');
      }
      receipt.status = 'succeeded'; receipt.completedAt = now(); await checkpoint('complete'); return clone(receipt);
    } catch (error) {
      // Replaying a requestId is safe, so every failure can simply be retried: the bridge returns what it made.
      if (current) { current.status = 'failed'; current.error = error.message; }
      receipt.status = 'failed'; receipt.error = { code: error.code || 'GOOGLE_DELIVERY_FAILED', message: error.message };
      if (error.code !== 'GOOGLE_CHECKPOINT_FAILED') { try { await checkpoint('error'); } catch (_) { /* The caller still receives the last in-memory receipt. */ } }
      error.receipt = clone(receipt); throw error;
    } finally { activeCampaigns.delete(campaignId); }
  }
  return { publishCampaign };
}

module.exports = { createBridgeDelivery, docName };
