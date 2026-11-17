import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const examplePng = () => { const bytes = Buffer.alloc(32); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(32, 16); bytes.writeUInt32BE(32, 20); return bytes; };
const outputPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');

it('snapshots channel examples and descriptions into image generation, retaining them after the example is removed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-reference-generation-')); roots.push(root);
  const generateImage = vi.fn(async () => [{ png: outputPng, receipt: { provider: 'fixture', costUsd: .01 } }]);
  const api = workspaceModule.createContentWorkspace({ root, runAI: vi.fn(), generateImage });
  const added = api.addChannelReference({ channelId: 'social', name: 'example.png', data: examplePng(), description: 'Use the bold headline and generous white space.' });
  api.addChannelReference({ channelId: 'blog', name: 'other-channel.png', data: examplePng(), description: 'Do not use this other channel example.' });
  const run = api.createContentRun({ source: { kind: 'text', title: 'Fixture', text: 'A source for the channel.' }, deliverableIds: ['brand-image'], imageVariants: 1, maxBudgetUsd: 1 });
  api.removeChannelReference({ channelId: 'social', imageId: added.reference.id });
  await api.waitForIdle();
  const request = generateImage.mock.calls[0][0];
  expect(request.deliverable.references).toHaveLength(1);
  expect(Buffer.from(request.deliverable.references[0].data)).toEqual(examplePng());
  expect(request.deliverable.variantPrompts[0]).toContain('Use the bold headline and generous white space.');
  expect(request.deliverable.variantPrompts[0]).not.toContain('Do not use this other channel example.');
  expect(api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
  expect(api.channelImageReferenceSet({ channelId: 'social' }).images).toEqual([]);
});

it('persists examples in the right workspace and exposes reference guidance for Ask AI images', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-reference-workspace-')); roots.push(root);
  const options = { root, runAI: vi.fn(), workspacePolicy: { mode: 'multi' } };
  let api = workspaceModule.createContentWorkspace(options);
  const added = api.addChannelReference({ channelId: 'social', name: 'example.png', data: examplePng(), description: 'Keep the product screenshot readable.' });
  api = workspaceModule.createContentWorkspace(options);
  const settings = await api.readChannelSettings({ channelId: 'social' });
  expect(settings.references[0].id).toBe(added.reference.id);
  const set = api.channelImageReferenceSet({ channelId: 'social' });
  expect(set.images).toHaveLength(1);
  expect(set.prompt).toContain('Keep the product screenshot readable.');
  expect(set.images[0].data).toEqual(examplePng());
  api.selectContentWorkspace('semrush');
  expect(api.channelImageReferenceSet({ channelId: 'social' }).images).toEqual([]);
  expect(() => api.readChannelReference({ channelId: 'social', imageId: added.reference.id })).toThrow(/not.*channel/i);
});
