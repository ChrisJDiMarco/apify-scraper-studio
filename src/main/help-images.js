'use strict';
// Pictures made in the Ask AI drawer: one image per request through the media router (Settings → Model routing,
// task pictures.ask-ai), with the brand reference images of the family Ask AI chose (campaign, sel-editorial,
// sel-social, or none for a diagram). Each is saved under the data folder (PNG plus a JSON receipt) so it can be
// downloaded later. The set is read and checked when the request starts; that read is the picture's copy of it.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { referencePromptLines, referenceOwner, referenceSummary, ASK_IMAGE_FAMILIES } = require('../shared/brand-images');

const HELP_IMAGE_SIZES = ['1536x1024', '1024x1024', '1024x1536']; // landscape (default), square, portrait
const IMAGE_ALLOWANCE_USD = 1; // dispatch allowance for one picture; the provider requires at least $0.25
const MAX_PROMPT_CHARS = 4000;
const ID = /^help-image-[a-f0-9-]{36}$/;
const NO_SET = Object.freeze({ family: 'none', label: '', images: [] });

// references(family) → { family, label, images: [{ id, name, role, mime, sha256, data }] } for the active workspace;
// edition() → its edition id; workspaceId() → its id. problem() (optional) → why pictures can't be made now ('' when they can).
function createHelpImages({ generateImage, dir, isConfigured = () => true, problem = null, references = () => NO_SET, edition = () => 'general', workspaceId = () => '', now = () => new Date() }) {
  const file = (id, extension) => path.join(dir, `${id}.${extension}`);
  async function create({ prompt, size = HELP_IMAGE_SIZES[0], title = '', family = 'none' } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the picture first.');
    if (text.length > MAX_PROMPT_CHARS) throw new Error('Keep the picture description under 4,000 characters.');
    if (!HELP_IMAGE_SIZES.includes(size)) throw new Error('Choose a landscape, square or portrait picture.');
    const missing = typeof problem === 'function' ? problem() : isConfigured() ? '' : 'Connect a picture model in Settings → AI connections to create pictures.';
    if (missing) throw new Error(missing);
    const chosen = ASK_IMAGE_FAMILIES.includes(family) ? family : 'none';
    // The set is read (and each file's checksum verified) before anything is paid for.
    const set = chosen === 'none' ? NO_SET : references(chosen) || NO_SET;
    const images = Array.isArray(set.images) ? set.images : [];
    const lines = referencePromptLines(images, { owner: referenceOwner(set.family, edition()), sel: String(set.family).startsWith('sel-'), dataRule: true });
    const full = lines.length ? `${text}\n${lines.join('\n')}` : text;
    const id = `help-image-${randomUUID()}`; const label = String(title || '').trim().slice(0, 120) || 'Ask AI picture';
    fs.mkdirSync(dir, { recursive: true });
    const [image] = await generateImage({
      taskId: 'pictures.ask-ai',
      deliverable: { id: 'ask-ai-image', kind: 'image', label, variants: 1, size, variantPrompts: [full], references: images.map(({ role, mime, data }) => ({ role, mime, data })) },
      runId: id, maxBudgetUsd: IMAGE_ALLOWANCE_USD,
      // Checkpoints before and after the paid request, as Create content keeps them.
      onRequest: (receipt) => fs.writeFileSync(file(id, 'request.json'), JSON.stringify(receipt)),
      onVariant: (variant) => fs.writeFileSync(file(id, 'png'), variant.png),
    });
    const receipt = image?.receipt || {};
    const summary = { label: set.label || '', ...referenceSummary(images) };
    fs.writeFileSync(file(id, 'json'), JSON.stringify({ id, title: label, prompt: text, size, family: set.family || 'none', referenceSet: set.label || '', references: images.map(({ id: imageId, name, role, sha256 }) => ({ id: imageId, name, role, sha256 })), workspaceId: workspaceId(), createdAt: now().toISOString(), receipt }, null, 2));
    return {
      id, title: label, size, prompt: text, family: set.family || 'none', references: summary,
      dataUrl: `data:image/png;base64,${Buffer.from(image.png).toString('base64')}`,
      costUsd: Number.isFinite(receipt.costUsd) ? receipt.costUsd : null,
      model: receipt.returnedModel || receipt.model || '',
    };
  }
  const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8')); } catch { return {}; } };
  const summaryOf = (meta) => ({ label: meta.referenceSet || '', ...referenceSummary(Array.isArray(meta.references) ? meta.references : []) });
  // The saved PNG for a picture made here, for "Download".
  function pngPath(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('That picture is no longer available.');
    const target = file(id, 'png'); if (!fs.existsSync(target)) throw new Error('That picture is no longer available.');
    return { path: target, title: metaOf(id).title || 'Ask AI picture' };
  }
  // Every saved picture, newest first, for Simple mode's Assets tab (metadata only; read() loads one image).
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((name) => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json') && !name.endsWith('.request.json'))
      .map((name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; } })
      .filter((meta) => meta && fs.existsSync(file(meta.id, 'png')))
      .map((meta) => ({ id: meta.id, title: meta.title || 'Ask AI picture', prompt: meta.prompt || '', size: meta.size || HELP_IMAGE_SIZES[0], createdAt: meta.createdAt || '', costUsd: Number.isFinite(meta.receipt?.costUsd) ? meta.receipt.costUsd : null, family: meta.family || 'none', references: summaryOf(meta) }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function read(id) {
    const { path: target } = pngPath(id); const meta = metaOf(id);
    return { id, dataUrl: `data:image/png;base64,${fs.readFileSync(target).toString('base64')}`, family: meta.family || 'none', references: summaryOf(meta) };
  }
  return { create, pngPath, list, read };
}

module.exports = { createHelpImages, HELP_IMAGE_SIZES, IMAGE_ALLOWANCE_USD };
