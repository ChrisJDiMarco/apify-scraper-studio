import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import helpImagesModule from '../src/main/help-images.js';

const { createHelpImages, IMAGE_ALLOWANCE_USD } = helpImagesModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
function setup({ configured = true, generateImage } = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'help-images-')), 'images'); roots.push(path.dirname(dir));
  const calls = [];
  const generator = generateImage || vi.fn(async (request) => {
    calls.push(request); await request.onRequest({ status: 'dispatched' });
    const image = { variantIndex: 0, png: PNG, receipt: { status: 'succeeded', costUsd: 0.0472, returnedModel: 'gpt-image-2.5-flare' } };
    await request.onVariant(image); return [image];
  });
  return { dir, calls, images: createHelpImages({ generateImage: generator, dir, isConfigured: () => configured, now: () => new Date('2026-10-08T18:00:00Z') }) };
}

describe('Ask AI pictures', () => {
  it('draws one picture with a one-dollar allowance and saves it with its receipt', async () => {
    const { dir, calls, images } = setup();
    const made = await images.create({ prompt: '  A lavender comet trail over a search results page  ', size: '1536x1024', title: 'AI Overviews hero' });
    expect(calls[0]).toMatchObject({ maxBudgetUsd: IMAGE_ALLOWANCE_USD, runId: made.id, deliverable: { kind: 'image', variants: 1, size: '1536x1024', label: 'AI Overviews hero', variantPrompts: ['A lavender comet trail over a search results page'] } });
    expect(made).toMatchObject({ id: expect.stringMatching(/^help-image-[a-f0-9-]{36}$/), title: 'AI Overviews hero', size: '1536x1024', costUsd: 0.0472, model: 'gpt-image-2.5-flare' });
    expect(made.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(fs.readFileSync(path.join(dir, `${made.id}.png`))).toEqual(PNG);
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${made.id}.json`), 'utf8'))).toMatchObject({ prompt: 'A lavender comet trail over a search results page', createdAt: '2026-10-08T18:00:00.000Z', receipt: { costUsd: 0.0472 } });
    expect(fs.existsSync(path.join(dir, `${made.id}.request.json`))).toBe(true);
    expect(images.pngPath(made.id)).toEqual({ path: path.join(dir, `${made.id}.png`), title: 'AI Overviews hero' });
  });

  it('refuses empty, oversized or oddly sized requests before anything is paid for', async () => {
    const { calls, images } = setup();
    await expect(images.create({ prompt: '   ' })).rejects.toThrow('Describe the picture first.');
    await expect(images.create({ prompt: 'x'.repeat(4001) })).rejects.toThrow('under 4,000 characters');
    await expect(images.create({ prompt: 'A chart', size: '800x600' })).rejects.toThrow('landscape, square or portrait');
    expect(calls).toEqual([]);
  });

  it('explains how to turn pictures on when no OpenAI key is saved', async () => {
    const { calls, images } = setup({ configured: false });
    await expect(images.create({ prompt: 'A chart' })).rejects.toThrow('Settings → Image generation');
    expect(calls).toEqual([]);
  });

  it('passes provider failures through and only serves pictures it saved', async () => {
    const failing = vi.fn(async () => { throw Object.assign(new Error('OpenAI denied image access. Check the key, model permission, and organization verification.'), { code: 'IMAGE_PROVIDER_REJECTED' }); });
    const { images } = setup({ generateImage: failing });
    await expect(images.create({ prompt: 'A chart' })).rejects.toThrow('OpenAI denied image access');
    expect(() => images.pngPath('../../etc/passwd')).toThrow('no longer available');
    expect(() => images.pngPath('help-image-00000000-0000-0000-0000-000000000000')).toThrow('no longer available');
  });
});
