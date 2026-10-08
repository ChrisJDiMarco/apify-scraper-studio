'use strict';
// Pictures made in the Ask AI drawer: one image per request through the same OpenAI image provider Create
// content uses. Each is saved under the data folder (PNG plus a JSON receipt) so it can be downloaded later.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const HELP_IMAGE_SIZES = ['1536x1024', '1024x1024', '1024x1536']; // landscape (default), square, portrait
const IMAGE_ALLOWANCE_USD = 1; // dispatch allowance for one picture; the provider requires at least $0.25
const MAX_PROMPT_CHARS = 4000;
const ID = /^help-image-[a-f0-9-]{36}$/;

function createHelpImages({ generateImage, dir, isConfigured = () => true, now = () => new Date() }) {
  const file = (id, extension) => path.join(dir, `${id}.${extension}`);
  async function create({ prompt, size = HELP_IMAGE_SIZES[0], title = '' } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the picture first.');
    if (text.length > MAX_PROMPT_CHARS) throw new Error('Keep the picture description under 4,000 characters.');
    if (!HELP_IMAGE_SIZES.includes(size)) throw new Error('Choose a landscape, square or portrait picture.');
    if (!isConfigured()) throw new Error('Add an OpenAI API key in Settings → Image generation to create pictures.');
    const id = `help-image-${randomUUID()}`; const label = String(title || '').trim().slice(0, 120) || 'Ask AI picture';
    fs.mkdirSync(dir, { recursive: true });
    const [image] = await generateImage({
      deliverable: { id: 'ask-ai-image', kind: 'image', label, variants: 1, size, variantPrompts: [text] },
      runId: id, maxBudgetUsd: IMAGE_ALLOWANCE_USD,
      // Checkpoints before and after the paid request, as Create content keeps them.
      onRequest: (receipt) => fs.writeFileSync(file(id, 'request.json'), JSON.stringify(receipt)),
      onVariant: (variant) => fs.writeFileSync(file(id, 'png'), variant.png),
    });
    const receipt = image?.receipt || {};
    fs.writeFileSync(file(id, 'json'), JSON.stringify({ id, title: label, prompt: text, size, createdAt: now().toISOString(), receipt }, null, 2));
    return {
      id, title: label, size, prompt: text,
      dataUrl: `data:image/png;base64,${Buffer.from(image.png).toString('base64')}`,
      costUsd: Number.isFinite(receipt.costUsd) ? receipt.costUsd : null,
      model: receipt.returnedModel || receipt.model || '',
    };
  }
  // The saved PNG for a picture made here, for "Download".
  function pngPath(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('That picture is no longer available.');
    const target = file(id, 'png'); if (!fs.existsSync(target)) throw new Error('That picture is no longer available.');
    const meta = (() => { try { return JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8')); } catch { return {}; } })();
    return { path: target, title: meta.title || 'Ask AI picture' };
  }
  return { create, pngPath };
}

module.exports = { createHelpImages, HELP_IMAGE_SIZES, IMAGE_ALLOWANCE_USD };
