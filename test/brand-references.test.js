import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { picture } from './helpers/pictures.js';
const { createContentWorkspace } = require('../src/main/content-workspace.js');
const { createHelpImages } = require('../src/main/help-images.js');
const { createImageProvider } = require('../src/main/image-provider.js');

// Guard: every picture the studio makes sends its set's brand reference images (Settings → Brand reference images).
// A new picture path must send its set's references and be added here. Channel asset pictures, Create content pictures,
// Ask AI pictures (with the family Ask AI chose) and picture test runs in Prompts are each run with a set of two style
// examples and an approved logo, and with an empty set.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const source = { id: 'original-brief', kind: 'upload', title: 'Fixture source', text: 'AI answers now cite brands; teams want to measure it.', evidence: [{ id: 'record-1', text: 'Teams can’t prove AI citation ROI yet.', url: 'https://example.com/fixture' }] };
const BRIEF = { headline: 'AI citations now decide which brands get seen', subtitle: 'What the data shows', callouts: [], visualIdea: 'A search result fading into an AI answer card.', symbols: ['answer card'], avoid: [] };
const LINE = 'REFERENCE IMAGES, attached in this order';

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-references-')); roots.push(root);
  const generateImage = vi.fn(async ({ deliverable }) => deliverable.variantPrompts.map((_, index) => ({ variantIndex: index, title: `${deliverable.label} · ${index + 1}`, png: Buffer.from(PNG), receipt: { provider: 'fixture', costUsd: 0.02 } })));
  const runAI = vi.fn(async () => ({ output: BRIEF, receipt: { provider: 'fixture', costUsd: 0.01 } }));
  const api = createContentWorkspace({ root, runAI, generateImage, capabilities: () => ({ imagesConfigured: true }), clock: () => new Date('2026-10-17T12:00:00.000Z') });
  // Two style examples and an approved logo in a set, as Settings saves them; returns their bytes in sending order.
  const fill = (workspaceId, family) => {
    const files = [picture(400, 300, 11), picture(400, 300, 22)]; const logo = picture(331, 60, 33);
    api.addBrandImage({ workspaceId, family, role: 'logo', name: 'logo.png', data: logo });
    for (const [index, data] of files.entries()) api.addBrandImage({ workspaceId, family, role: 'style', name: `style-${index}.png`, data });
    return [...files, logo];
  };
  return { root, api, generateImage, runAI, fill };
}
const sent = (h) => h.generateImage.mock.calls.map(([request]) => request.deliverable);
function expectSet(deliverable, files) {
  expect(Array.isArray(deliverable.references)).toBe(true);
  expect(deliverable.references.map((ref) => ref.role)).toEqual(['style', 'style', 'logo']);
  expect(deliverable.references.map((ref) => sha(Buffer.from(ref.data)))).toEqual(files.map(sha));
  for (const prompt of deliverable.variantPrompts) expect(prompt).toContain(LINE);
}
function expectNone(deliverable) {
  expect(deliverable.references).toEqual([]);
  for (const prompt of deliverable.variantPrompts) expect(prompt).not.toContain(LINE);
}

describe('brand reference images on every picture path', () => {
  it('has no picture path the guard doesn’t know', () => {
    // Providers excluded; every caller below is exercised in this file.
    const expected = { 'src/main/content-workspace.js': 2, 'src/main/help-images.js': 1, 'src/main/prompt-lab.js': 1 };
    const found = {};
    for (const name of fs.readdirSync('src/main').filter((file) => file.endsWith('.js') && !['image-provider.js', 'media-router.js', 'fal-provider.js'].includes(file))) {
      const count = (fs.readFileSync(path.join('src/main', name), 'utf8').match(/\bgenerateImages?\(\s*\{/g) || []).length;
      if (count) found[`src/main/${name}`] = count;
    }
    expect(found, 'A new picture path calls generateImage: send its set’s references and add it to this test.').toEqual(expected);
  });

  it('sends the campaign set with channel asset pictures, and none from an empty set', async () => {
    const h = harness(); h.api.selectContentWorkspace('semrush');
    const files = h.fill('semrush', 'campaign');
    const run = h.api.createAssetKit({ source: { kind: 'text', title: 'AI citations', text: source.text }, deliverableIds: ['brand-image', 'sel-image'] }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
    expectSet(sent(h).find((deliverable) => deliverable.id === 'brand-image'), files);
    expectNone(sent(h).find((deliverable) => deliverable.id === 'sel-image'));
  });

  it('sends the matching set with Create content pictures (campaign and Search Engine Land editorial)', async () => {
    const h = harness(); h.api.selectContentWorkspace('semrush');
    const campaign = h.fill('semrush', 'campaign'); const editorial = h.fill('semrush', 'sel-editorial');
    h.api.createContentRun({ source, deliverableIds: ['brand-image'], maxBudgetUsd: 3 }); await h.api.waitForIdle();
    h.api.createContentRun({ source, deliverableIds: ['sel-image'], maxBudgetUsd: 3 }); await h.api.waitForIdle();
    h.api.createContentRun({ source, deliverableIds: ['sel-social-image'], maxBudgetUsd: 3 }); await h.api.waitForIdle();
    expectSet(sent(h).find((deliverable) => deliverable.id === 'brand-image'), campaign);
    expectSet(sent(h).find((deliverable) => deliverable.id === 'sel-image'), editorial);
    expectNone(sent(h).find((deliverable) => deliverable.id === 'sel-social-image'));
    // Each run keeps the copy it started with: a picture set changed afterwards doesn't change a retry.
    const kept = JSON.parse(fs.readFileSync(path.join(h.root, 'runs', h.api.publicState().contentRuns.find((row) => row.jobs[0].id === 'sel-image').id, 'brand-references.json'), 'utf8'));
    expect(kept.sets['sel-image'].map((ref) => ref.sha256)).toEqual(editorial.map(sha));
  });

  it('sends the family Ask AI chose with its pictures, and none for “none”', async () => {
    const h = harness(); h.api.selectContentWorkspace('semrush');
    const files = h.fill('semrush', 'campaign');
    const dir = path.join(h.root, 'help-images');
    const images = createHelpImages({ generateImage: h.generateImage, dir, references: (family) => h.api.brandReferenceSet({ family }), edition: () => 'semrush', workspaceId: () => 'semrush' });
    const made = await images.create({ prompt: 'A campaign hero about AI citations', family: 'campaign' });
    expectSet(sent(h)[0], files);
    expect(made.references).toEqual({ label: expect.any(String), style: 2, logo: 1 });
    await images.create({ prompt: 'A flow diagram of a quick scan', family: 'none' });
    expectNone(sent(h)[1]);
    await images.create({ prompt: 'An editorial hero', family: 'sel-editorial' }); // a family whose set is empty
    expectNone(sent(h)[2]);
  });

  it('sends the campaign set with picture test runs in Prompts, as runs do', async () => {
    const h = harness(); const files = h.fill('general', 'campaign');
    for (const id of ['pictures.content-image', 'pictures.kit-image']) {
      const estimate = await h.api.estimatePromptTest({ id, sample: 'bundled' });
      expect(estimate.references).toMatchObject({ family: 'campaign', style: 2, logo: 1 }); expect(estimate.note).toContain('sends the 3 reference images');
      const result = await h.api.testPrompt({ id, sample: 'bundled', fingerprint: estimate.fingerprint });
      expect(result.ok).toBe(true);
      expectSet(sent(h).at(-1), files);
    }
    // A set changed since the estimate fails the check instead of drawing with other pictures.
    const estimate = await h.api.estimatePromptTest({ id: 'pictures.content-image', sample: 'bundled' });
    h.api.addBrandImage({ workspaceId: 'general', family: 'campaign', role: 'style', name: 'new.png', data: picture(400, 300, 44) });
    await expect(h.api.testPrompt({ id: 'pictures.content-image', sample: 'bundled', fingerprint: estimate.fingerprint })).rejects.toThrow('The prompt changed; check the cost again.');
    const empty = harness();
    const plain = await empty.api.estimatePromptTest({ id: 'pictures.content-image', sample: 'bundled' });
    expect(plain.note).toContain('No reference images in');
    await empty.api.testPrompt({ id: 'pictures.content-image', sample: 'bundled', fingerprint: plain.fingerprint });
    expectNone(sent(empty).at(-1));
  });

  it('refuses a picture request that doesn’t say which reference images it sends', async () => {
    const provider = createImageProvider({ getApiKey: () => 'fixture-only', fetchImpl: vi.fn() });
    await expect(provider.generateImage({ deliverable: { id: 'brand-image', kind: 'image', label: 'Hero', variants: 1, size: '1536x1024', variantPrompts: ['p'] }, runId: 'r', maxBudgetUsd: 1, onRequest: async () => {} })).rejects.toMatchObject({ code: 'IMAGE_INPUT_INVALID', message: expect.stringContaining('Every picture request lists the brand reference images it sends') });
  });
});
