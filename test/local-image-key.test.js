import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { readLocalImageKey } = createRequire(import.meta.url)('../src/main/local-image-key');
function withRoot(fn) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-key-fixture-')); try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } }
describe('explicit image credential file boundary', () => {
  it('reads only the requested local image key without mutating inherited environment', () => withRoot(root => {
    fs.writeFileSync(path.join(root, '.env.local'), 'OPENAI_API_KEY="fixture-private-value"\nOTHER_VARIABLE=ignored\n');
    const before = { ...process.env };
    expect(readLocalImageKey({ appPath: root, enabled: true })).toBe('fixture-private-value');
    expect(process.env).toEqual(before);
    expect(readLocalImageKey({ appPath: root })).toBe('');
  }));
  it('does not follow symlinked credential files', () => withRoot(root => {
    fs.writeFileSync(path.join(root, 'elsewhere'), 'OPENAI_API_KEY=fixture-private-value');
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.env.local'));
    expect(() => readLocalImageKey({ appPath: root, enabled: true })).toThrow('could not be read');
  }));
  it('does not disclose malformed values in errors', () => withRoot(root => {
    fs.writeFileSync(path.join(root, '.env.local'), 'OPENAI_API_KEY="fixture private value"');
    expect(() => readLocalImageKey({ appPath: root, enabled: true })).toThrow('could not be read');
  }));
  it('treats missing credentials as disconnected and rejects oversized files', () => withRoot(root => {
    expect(readLocalImageKey({ appPath: root, enabled: true })).toBe('');
    fs.writeFileSync(path.join(root, '.env.local'), 'x'.repeat(64001));
    expect(() => readLocalImageKey({ appPath: root, enabled: true })).toThrow('could not be read');
  }));
  it('supports an explicit absolute file with discovery disabled and leaves unrelated variables untouched', () => withRoot(root => {
    const target = path.join(root, 'approved-connection.env');
    fs.writeFileSync(target, 'OPENAI_API_KEY=fixture-explicit-value\nAPIFY_API_TOKEN=fixture-unrelated\n');
    const before = { ...process.env };
    expect(readLocalImageKey({ credentialFile: target, enabled: false })).toBe('fixture-explicit-value');
    expect(process.env).toEqual(before);
  }));
  it.each(['relative.env', '../outside.env', 'file:///tmp/key.env', '', null, 7])('rejects non-absolute explicit configuration without falling back: %s', credentialFile => withRoot(root => {
    fs.writeFileSync(path.join(root, '.env.local'), 'OPENAI_API_KEY=fixture-fallback');
    expect(() => readLocalImageKey({ credentialFile, appPath: root, enabled: true })).toThrow('could not be read');
  }));
  it('does not follow an explicitly configured symlink', () => withRoot(root => {
    const target = path.join(root, 'real.env'); const linked = path.join(root, 'linked.env');
    fs.writeFileSync(target, 'OPENAI_API_KEY=fixture-private-value'); fs.symlinkSync(target, linked);
    expect(() => readLocalImageKey({ credentialFile: linked })).toThrow('could not be read');
  }));
  it('does not fall back to app-directory discovery when an explicit file is missing', () => withRoot(root => {
    fs.writeFileSync(path.join(root, '.env.local'), 'OPENAI_API_KEY=fixture-fallback');
    expect(readLocalImageKey({ credentialFile: path.join(root, 'missing.env'), appPath: root, enabled: true })).toBe('');
  }));

});
