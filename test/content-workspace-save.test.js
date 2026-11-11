import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
const { createContentWorkspace } = workspaceModule;

// The state file during a burst of saves (content-workspace.js save): memory and the push are always current; the file
// is written at once for the first save in a quiet spell, and once more at the end of the spell for the rest.
const roots = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const program = (name) => ({ id: 'program-a', name, sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 } });
function studio(saveCoalesceMs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-workspace-save-')); roots.push(root);
  const emit = vi.fn();
  const api = createContentWorkspace({ root, emit, runAI: async () => ({ output: {}, receipt: {} }), getDatasets: () => [], readDataset: async () => ({ items: [] }), ...(saveCoalesceMs === undefined ? {} : { saveCoalesceMs }) });
  const onDisk = () => { const file = path.join(root, 'state.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).programs.map((row) => row.name) : null; };
  const inMemory = () => api.publicState().programs.map((row) => row.name);
  return { api, emit, onDisk, inMemory };
}

describe('saving the studio state', () => {
  it('writes every save when no window is set (tests and scripts)', () => {
    const { api, onDisk } = studio();
    api.saveResearchProgram(program('One')); expect(onDisk()).toEqual(['One']);
    api.saveResearchProgram(program('Two')); expect(onDisk()).toEqual(['Two']);
  });
  it('writes the first save of a burst at once, the rest together at the end of the window, and pushes every one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00.000Z'));
    const { api, emit, onDisk, inMemory } = studio(250);
    const pushes = () => emit.mock.calls.length;
    const before = pushes();
    api.saveResearchProgram(program('One'));
    expect(onDisk()).toEqual(['One']); // a single action is on disk before its call returns
    vi.setSystemTime(new Date('2026-11-11T12:00:00.050Z'));
    api.saveResearchProgram(program('Two')); api.saveResearchProgram(program('Three'));
    expect(inMemory()).toEqual(['Three']);
    expect(onDisk()).toEqual(['One']); // inside the window: not written again yet
    expect(pushes() - before).toBeGreaterThanOrEqual(3); // but every change was pushed
    vi.advanceTimersByTime(250);
    expect(onDisk()).toEqual(['Three']);
    // After a quiet spell the next save is immediate again.
    vi.setSystemTime(new Date('2026-11-11T12:00:02.000Z'));
    api.saveResearchProgram(program('Four')); expect(onDisk()).toEqual(['Four']);
  });
  it('writes what is pending when asked to, as the app does before it quits', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00.000Z'));
    const { api, onDisk } = studio(250);
    api.saveResearchProgram(program('One')); api.saveResearchProgram(program('Two'));
    expect(onDisk()).toEqual(['One']);
    api.flushSave();
    expect(onDisk()).toEqual(['Two']);
    api.flushSave(); // nothing pending: no error, no change
    expect(onDisk()).toEqual(['Two']);
  });
});
