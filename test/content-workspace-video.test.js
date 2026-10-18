import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { picture } from './helpers/pictures.js';
const { createContentWorkspace } = require('../src/main/content-workspace.js');
const { createAiRouting } = require('../src/main/ai-routing.js');
const { createAiCatalog } = require('../src/main/ai-catalog.js');

// The first video deliverable (content-workspace.js kitVideo / performVideo / persistVideo): a short social clip in a set
// of channel assets, made with fal.ai through the host's generateVideo. The plan is written once and reused, the clip is
// checkpointed before it is sent and resumed (never sent twice) after an interruption, and the saved video plays,
// exports and opens as an MP4 with its on-screen lines beside it.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(256, 2)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const PLAN = { title: 'Why AI answers cite brands', prompt: 'A slow push-in on a laptop showing an AI answer card that says "Cited brands win", warm morning light, shallow depth of field.', onScreenText: ['Cited brands win', 'Track your AI citations'], keyframePrompt: 'A laptop on a desk showing an AI answer card.', avoid: ['charts'], evidenceIds: [] };
const source = { kind: 'text', title: 'AI citations', text: 'AI answers now cite brands, and marketers want to measure it. Teams lack tracking.' };

function harness({ videoModel = 'bytedance/seedance-2.0/fast/text-to-video', generateVideo } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-')); roots.push(root);
  const settings = { aiRouting: { version: 1, defaults: { text: { route: 'auto', model: 'claude-opus-5-5' }, image: { route: 'openai', model: 'gpt-image-2.5-flare', quality: 'medium' }, video: { route: 'fal', model: videoModel } }, tasks: {} } };
  const catalog = createAiCatalog({ dataDir: '', codexHome: '/nonexistent-codex-home', fetchImpl: async () => { throw new Error('offline'); } });
  const routes = createAiRouting({ getSettings: () => settings, catalog });
  const routing = { resolve: routes.resolve, snapshot: routes.snapshot, current: routes.current, taskIdForPrompt: routes.taskIdForPrompt, priceFor: catalog.priceFor, unitsFor: catalog.unitsFor, mediaProblem: () => '' };
  const runAI = vi.fn(async (request) => ({ output: request.schema.properties.keyframePrompt ? PLAN : { headline: 'A headline of several words', visualIdea: 'x', callouts: [], symbols: [], avoid: [] }, receipt: { provider: 'fixture', costUsd: 0.01 } }));
  const generateImage = vi.fn(async ({ deliverable, onRequest }) => { const receipt = { attemptId: 'kf-1', variantIndex: 0, status: 'dispatched' }; await onRequest?.(receipt); return deliverable.variantPrompts.map((_, index) => ({ variantIndex: index, png: Buffer.from(PNG), receipt: { ...receipt, status: 'succeeded', costUsd: 0.06 } })); });
  const video = generateVideo || vi.fn(async (request) => {
    const receipt = { provider: 'fal', attemptId: 'vid-attempt-1', status: 'dispatched', requestId: null, estimatedCostUsd: 1.94, costUsd: null };
    await request.onRequest(receipt); await request.onSubmitted({ ...receipt, requestId: 'vid-1', statusUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-1/status', responseUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/vid-1' });
    request.onProgress?.({ status: 'IN_QUEUE', queuePosition: 2, elapsedMs: 0 });
    return { mp4: MP4, durationSeconds: 8, receipt: { ...receipt, requestId: 'vid-1', status: 'succeeded', costUsd: 1.94 } };
  });
  const api = createContentWorkspace({ root, runAI, generateImage, generateVideo: video, routing, capabilities: () => ({ imagesConfigured: true, videosConfigured: true }), openFile: vi.fn(), clock: () => new Date('2026-10-17T12:00:00.000Z') });
  api.selectContentWorkspace('semrush');
  return { root, api, runAI, generateImage, generateVideo: video, settings };
}
async function made(h) { const run = h.api.createAssetKit({ source, deliverableIds: ['social-video'] }); await h.api.waitForIdle(); return h.api.readStudioRun({ runId: run.id }); }

describe('short social video', () => {
  it('prices the clip before anything is spent, writes its plan, makes it and saves a playable MP4 with its lines', async () => {
    const h = harness();
    const plan = h.api.planAssetKit({ source, deliverableIds: ['social-video'] });
    const item = plan.folders.flatMap((folder) => folder.items).find((entry) => entry.id === 'social-video');
    expect(item).toMatchObject({ kind: 'video', selected: true, available: true, optIn: true, video: { seconds: 8, modelLabel: 'Seedance 2.0 Fast' } });
    expect(item.usd).toBeGreaterThanOrEqual(1.93);
    expect(plan.routes.films).toMatch(/fal\.ai/);
    expect(h.runAI).not.toHaveBeenCalled(); expect(h.generateVideo).not.toHaveBeenCalled();
    const run = await made(h);
    expect(run.status).toBe('succeeded');
    const [request] = h.generateVideo.mock.calls[0];
    expect(request.task).toMatchObject({ taskId: 'video.social-clip', route: 'fal', model: 'bytedance/seedance-2.0/fast/text-to-video', video: { durationSeconds: 8, aspectRatio: '9:16', sound: false, input: 'text' } });
    expect(request.prompt).not.toContain('Cited brands win'); // on-screen words never go to the video model
    expect(request.imageDataUri).toBe(''); expect(h.generateImage).not.toHaveBeenCalled();
    const asset = h.api.publicState().assets.find((row) => row.runId === run.id);
    expect(asset).toMatchObject({ kind: 'video', format: 'mp4', deliverableId: 'social-video', durationSeconds: 8, aspectRatio: '9:16', sound: false, hasPoster: false, captions: PLAN.onScreenText, title: PLAN.title });
    expect(fs.readFileSync(path.join(h.root, 'runs', run.id, `${asset.id}.mp4`)).equals(MP4)).toBe(true);
    expect(fs.readFileSync(path.join(h.root, 'runs', run.id, `${asset.id}.srt`), 'utf8')).toContain('Track your AI citations');
    expect(run.receipts.find((row) => row.stage === 'video-social-video')).toMatchObject({ status: 'succeeded', costUsd: 1.94, attempts: [expect.objectContaining({ requestId: 'vid-1', status: 'succeeded' })] });
    expect(run.costUsd).toBeGreaterThanOrEqual(1.94);
    const read = h.api.readStudioAsset({ assetId: asset.id });
    expect(read.video).toMatchObject({ mime: 'video/mp4', bytes: MP4.length }); expect(Buffer.from(read.video.base64, 'base64').equals(MP4)).toBe(true); expect(read.captions).toEqual(PLAN.onScreenText);
    expect((await h.api.openStudioAsset({ assetId: asset.id })).path).toMatch(/\.mp4$/);
    const exported = h.api.exportAssetKit({ runId: run.id });
    const files = fs.readdirSync(exported.path, { recursive: true }).map(String);
    expect(files.some((name) => name.endsWith('.mp4'))).toBe(true); expect(files.some((name) => name.endsWith('.srt'))).toBe(true);
  });

  it('draws a first frame with the campaign set’s reference images when the video model starts from a picture', async () => {
    const h = harness({ videoModel: 'bytedance/seedance-2.0/fast/image-to-video' });
    h.api.addBrandImage({ workspaceId: 'semrush', family: 'campaign', role: 'style', name: 'style.png', data: picture(400, 300, 5) });
    h.api.addBrandImage({ workspaceId: 'semrush', family: 'campaign', role: 'logo', name: 'logo.png', data: picture(331, 60, 6) });
    const run = await made(h);
    expect(run.status).toBe('succeeded');
    const [frame] = h.generateImage.mock.calls[0];
    expect(frame.task).toMatchObject({ taskId: 'video.keyframe', route: 'openai' });
    expect(frame.deliverable).toMatchObject({ size: '1024x1536', variants: 1 });
    expect(frame.deliverable.variantPrompts[0]).toContain(`FRAME: ${PLAN.keyframePrompt}`);
    // Its style examples go with it, numbered in the prompt; the logo stays out of a video with no logos.
    expect(frame.deliverable.references.map((ref) => ref.role)).toEqual(['style']);
    expect(frame.deliverable.variantPrompts[0]).toContain('REFERENCE IMAGES, attached in this order: image 1 is an approved Semrush style example.');
    expect(frame.deliverable.variantPrompts[0]).not.toContain('LOGO:');
    expect(h.generateVideo.mock.calls[0][0].imageDataUri).toMatch(/^data:image\/png;base64,/);
    const asset = h.api.publicState().assets.find((row) => row.runId === run.id && row.kind === 'video');
    expect(asset.hasPoster).toBe(true); expect(h.api.readStudioAsset({ assetId: asset.id }).posterDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('resumes a clip fal took by its request id on retry, reusing the plan, and never sends it twice', async () => {
    let first = true;
    const generateVideo = vi.fn(async (request) => {
      if (first) {
        first = false;
        const receipt = { provider: 'fal', attemptId: 'vid-attempt-1', status: 'dispatched', requestId: null };
        await request.onRequest(receipt); await request.onSubmitted({ ...receipt, requestId: 'vid-9', statusUrl: 'https://queue.fal.run/x/requests/vid-9/status', responseUrl: 'https://queue.fal.run/x/requests/vid-9' });
        throw Object.assign(new Error('fal.ai didn’t finish within 15 minutes.'), { code: 'FAL_TIMEOUT', receipt: { ...receipt, requestId: 'vid-9', status: 'unknown' } });
      }
      return { mp4: MP4, durationSeconds: 8, receipt: { ...request.resume.receipt, status: 'succeeded', costUsd: 1.94 } };
    });
    const h = harness({ generateVideo });
    const run = await made(h);
    expect(run.status).toBe('failed'); expect(run.jobs[0].error).toContain('didn’t finish within 15 minutes');
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    const final = h.api.readStudioRun({ runId: run.id });
    expect(final.status).toBe('succeeded');
    expect(generateVideo).toHaveBeenCalledTimes(2);
    expect(generateVideo.mock.calls[1][0].resume).toMatchObject({ requestId: 'vid-9' });
    expect(h.runAI.mock.calls.filter(([request]) => request.schema.properties.keyframePrompt)).toHaveLength(1); // the plan was reused
    expect(final.receipts.filter((row) => row.stage === 'video-social-video')).toHaveLength(1);
  });

  it('blocks an automatic repeat when a clip may have been sent but fal never gave it an id', async () => {
    const generateVideo = vi.fn(async (request) => { await request.onRequest({ provider: 'fal', attemptId: 'vid-attempt-2', status: 'dispatched', requestId: null }); throw Object.assign(new Error('fal.ai could not be reached.'), { code: 'FAL_NETWORK' }); });
    const h = harness({ generateVideo });
    const run = await made(h);
    expect(run.status).toBe('failed');
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).jobs[0].error).toContain('An earlier video request may have been billed but has no saved result');
    expect(generateVideo).toHaveBeenCalledTimes(1);
  });
});
