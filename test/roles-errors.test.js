import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import studio from './helpers/roles-studio.js';

// What editors and channel owners read when the AI route fails before anything starts: the real main process on the web
// runtime, on the Claude app route, with a scripted `claude` CLI (nothing runs, nothing is paid). The account is out of
// credit, so the model check fails with the provider's own words, which name the model, the billing state and an
// admin-only program setting. Only an admin may read that; everyone else is told who to ask.
const mainPath = path.resolve('src/main/index.js');
const mainRequire = createRequire(mainPath);
const { requiredClaudeFlags } = mainRequire('../shared/claude-runner');
const { MEMBERS, identity, seedStudio } = studio;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CREDIT = 'Credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

function scriptedCli(answer) {
  const calls = [];
  function spawn(command, args = [], options = {}) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    calls.push({ command, args });
    const reply = answer.current(command, args) || { code: 1, stderr: 'Fixture CLI: no AI in tests.' };
    queueMicrotask(() => { if (reply.stdout) child.stdout.write(reply.stdout); if (reply.stderr) child.stderr.write(reply.stderr); child.emit('close', reply.code ?? 0, null); });
    return child;
  }
  return { spawn, calls };
}
const outOfCredit = (command, args) => {
  if (command !== 'claude') return null;
  if (args[0] === '--version') return { stdout: '2.9.0 (Claude Code)\n' };
  if (args[0] === '--help') return { stdout: `${requiredClaudeFlags().join('\n')}\n` };
  if (args[0] === 'auth') return { stdout: JSON.stringify({ loggedIn: true }) };
  return { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: CREDIT, total_cost_usd: 0 }) };
};
const overloaded = (command) => (command === 'claude' ? { code: 1, stderr: 'Error: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}} request_id=req_011CU' } : null);

describe('provider errors on the browser studio', () => {
  let runtime; let root; const answer = { current: outOfCredit }; let cli;
  const as = (member) => (channel, payload) => runtime.invoke(channel, payload, { user: identity(member), session: { expires: Date.now() + 3600000, kind: 'link', memberId: member.id, linkId: 'fixture', viewAs: null }, origin: 'https://studio.example.com' }).then((outcome) => outcome.result);
  const refusal = async (promise) => { try { await promise; } catch (error) { return { status: error.status, code: error.code, message: error.message }; } throw new Error('Expected a refusal.'); };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-errors-')); const dataDir = path.join(root, 'data');
    seedStudio(dataDir, { settings: { aiProvider: 'claude' } });
    process.env.SHELL = '/bin/sh';
    runtime = mainRequire('./web-runtime');
    runtime.configure({ dataDir, secretKey: 'roles-errors-test-secret-0123456789abcdef' });
    cli = scriptedCli(answer);
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
      require: (name) => (name === 'child_process' ? { spawn: cli.spawn } : mainRequire(name)),
      process: { pid: process.pid, platform: process.platform, env: { STUDIO_RUNTIME: 'web', STUDIO_PASSWORD: 'roles-errors-admin-password' }, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
      fetch: () => { throw new Error('Network access is forbidden in this test.'); },
    }, { filename: mainPath });
    await sleep(50);
  });
  afterAll(() => { runtime?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });

  it('tells editors and channel owners who to ask, never the model, credit or billing, and keeps the admin’s own words', async () => {
    answer.current = outOfCredit;
    const alex = await refusal(as(MEMBERS.alex)('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } }));
    const riley = await refusal(as(MEMBERS.riley)('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort'] }));
    const research = await refusal(as(MEMBERS.riley)('studio:startResearchRun', { programId: 'program-pulse' }));
    for (const seen of [alex, riley, research]) {
      expect(seen).toMatchObject({ code: 'askConnection', message: 'The studio’s AI or data connection needs attention. Ask Chris.' });
      expect(seen.message).not.toMatch(/claude|credit|billing|model/i);
    }
    expect(cli.calls.some((call) => call.command === 'claude')).toBe(true); // the preflight really ran, on the scripted CLI
    const chris = await refusal(as(MEMBERS.chris)('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort'] }));
    expect(chris.message).toMatch(/Credit balance is too low/);
  });

  it('turns a raw CLI failure into the same plain line', async () => {
    answer.current = overloaded;
    const alex = await refusal(as(MEMBERS.alex)('studio:createAssetKit', { source: { kind: 'report', assetId: 'asset-toolkit' } }));
    expect(alex).toMatchObject({ code: 'askConnection', message: 'The studio’s AI or data connection needs attention. Ask Chris.' });
    expect(alex.message).not.toMatch(/529|overloaded|request_id/);
  });
});
