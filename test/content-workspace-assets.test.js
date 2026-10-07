import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import imageProvider from '../src/main/image-provider.js';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const source = { id: 'original-brief', kind: 'upload', title: 'Fixture source', text: 'Private fixture source evidence: the team needs clear provenance.', evidence: [{ id: 'record-1', text: 'The fixture interview asks for original-source citations.', url: 'https://example.com/fixture' }], aggregateMetrics: { cohort: { itemCount: 2 }, matchedShare: 1 } };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function outputFor(request) {
  const context = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
  const ids = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find(value => value.kind === 'text' && JSON.stringify(value.sections.map(section => section.id)) === JSON.stringify(ids));
  const cite = context.source.evidence.find(record => record.id === 'original-brief')?.id || context.source.evidence[0].id;
  return { title: 'Fixture draft for editorial review', summary: 'A fixture proposal based on the saved source.', sections: descriptor.sections.map(section => ({ id: section.id, heading: section.heading, body: 'The supplied source supports an editorial hypothesis.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Review original evidence', evidenceIds: [cite], productIds: [] })), evidenceIds: [cite], productIds: [] })), caveats: ['Fixture only. Product matches and independent verification are not available.'], ...(descriptor.id === 'evidence-report' ? { quotes: [] } : {}) };
}
function harness({ generateImage, capabilities, runAI, publishCampaign } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-assets-fixture-')); roots.push(root);
  const calls = [];
  const ai = vi.fn(async request => { calls.push(request); if (runAI) return runAI(request); return { output: outputFor(request), receipt: { provider: 'fixture', costUsd: 0.01, paidServicesInvoked: false } }; });
  const api = createContentWorkspace({ root, runAI: ai, generateImage, capabilities, publishCampaign });
  return { root, api, ai, calls };
}
async function completed(h, payload) { const run = h.api.createContentRun({ source, deliverableIds: ['brand-image'], maxBudgetUsd: 3, ...payload }); await h.api.waitForIdle(); return h.api.readStudioRun({ runId: run.id }); }
const images = (count = 3, cost = 0.02) => Array.from({ length: count }, (_, i) => ({ title: `Fixture variant ${i + 1}`, png: Buffer.from(png), receipt: { provider: 'fixture', costUsd: cost, paidServicesInvoked: false } }));

describe('studio assets, budgets and source continuity', () => {
  it('saves exactly all requested PNG variants and exports honest raster SVG wrappers', async () => {
    const generateImage = vi.fn(async () => images()); const h = harness({ generateImage }); const run = await completed(h);
    expect(run.status).toBe('succeeded'); expect(generateImage).toHaveBeenCalledOnce(); expect(h.ai).not.toHaveBeenCalled();
    expect(generateImage.mock.calls[0][0].deliverable.variantPrompts).toHaveLength(3);
    expect(run.costUsd).toBeCloseTo(0.06); expect(run.reservedUsd).toBeCloseTo(0.06);
    const assets = h.api.publicState().assets; expect(assets).toHaveLength(3);
    const output = h.api.readStudioAsset({ assetId: assets[0].id }); expect(output.imageDataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
    const exported = h.api.exportStudioRun({ runId: run.id }); expect(exported.assetCount).toBe(3);
    const filenames = fs.readdirSync(path.join(exported.path, 'Design')); expect(filenames.filter(name => name.endsWith('.svg'))).toHaveLength(3);
    const svg = fs.readFileSync(path.join(exported.path, 'Design', filenames.find(name => name.endsWith('.svg'))), 'utf8'); expect(svg).toContain('pixels are not editable vectors'); expect(svg).toContain('data:image/png;base64,');
  });
  it.each(['missing variant', 'invalid PNG'])('retains valid legacy images and blocks an ambiguous repeated charge when %s occurs', async failure => {
    const generateImage = vi.fn(async () => failure === 'missing variant' ? images(2) : [...images(2), { png: Buffer.from('not a png'), receipt: { costUsd: 0.02 } }]);
    const h = harness({ generateImage }); const run = await completed(h);
    expect(run.status).toBe('partial'); expect(run.jobs[0].status).toBe('partial'); expect(h.api.publicState().assets).toHaveLength(2);
    expect(run.reservedUsd).toBe(3); expect(run.costUsd).toBeCloseTo(.04);
    h.api.retryStudioRun({ runId: run.id, maxBudgetUsd: 6 }); await h.api.waitForIdle();
    expect(generateImage).toHaveBeenCalledOnce(); expect(h.api.readStudioRun({ runId: run.id }).jobs[0].error).toContain('may have been billed');
    expect(h.api.exportStudioRun({ runId: run.id }).assetCount).toBe(2);
  });
  it('resumes only unfinished variants after a definite rejection and restart, preserving written assets', async () => {
    let requestNumber = 0; const dispatched = [];
    const generateImage = vi.fn(async request => {
      const results = [...request.completedVariants];
      for (let index = 0; index < request.deliverable.variants; index++) {
        if (results.some(image => image.variantIndex === index)) continue;
        const receipt = { attemptId: `attempt-${++requestNumber}`, variantIndex: index, allowanceUsd: request.maxBudgetUsd / (request.deliverable.variants - request.completedVariants.length), status: 'dispatched' };
        dispatched.push(index); await request.onRequest(receipt);
        if (requestNumber === 2) throw Object.assign(new Error('Fixture request rejected'), { attemptReceipts: [{ ...receipt, status: 'failed', billable: false, costUsd: 0 }] });
        const image = { ...images(1, .02)[0], variantIndex: index, receipt: { ...receipt, status: 'succeeded', costUsd: .02 } };
        await request.onVariant(image); results.push(image);
      }
      return results;
    });
    const h = harness({ generateImage }); const run = await completed(h, { deliverableIds: ['brand-image', 'blogshort'], maxBudgetUsd: 2 });
    expect(run.status).toBe('partial'); const before = h.api.publicState().assets; expect(before).toHaveLength(2);
    const restarted = createContentWorkspace({ root: h.root, runAI: h.ai, generateImage }); restarted.recoverInterrupted();
    restarted.retryStudioRun({ runId: run.id }); await restarted.waitForIdle();
    const retried = restarted.readStudioRun({ runId: run.id }); expect(retried.status).toBe('succeeded');
    expect(restarted.publicState().assets).toHaveLength(4); expect(before.every(asset => restarted.publicState().assets.some(saved => saved.id === asset.id))).toBe(true);
    expect(dispatched).toEqual([0, 1, 1, 2]); expect(h.ai).toHaveBeenCalledOnce(); expect(generateImage.mock.calls[1][0].completedVariants).toHaveLength(1);
    expect(retried.costUsd).toBeCloseTo(.07); expect(retried.reservedUsd).toBeCloseTo(.07);
  });
  it('reserves image allowance before provider invocation and prevents underfunded requests', async () => {
    let observedReservation;
    const h = harness({ generateImage: async request => { const state = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')); observedReservation = state.contentRuns.find(run => run.id === request.runId).reservedUsd; expect(observedReservation).toBe(request.maxBudgetUsd); return images(3, 0.005); } });
    await completed(h, { maxBudgetUsd: 0.03 }); expect(observedReservation).toBe(0.03);
    const low = harness({ generateImage: vi.fn(async () => images()) });
    const run = await completed(low, { deliverableIds: ['brand-image', 'blogshort'], maxBudgetUsd: 0.01 });
    expect(run.jobs[0].status).toBe('failed'); expect(run.jobs[0].error).toContain('Image budget exhausted');
  });
  it('keeps unknown-cost image attempts reserved rather than reporting zero spend', async () => {
    const h = harness({ generateImage: async () => images().map(image => ({ ...image, receipt: { provider: 'fixture', costUsd: null } })) });
    const run = await completed(h, { maxBudgetUsd: 0.9 }); expect(run.status).toBe('succeeded'); expect(run.reservedUsd).toBe(0.9); expect(run.costUsd).toBe(0);
  });
  it('finishes written jobs independently when an image connection is unavailable', async () => {
    const h = harness(); const run = await completed(h, { deliverableIds: ['blogshort', 'brand-image'] });
    expect(run.status).toBe('partial'); expect(h.api.publicState().assets).toHaveLength(1); expect(run.jobs.find(job => job.kind === 'image').error).toContain('Connect the image provider');
    expect(h.api.publicState().capabilities.imagesConfigured).toBe(false);
  });
  it('preserves the original document evidence and deterministic metrics when deriving assets from a saved report', async () => {
    const h = harness(); const report = await completed(h, { deliverableIds: ['evidence-report'] }); expect(report.status).toBe('succeeded');
    const reportAsset = h.api.publicState().availableReports[0];
    const derivative = await completed(h, { source: { kind: 'report', id: reportAsset.id }, deliverableIds: ['newsletter'] }); expect(derivative.status).toBe('succeeded');
    const context = JSON.parse(h.calls[1].prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
    expect(context.source.evidence.find(record => record.id === 'original-brief').text).toBe(source.text);
    expect(context.source.evidence.some(record => record.id === 'record-1')).toBe(true);
    expect(context.source.aggregateMetrics).toEqual(source.aggregateMetrics);
    const asset = h.api.publicState().assets.find(value => value.deliverableId === 'newsletter');
    expect(h.api.readStudioAsset({ assetId: asset.id }).output.evidenceRegister.find(record => record.id === 'original-brief').text).toBe(source.text);
  });
  it('delivers only the selected campaign assets on an explicit action, with safe reports and actual images', async () => {
    const publishCampaign = vi.fn(async request => ({ version: 1, campaignId: request.campaignId, status: 'succeeded', assets: request.assets.map(asset => ({ assetId: asset.id })) }));
    const h = harness({ publishCampaign, generateImage: async () => images() });
    const earlier = await completed(h, { deliverableIds: ['newsletter'] });
    const run = await completed(h, { deliverableIds: ['blogshort', 'brand-image'] }); h.api.exportStudioRun({ runId: run.id }); expect(publishCampaign).not.toHaveBeenCalled();
    h.api.selectContentWorkspace('semrush'); await expect(h.api.publishStudioRun({ runId: run.id })).rejects.toThrow('selected workspace'); expect(publishCampaign).not.toHaveBeenCalled();
    h.api.selectContentWorkspace('general'); const receipt = await h.api.publishStudioRun({ runId: run.id }); const request = publishCampaign.mock.calls[0][0];
    const expected = h.api.publicState().assets.filter(asset => asset.runId === run.id); expect(request.assets.map(asset => asset.id).sort()).toEqual(expected.map(asset => asset.id).sort());
    expect(request.assets).toHaveLength(4); expect(request.assets.find(asset => asset.kind === 'text').html).toContain('<!doctype html>'); expect(request.assets.find(asset => asset.kind === 'image').png.equals(png)).toBe(true); expect(request.assets.find(asset => asset.kind === 'image').svg).toContain('Embedded raster');
    expect(h.api.readStudioRun({ runId: run.id }).googleDelivery).toEqual(receipt); expect(h.api.readStudioRun({ runId: earlier.id }).googleDelivery).toBeUndefined();
  });
  it('persists partial delivery checkpoints before continuing and supplies the saved receipt when retried', async () => {
    let attempt = 0; let checkpoint;
    const h = harness({ publishCampaign: async request => {
      if (++attempt === 1) {
        checkpoint = { version: 1, campaignId: request.campaignId, status: 'needs-reconciliation', operations: [{ operationId: 'fixture-operation', status: 'unknown' }], assets: [] };
        await request.onProgress({ phase: 'before-write', receipt: checkpoint });
        const saved = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')).contentRuns.find(run => run.id === request.campaignId); expect(saved.googleDelivery).toEqual(checkpoint);
        throw new Error('Fixture interrupted delivery');
      }
      expect(request.previousReceipt).toEqual(checkpoint); return { ...checkpoint, status: 'succeeded' };
    } });
    const run = await completed(h, { deliverableIds: ['blogshort'] }); await expect(h.api.publishStudioRun({ runId: run.id })).rejects.toThrow('Fixture interrupted'); expect(h.api.readStudioRun({ runId: run.id }).googleDelivery).toEqual(checkpoint);
    expect((await h.api.publishStudioRun({ runId: run.id })).status).toBe('succeeded'); expect(attempt).toBe(2);
  });
  it('hides private knowledge, product details and content assets when another workspace is selected', async () => {
    const h = harness(); h.api.selectContentWorkspace('semrush');
    h.api.saveContentWorkspace({ id: 'semrush', name: 'Semrush workspace', knowledge: { name: 'Semrush', positioning: 'Private positioning fixture' }, products: [{ id: 'private-product', name: 'Private product fixture', url: 'https://example.com/private-product', segment: 'enterprise', capabilities: ['Private capability fixture'] }] });
    const run = await completed(h, { deliverableIds: ['blogshort'] }); expect(run.status).toBe('succeeded'); const assetId = h.api.publicState().assets[0].id;
    h.api.selectContentWorkspace('general'); const state = h.api.publicState();
    expect(JSON.stringify(state)).not.toContain('Private positioning fixture'); expect(JSON.stringify(state)).not.toContain('Private capability fixture'); expect(state.assets).toHaveLength(0);
    expect(() => h.api.readStudioAsset({ assetId })).toThrow('selected workspace');
    expect(() => h.api.createContentRun({ source: { kind: 'report', id: assetId }, deliverableIds: ['newsletter'] })).toThrow('selected workspace');
  });
  it('durably records dispatch and each variant before callbacks return without duplicate accounting', async () => {
    let h;
    h = harness({ generateImage: async request => {
      const result = [];
      for (let index = 0; index < 3; index++) {
        const receipt = { attemptId: `durable-${index}`, variantIndex: index, allowanceUsd: 1, status: 'dispatched' };
        await request.onRequest(receipt);
        let stored = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8'));
        expect(stored.contentRuns[0].jobs[0].imageCalls[0].attempts.at(-1).status).toBe('dispatched');
        const image = { ...images(1, .03)[0], variantIndex: index, receipt: { ...receipt, status: 'succeeded', costUsd: .03 } };
        await request.onVariant(image); await request.onVariant(image);
        stored = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8'));
        expect(stored.assets).toHaveLength(index + 1);
        const saved = stored.assets[0]; expect(fs.readFileSync(path.join(h.root, 'runs', request.runId, `${saved.id}.png`)).equals(png)).toBe(true);
        expect(fs.existsSync(path.join(h.root, 'runs', request.runId, `brand-image.variant-${index}.json`))).toBe(true);
        result.push(image);
      }
      return result;
    } });
    const run = await completed(h); expect(run.costUsd).toBeCloseTo(.09); expect(run.reservedUsd).toBeCloseTo(.09); expect(run.receipts[0].attempts).toHaveLength(3);
  });
  it('blocks an unknown billed request after restart even when the user increases the budget', async () => {
    const generateImage = vi.fn(async request => {
      const receipt = { attemptId: 'ambiguous', variantIndex: 0, allowanceUsd: 1, status: 'dispatched' };
      await request.onRequest(receipt);
      throw Object.assign(new Error('Network disconnected after dispatch'), { attemptReceipts: [{ ...receipt, status: 'unknown', billable: null, costUsd: null }] });
    });
    const h = harness({ generateImage }); const run = await completed(h); expect(run.status).toBe('failed'); expect(run.reservedUsd).toBe(1); expect(run.costUsd).toBe(0);
    const restarted = createContentWorkspace({ root: h.root, runAI: h.ai, generateImage }); restarted.recoverInterrupted();
    restarted.retryStudioRun({ runId: run.id, maxBudgetUsd: 6 }); await restarted.waitForIdle();
    expect(generateImage).toHaveBeenCalledOnce(); expect(restarted.readStudioRun({ runId: run.id }).jobs[0].error).toContain('increasing this run budget does not resolve');
  });
  it('reuses a saved unknown-cost variant while reserving its cost and allowing a manual continuation', async () => {
    let call = 0;
    const generateImage = vi.fn(async request => {
      call++;
      const results = [...request.completedVariants];
      for (let index = 0; index < 3; index++) {
        if (results.some(image => image.variantIndex === index)) continue;
        const receipt = { attemptId: `unknown-cost-${call}-${index}`, variantIndex: index, allowanceUsd: request.maxBudgetUsd / (3 - request.completedVariants.length), status: 'dispatched' };
        await request.onRequest(receipt);
        const image = { ...images(1)[0], variantIndex: index, receipt: { ...receipt, status: 'succeeded', billable: true, costUsd: call === 1 ? null : .05 } };
        await request.onVariant(image); results.push(image);
        if (call === 1) throw Object.assign(new Error('Usage missing; remaining dispatches halted'), { partialImages: results, attemptReceipts: [image.receipt] });
      }
      return results;
    });
    const h = harness({ generateImage }); const first = await completed(h); const firstId = h.api.publicState().assets[0].id;
    expect(first.status).toBe('partial'); expect(first.reservedUsd).toBe(1); expect(first.costUsd).toBe(0);
    h.api.retryStudioRun({ runId: first.id, maxBudgetUsd: 4 }); await h.api.waitForIdle();
    const last = h.api.readStudioRun({ runId: first.id }); expect(last.status).toBe('succeeded'); expect(last.costUsd).toBeCloseTo(.1); expect(last.reservedUsd).toBeCloseTo(1.1);
    expect(h.api.publicState().assets.some(asset => asset.id === firstId)).toBe(true); expect(generateImage.mock.calls[1][0].completedVariants[0].receipt.costUsd).toBeNull();
  });
  it('keeps paid results arriving during cancellation and resumes only unstarted variants', async () => {
    let call = 0; let h;
    const generateImage = vi.fn(async request => {
      call++; const results = [...request.completedVariants];
      for (let index = 0; index < 3; index++) {
        if (results.some(image => image.variantIndex === index)) continue;
        const receipt = { attemptId: `cancel-${call}-${index}`, variantIndex: index, allowanceUsd: request.maxBudgetUsd / (3 - request.completedVariants.length), status: 'dispatched' };
        await request.onRequest(receipt);
        if (call === 1) await h.api.cancelStudioRun({ runId: request.runId });
        const image = { ...images(1, .02)[0], variantIndex: index, receipt: { ...receipt, status: 'succeeded', costUsd: .02 } };
        await request.onVariant(image); results.push(image);
        if (request.isCancelled()) throw Object.assign(new Error('Cancelled'), { partialImages: results, attemptReceipts: [image.receipt] });
      }
      return results;
    });
    h = harness({ generateImage }); const run = await completed(h); expect(run.status).toBe('cancelled'); expect(h.api.publicState().assets).toHaveLength(1);
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle(); expect(h.api.publicState().assets).toHaveLength(3); expect(h.api.readStudioRun({ runId: run.id }).costUsd).toBeCloseTo(.06);
    expect(generateImage.mock.calls[1][0].completedVariants).toHaveLength(1);
  });
  it('recovers a committed variant manifest after a crash before the state file included that asset', async () => {
    const h = harness({ generateImage: async () => images() }); const run = await completed(h);
    const statePath = path.join(h.root, 'state.json'); const stored = JSON.parse(fs.readFileSync(statePath, 'utf8')); const removed = stored.assets.pop();
    const savedRun = stored.contentRuns[0]; savedRun.status = 'running'; savedRun.jobs[0].status = 'running'; savedRun.jobs[0].assetIds = savedRun.jobs[0].assetIds.filter(id => id !== removed.id);
    savedRun.jobs[0].imageCalls[0].status = 'running'; savedRun.jobs[0].imageCalls[0].attempts = savedRun.jobs[0].imageCalls[0].attempts.filter(receipt => receipt.variantIndex !== removed.variantIndex);
    fs.writeFileSync(statePath, JSON.stringify(stored));
    const generateImage = vi.fn(async () => { throw new Error('Must not regenerate committed images'); });
    const restarted = createContentWorkspace({ root: h.root, runAI: h.ai, generateImage }); restarted.recoverInterrupted(); restarted.retryStudioRun({ runId: run.id }); await restarted.waitForIdle();
    expect(generateImage).not.toHaveBeenCalled(); expect(restarted.publicState().assets).toHaveLength(3); expect(restarted.publicState().assets.some(asset => asset.id === removed.id)).toBe(true);
    expect(restarted.readStudioRun({ runId: run.id }).status).toBe('succeeded'); expect(restarted.readStudioRun({ runId: run.id }).costUsd).toBeCloseTo(.06);
  });
  it('retains error-provided completed variants even when an adapter did not call onVariant', async () => {
    const h = harness({ generateImage: async request => {
      const receipt = { attemptId: 'partial-response', variantIndex: 0, allowanceUsd: 1, status: 'dispatched' }; await request.onRequest(receipt);
      const image = { ...images(1, .04)[0], variantIndex: 0, receipt: { ...receipt, status: 'succeeded', costUsd: .04 } };
      throw Object.assign(new Error('Later work stopped'), { partialImages: [image], attemptReceipts: [image.receipt] });
    } });
    const run = await completed(h); expect(run.status).toBe('partial'); expect(h.api.publicState().assets).toHaveLength(1); expect(run.costUsd).toBeCloseTo(.04); expect(run.reservedUsd).toBeCloseTo(.04);
  });
  it('rejects oversized image prompts before any provider call or budget reservation', async () => {
    const generateImage = vi.fn(async () => images()); const h = harness({ generateImage });
    const run = await completed(h, { source: { ...source, text: 'Source material. '.repeat(2400) } });
    expect(run.status).toBe('failed'); expect(run.jobs[0].error).toContain('32,000'); expect(run.jobs[0].error).toContain('Shorten the source brief'); expect(generateImage).not.toHaveBeenCalled(); expect(run.reservedUsd).toBe(0);
  });
  it('releases pre-dispatch failures but retains a legacy call with unknown dispatch outcome', async () => {
    const preflight = harness({ generateImage: async () => { throw Object.assign(new Error('Image provider needs more budget'), { beforeDispatch: true }); } });
    expect((await completed(preflight)).reservedUsd).toBe(0);
    const unknown = harness({ generateImage: async () => { throw new Error('Legacy adapter disconnected'); } });
    expect((await completed(unknown)).reservedUsd).toBe(3);
  });
  it('keeps images owned by the originating workspace when the active workspace changes during generation', async () => {
    let h; h = harness({ generateImage: async request => {
      h.api.selectContentWorkspace('general');
      const result = [];
      for (let index = 0; index < 3; index++) {
        const receipt = { attemptId: `workspace-${index}`, variantIndex: index, allowanceUsd: 1, status: 'dispatched' }; await request.onRequest(receipt);
        const image = { ...images(1)[0], variantIndex: index, receipt: { ...receipt, status: 'succeeded', costUsd: .02 } }; await request.onVariant(image); result.push(image);
        expect(h.api.publicState().assets).toHaveLength(0);
      }
      return result;
    } });
    h.api.selectContentWorkspace('semrush'); const run = h.api.createContentRun({ source, deliverableIds: ['brand-image'], maxBudgetUsd: 3 }); await h.api.waitForIdle();
    expect(h.api.publicState().assets).toHaveLength(0); expect(() => h.api.exportStudioRun({ runId: run.id })).toThrow('selected workspace');
    h.api.selectContentWorkspace('semrush'); expect(h.api.publicState().assets).toHaveLength(3); expect(h.api.publicState().assets.every(asset => asset.workspaceId === 'semrush')).toBe(true); expect(h.api.exportStudioRun({ runId: run.id }).assetCount).toBe(3);
  });

  it('integrates with the real adapter contract, reallocating known cost headroom and preserving receipts across retry', async () => {
    function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
    function chunk(type, bytes) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, crc]); }
    const header = Buffer.alloc(13); header.writeUInt32BE(1536); header.writeUInt32BE(1024, 4); header[8] = 1;
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((1536 / 8 + 1) * 1024))), chunk('IEND', Buffer.alloc(0))]);
    let requests = 0; const fetchImpl = vi.fn(async () => {
      if (++requests === 2) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }], usage: { input_tokens: 1000, input_tokens_details: { text_tokens: 1000, image_tokens: 0 }, output_tokens: 4096, total_tokens: 5096 }, output_format: 'png' }), { headers: { 'x-request-id': 'req_fixture' } });
    });
    const provider = imageProvider.createImageProvider({ getApiKey: () => 'fixture-only', fetchImpl });
    const h = harness({ generateImage: provider.generateImage }); const run = await completed(h, { maxBudgetUsd: 1 });
    expect(run.status).toBe('partial'); expect(h.api.publicState().assets).toHaveLength(1); expect(run.reservedUsd).toBeCloseTo(.12788);
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    const final = h.api.readStudioRun({ runId: run.id }); expect(final.status).toBe('succeeded'); expect(fetchImpl).toHaveBeenCalledTimes(4); expect(h.api.publicState().assets).toHaveLength(3);
    expect(final.costUsd).toBeCloseTo(.38364); expect(final.reservedUsd).toBeCloseTo(.38364);
    expect(h.api.publicState().assets.every(asset => asset.receipt.requestedModel === imageProvider.MODEL && asset.receipt.costBasis === 'usage-estimate')).toBe(true);
  });

});
