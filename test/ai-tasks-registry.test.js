import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const TASKS = require('../src/shared/ai-tasks.json');
const PROVIDERS = require('../src/shared/ai-providers.json');
const MODELS = require('../src/shared/ai-models.json');
const REGISTRY = require('../src/shared/prompt-registry.json');
const content = require('../src/shared/content-studio.js');
const { createAiRouting } = require('../src/main/ai-routing.js');

// The task registry (src/shared/ai-tasks.json) lists every AI job the studio runs. A new call site, prompt or deliverable
// without a task would run on routing nobody can see or change.
const ids = TASKS.tasks.map((task) => task.id);
const byId = new Map(TASKS.tasks.map((task) => [task.id, task]));
const routes = { text: ['@text', '@inherit', 'auto', 'claude', 'claude-api', 'codex', 'openai', 'openrouter'], image: ['@inherit', 'openai', 'fal'], video: ['fal'] };
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : [])); }

describe('AI task registry', () => {
  it('has unique ids in known groups and kinds, with defaults that fit their route', () => {
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(TASKS.groups.map((group) => group.id));
    for (const task of TASKS.tasks) {
      expect(groups.has(task.group), task.id).toBe(true);
      expect(['text', 'image', 'video'], task.id).toContain(task.kind);
      if (task.default.route) expect(routes[task.kind], task.id).toContain(task.default.route);
      if (task.default.effort && !String(task.default.effort).startsWith('@')) expect(PROVIDERS.efforts, task.id).toContain(task.default.effort);
      if (task.default.model && !String(task.default.model).startsWith('@')) expect(MODELS.text.some((row) => row.id === task.default.model), task.id).toBe(true);
    }
  });
  it('has inherit chains that end in a task with its own defaults', () => {
    for (const task of TASKS.tasks) {
      const seen = new Set(); let node = task;
      while (node.inherit) { expect(seen.has(node.id), `${task.id} loops`).toBe(false); seen.add(node.id); node = byId.get(node.inherit); expect(node, `${task.id} inherits a missing task`).toBeTruthy(); }
    }
  });
  it('knows every task id the main process names', () => {
    const named = new Set();
    for (const file of walk('src/main')) for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/(?:taskId:\s*|runTask\(run,\s*|resolve\(|kitTextTask\([^)]*\)\s*:\s*)'((?:research|quickScans|reports|assets|create|pictures|video|assistant|data)\.[a-z-]+)'/g)) named.add(id);
    for (const file of walk('src/main')) for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/'((?:research|quickScans|reports|assets|create|pictures|video|assistant|data)\.[a-z][a-z-]+)'/g)) if (/^(?:quickScans|create|video|assistant|data)\./.test(id) || id.startsWith('pictures.kit-') || id.startsWith('pictures.ask') || id.startsWith('pictures.content')) named.add(id);
    const promptIds = new Set(REGISTRY.prompts.map((entry) => entry.id));
    const unknown = [...named].filter((id) => !/\.(json|js|md|png|html|txt|csv)$/.test(id)).filter((id) => !byId.has(id) && !promptIds.has(id));
    expect(unknown).toEqual([]);
    expect(named.size).toBeGreaterThan(10);
  });
  it('maps every prompt that calls a model to a task', () => {
    const routing = createAiRouting({ getSettings: () => ({}) });
    const missing = REGISTRY.prompts.filter((entry) => !['none'].includes(entry.ai?.modelSource || 'none')).filter((entry) => !routing.taskIdForPrompt(entry)).map((entry) => entry.id);
    expect(missing).toEqual([]);
    for (const entry of REGISTRY.prompts.filter((row) => row.ai?.taskId)) expect(byId.has(entry.ai.taskId), entry.id).toBe(true);
  });
  it('gives every content deliverable a task', () => {
    const routing = createAiRouting({ getSettings: () => ({}) });
    for (const deliverable of content.CONTENT_DELIVERABLES) {
      const taskId = deliverable.kind === 'image' ? 'pictures.kit-image' : deliverable.kind === 'video' ? 'video.social-clip' : ['evidence-report', 'editorial-toolkit'].includes(deliverable.id) ? 'reports.trends-report' : byId.has(`assets.${deliverable.id}`) ? `assets.${deliverable.id}` : 'assets.default';
      expect(() => routing.resolve(taskId), deliverable.id).not.toThrow();
    }
  });
  it('has presets that name only known tasks and catalog models', () => {
    for (const preset of TASKS.presets) for (const [taskId, choice] of Object.entries(preset.tasks)) {
      expect(byId.has(taskId), `${preset.id} ${taskId}`).toBe(true);
      expect(MODELS.text.some((row) => row.id === choice.model), `${preset.id} ${choice.model}`).toBe(true);
    }
    expect(TASKS.presets.map((preset) => preset.id)).toEqual(['balanced', 'lowest-cost', 'highest-quality']);
  });
});
