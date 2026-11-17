import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createChannelReferences } = require('../src/main/channel-references');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const png = () => { const bytes = Buffer.alloc(32); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(32, 16); bytes.writeUInt32BE(32, 20); return bytes; };
function store(root) { if (!root) { root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-references-')); roots.push(root); } return { root, refs: createChannelReferences({ root, clock: () => new Date('2026-11-17T12:00:00Z') }) }; }
const scope = { workspaceId: 'semrush', channelId: 'social' };
const example = (extra = {}) => ({ ...scope, name: 'example.png', data: png(), description: 'The bold headline and simple product layout worked well.', by: { id: 'alex', name: 'Alex' }, ...extra });

describe('channel image examples', () => {
  it('persists a described image and reads it only inside its workspace and channel', () => {
    const { root, refs } = store();
    const saved = refs.add(example());
    expect(saved.reference.description).toBe('The bold headline and simple product layout worked well.');
    expect(saved.reference).not.toHaveProperty('path');
    const reloaded = store(root).refs;
    expect(reloaded.list(scope)).toEqual([saved.reference]);
    expect(reloaded.read({ ...scope, imageId: saved.reference.id }).dataUrl).toBe(`data:image/png;base64,${png().toString('base64')}`);
    expect(reloaded.list({ ...scope, workspaceId: 'adobe' })).toEqual([]);
    expect(reloaded.list({ ...scope, channelId: 'blog' })).toEqual([]);
    expect(() => reloaded.read({ ...scope, workspaceId: 'adobe', imageId: saved.reference.id })).toThrow(/not.*channel/i);
    expect(() => reloaded.remove({ ...scope, channelId: 'blog', imageId: saved.reference.id })).toThrow(/not.*channel/i);
  });

  it('requires a useful description, valid bytes and bounded identifiers before saving', () => {
    const { refs } = store();
    for (const description of ['', '   ', 'a'.repeat(2001)]) expect(() => refs.add(example({ description }))).toThrow(/description/i);
    expect(() => refs.add(example({ data: Buffer.from('<svg>not a raster</svg>') }))).toThrow(/PNG, JPEG or WebP/);
    expect(() => refs.add(example({ data: Buffer.alloc(10 * 1024 * 1024 + 1) }))).toThrow(/10 MB/);
    expect(() => refs.add(example({ workspaceId: '../other' }))).toThrow(/workspace/i);
    expect(() => refs.add(example({ channelId: '../blog' }))).toThrow(/channel/i);
    expect(refs.list(scope)).toEqual([]);
  });

  it('keeps description edits and deletion scoped, and limits each channel to four examples', () => {
    const { refs } = store();
    const saved = refs.add(example());
    expect(() => refs.update({ ...scope, channelId: 'blog', imageId: saved.reference.id, description: 'Changed.' })).toThrow(/not.*channel/i);
    expect(refs.update({ ...scope, imageId: saved.reference.id, description: 'Use the editorial spacing.' }).reference.description).toBe('Use the editorial spacing.');
    for (let i = 0; i < 3; i++) refs.add(example());
    expect(() => refs.add(example())).toThrow(/four/i);
    refs.remove({ ...scope, imageId: saved.reference.id });
    expect(refs.list(scope)).toHaveLength(3);
    expect(() => refs.read({ ...scope, imageId: saved.reference.id })).toThrow(/not.*channel/i);
  });

  it('supplies the stored raster bytes and descriptions together for image generation', () => {
    const { refs } = store(); const saved = refs.add(example());
    const generated = refs.generation(scope);
    expect(generated.references).toHaveLength(1);
    expect(generated.references[0]).toMatchObject({ id: saved.reference.id, role: 'style', mime: 'image/png', description: saved.reference.description });
    expect(Buffer.from(generated.references[0].data)).toEqual(png());
    expect(generated.prompt).toContain(saved.reference.description);
    expect(refs.generation({ workspaceId: 'adobe', channelId: 'social' })).toEqual({ references: [], prompt: '' });
  });

  it('refuses a stored image whose bytes changed after it was saved', () => {
    const { root, refs } = store(); const { reference } = refs.add(example());
    expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/);
    const changed = png(); changed[31] = 1;
    fs.writeFileSync(path.join(root, scope.workspaceId, scope.channelId, `${reference.id}.png`), changed);
    expect(() => refs.read({ ...scope, imageId: reference.id })).toThrow(/changed|match/i);
    expect(() => refs.generation(scope)).toThrow(/changed|match/i);
  });
});
