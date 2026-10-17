'use strict';
// Every picture and video the studio makes goes through here, by the task's resolved route: OpenAI's GPT Image
// (image-provider.js) or fal.ai (fal-provider.js). The request contract is the image provider's (a checkpoint before each
// paid request, receipts, partialImages, an unknown outcome blocks repeats), plus the task. Each picture request must
// list the brand reference images it sends, an empty list when its set has none (test/brand-references.test.js).
// Electron-free.

function problem(code, field, message, extra = {}) { return Object.assign(new Error(message), { code, field, ...extra }); }

function createMediaRouter({ routing, openaiImages, fal, catalog, connections } = {}) {
  const taskOf = (request) => request.task || (request.taskId ? routing.resolve(request.taskId, request.context || {}) : null);
  // generateImage({ task | taskId, deliverable, runId, maxBudgetUsd, isCancelled, signal, onRequest, onVariant, completedVariants })
  async function generateImage(request = {}) {
    const deliverable = request.deliverable || {};
    if (!Array.isArray(deliverable.references)) throw problem('IMAGE_INPUT_INVALID', 'deliverable.references', 'Every picture request lists the brand reference images it sends (an empty list when its set has none).', { beforeDispatch: true });
    const task = taskOf(request);
    if (!task) throw problem('IMAGE_INPUT_INVALID', 'taskId', 'A picture request names its AI job.', { beforeDispatch: true });
    if (task.problem) throw problem('IMAGE_ROUTING', 'model', `${task.problem} Nothing was started.`, { beforeDispatch: true });
    if (task.route === 'openai') {
      if (!openaiImages) throw problem('IMAGE_AUTH_REQUIRED', 'imageConnection', 'Pictures aren’t set up on this studio.', { beforeDispatch: true });
      return openaiImages.generateImage({ ...request, deliverable: { ...deliverable, model: task.model, quality: task.quality || 'medium' } });
    }
    if (task.route === 'fal') {
      if (!fal) throw problem('IMAGE_AUTH_REQUIRED', 'imageConnection', 'fal.ai isn’t set up on this studio.', { beforeDispatch: true });
      let profile = catalog?.profile?.('fal', task.model, 'image') || {};
      try { const live = await catalog?.falModel?.(task.model, { kind: 'image' }); if (live?.profile) profile = { ...profile, ...live.profile }; } catch (error) { if (error.code === 'FAL_AUTH') throw Object.assign(error, { beforeDispatch: true }); }
      const price = catalog?.priceFor?.('fal', task.model, 'image') || task.price || {};
      const { task: _task, taskId: _taskId, context: _context, input: _input, ...rest } = request;
      return fal.generateImages({ ...rest, deliverable, model: task.model, profile, price });
    }
    throw problem('IMAGE_ROUTING', 'route', `${task.routeLabel || task.route} can’t draw pictures. Choose OpenAI or fal.ai in Settings, Model routing.`, { beforeDispatch: true });
  }
  // generateVideo({ task | taskId, prompt, imageDataUri, runId, maxBudgetUsd, onRequest, onSubmitted, onProgress, resume, isCancelled, signal })
  async function generateVideo(request = {}) {
    const task = taskOf(request);
    if (!task || task.kind !== 'video') throw problem('VIDEO_INPUT_INVALID', 'taskId', 'A video request names its AI job.');
    if (task.problem) throw problem('VIDEO_ROUTING', 'model', `${task.problem} Nothing was started.`);
    if (task.route !== 'fal' || !fal) throw problem('VIDEO_ROUTING', 'route', 'Videos are made with fal.ai. Connect it in Settings, AI connections.');
    let profile = catalog?.profile?.('fal', task.model, 'video') || {};
    try { const live = await catalog?.falModel?.(task.model, { kind: 'video' }); if (live?.profile) profile = { ...profile, ...live.profile }; } catch (error) { if (error.code === 'FAL_AUTH') throw error; }
    const price = catalog?.priceFor?.('fal', task.model, 'video') || task.price || {};
    const video = task.video || {};
    return fal.generateVideo({ ...request, model: task.model, profile, price, durationSeconds: request.durationSeconds ?? video.durationSeconds, resolution: request.resolution ?? video.resolution, aspectRatio: request.aspectRatio ?? video.aspectRatio, sound: request.sound ?? video.sound });
  }
  // Whether this host can make the task's pictures or videos now (key saved and the route takes the kind), with copy.
  function ready(taskId, context = {}) { return !problem_(taskId, context); }
  function problem_(taskId, context = {}) {
    let task; try { task = routing.resolve(taskId, context); } catch (error) { return error.message; }
    if (task.problem) return task.problem;
    if (task.route === 'openai' && !openaiImages) return 'Pictures aren’t set up on this studio.';
    if (task.route === 'fal' && !fal) return 'fal.ai isn’t set up on this studio.';
    const missing = connections?.problem?.(task.route);
    if (missing) return task.kind === 'video' ? 'Connect fal.ai in Settings, AI connections to make videos.' : missing.replace(/ Nothing was started\.$/, '');
    return '';
  }
  return { generateImage, generateVideo, ready, problem: problem_ };
}

module.exports = { createMediaRouter };
