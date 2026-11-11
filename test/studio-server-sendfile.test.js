import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

// The browser studio streams downloads and its own files. A file that disappears between the check and the read must
// end that one response, never raise an unhandled stream error (which would stop the server for everyone).
const require = createRequire(import.meta.url);
const source = fs.readFileSync(require.resolve('../src/main/studio-server.js'), 'utf8');

describe('studio-server file streaming', () => {
  it('never pipes a read stream into a response without handling its errors', () => {
    expect(source).not.toMatch(/createReadStream\([^)]*\)\.pipe\(/);
    expect(source.match(/sendFile\(/g).length).toBeGreaterThanOrEqual(3); // its definition and both callers
  });
  it('destroys the response, without throwing, when the file is gone', async () => {
    const body = source.match(/function sendFile\(file, res\) \{.*\}\n/)[0];
    const sendFile = new Function('require', 'fs', `${body}; return sendFile;`)(require, fs);
    const res = new PassThrough(); res.on('error', () => {});
    const closed = new Promise((resolve) => res.on('close', resolve));
    sendFile(path.join(os.tmpdir(), `gone-${Date.now()}.bin`), res);
    await closed;
    expect(res.destroyed).toBe(true);
  });
  it('sends a file that is there', async () => {
    const body = source.match(/function sendFile\(file, res\) \{.*\}\n/)[0];
    const sendFile = new Function('require', 'fs', `${body}; return sendFile;`)(require, fs);
    const file = path.join(os.tmpdir(), `here-${Date.now()}.txt`); fs.writeFileSync(file, 'hello');
    const res = new PassThrough(); const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
    await new Promise((resolve) => { res.on('end', resolve); sendFile(file, res); });
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    fs.rmSync(file);
  });
});
