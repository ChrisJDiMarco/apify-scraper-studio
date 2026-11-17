import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import helpImagesModule from '../src/main/help-images.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it('applies channel example bytes and description even when Ask AI requests no workspace brand family', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-help-image-')); roots.push(dir);
  const bytes = Buffer.from('fixture raster bytes');
  const generateImage = vi.fn(async () => [{ png: Buffer.from('fixture generated image'), receipt: { costUsd: .01 } }]);
  const api = helpImagesModule.createHelpImages({ dir, generateImage, workspaceId: () => 'adobe', channelReferences: () => ({ images: [{ id: 'example', name: 'Example', role: 'style', mime: 'image/png', data: bytes }], prompt: 'Keep the headline bold.' }) });
  await api.create({ prompt: 'Create a post image.', family: 'none', ownerId: 'member-riley' });
  const request = generateImage.mock.calls[0][0];
  expect(request.deliverable.references).toEqual([{ role: 'style', mime: 'image/png', data: bytes }]);
  expect(request.deliverable.variantPrompts[0]).toContain('Keep the headline bold.');
});

it.each(['', 'member-riley'])('isolates saved Ask AI pictures by workspace as well as owner (%s)', async (ownerId) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-help-image-')); roots.push(dir);
  let workspace = 'adobe';
  const api = helpImagesModule.createHelpImages({ dir, workspaceId: () => workspace, generateImage: async (request) => {
    const image = { png: Buffer.from('fixture generated image'), receipt: { costUsd: .01 } };
    await request.onVariant(image); workspace = 'semrush'; return [image];
  } });
  const picture = await api.create({ prompt: 'A private Adobe picture.', ownerId });
  expect(api.list({ ownerId })).toEqual([]);
  expect(() => api.read(picture.id, { ownerId })).toThrow(/no longer available/);
  workspace = 'adobe';
  expect(api.list({ ownerId }).map(image => image.id)).toEqual([picture.id]);
  expect(api.read(picture.id, { ownerId }).dataUrl).toContain('data:image/png');
});
