import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const probe = require('../scripts/installed-app-continuity.cjs');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-continuity-probe-')); roots.push(root);
  const config = { keys: { APIFY_API_TOKEN: { encrypted: true, value: 'fixture-ciphertext-must-not-print' }, GOOGLE_SHEETS_WEBHOOK_URL: { encrypted: true, value: 'fixture-google-ciphertext' } }, imageCredentialFile: path.join(root, 'approved.env') };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ datasets: [{ id: 'private-dataset-id' }] }));
  fs.mkdirSync(path.join(root, 'content-studio')); fs.writeFileSync(path.join(root, 'content-studio', 'state.json'), JSON.stringify({ contentRuns: [], researchRuns: [] }));
  return { root, config, snapshot: () => probe.profileSnapshot(root, config.imageCredentialFile) };
}
describe('installed app read-only continuity probe', () => {
  it('requires explicit local app, pointer and clean launch attestation', () => {
    const args = ['--app', '/Applications/Scraper Studio.app', '--port', '9338', '--image-credential-file', '/private/approved.env'];
    expect(() => probe.optionsFromArgs(args)).toThrow('CLEAN_LAUNCH_ATTESTATION_REQUIRED');
    expect(probe.optionsFromArgs([...args, '--clean-launch-confirmed']).expectedDatasets).toBe(4);
    expect(() => probe.optionsFromArgs([...args, '--clean-launch-confirmed', '--profile', 'relative'])).toThrow('ABSOLUTE_PATHS_REQUIRED');
    expect(() => probe.optionsFromArgs([...args, '--clean-launch-confirmed', '--run-provider', 'yes'])).toThrow('INVALID_ARGUMENTS');
  });
  it('selects only the exact installed renderer and localhost debugging socket', () => {
    const app = '/Applications/Scraper Studio.app';
    const target = { type: 'page', url: pathToFileURL(path.join(app, 'Contents/Resources/app.asar/out/renderer/index.html')).href, webSocketDebuggerUrl: 'ws://127.0.0.1:9338/devtools/page/fixture' };
    expect(probe.selectTarget([target], app, 9338)).toBe(target.webSocketDebuggerUrl);
    expect(() => probe.selectTarget([{ ...target, webSocketDebuggerUrl: 'ws://remote.example:9338/devtools/page/fixture' }], app, 9338)).toThrow('NONLOCAL_DEBUG_ENDPOINT');
    expect(() => probe.selectTarget([target, target], app, 9338)).toThrow('INSTALLED_RENDERER_NOT_UNIQUE');
    expect(() => probe.selectTarget([{ ...target, url: 'http://localhost:5173' }], app, 9338)).toThrow('INSTALLED_RENDERER_NOT_UNIQUE');
  });
  it('reads index metadata without changing files or opening the credential file', () => {
    const h = fixture(); const before = fs.readFileSync(path.join(h.root, 'config.json'));
    const result = h.snapshot(); expect(result.encrypted.APIFY_API_TOKEN).toBe(true); expect(result.pointerMatches).toBe(true);
    expect(fs.existsSync(h.config.imageCredentialFile)).toBe(false);
    expect(fs.readFileSync(path.join(h.root, 'config.json'))).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('fixture-ciphertext');
  });
  it('rejects symlinked profile files', () => {
    const h = fixture(); fs.renameSync(path.join(h.root, 'config.json'), path.join(h.root, 'other.json'));
    fs.symlinkSync(path.join(h.root, 'other.json'), path.join(h.root, 'config.json'));
    expect(() => h.snapshot()).toThrow('PROFILE_FILE_UNAVAILABLE');
  });
  it('calls only the two read-only bridge methods and projects safe values', async () => {
    const h = fixture(); const calls = [];
    const runtime = await vm.runInNewContext(probe.readOnlyExpression({ profile: h.root, datasetIds: ['private-dataset-id'] }), { window: { apifyStudio: {
      appMeta: async () => { calls.push('appMeta'); return { name: 'Scraper Studio', dataRoot: h.root }; },
      state: async () => { calls.push('state'); return { datasets: [{ id: 'private-dataset-id', text: 'fixture-private-content' }], keys: { APIFY_API_TOKEN: true, GOOGLE_SHEETS_WEBHOOK_URL: true, OPENAI_API_KEY: true }, contentStudio: { workspaces: [{ id: 'general' }, { id: 'semrush' }] }, v5: { schedules: {} } }; },
      saveKey: () => { throw new Error('Mutation forbidden'); }, testImageProvider: () => { throw new Error('Provider forbidden'); },
    } } });
    expect(calls).toEqual(['appMeta', 'state']); expect(runtime.datasetsMatchProfile).toBe(true);
    const before = h.snapshot(); const metadata = { signatureValid: true, bundleIdentityMatches: true };
    const receipt = probe.receiptFor({ expectedDatasets: 1, cleanLaunchConfirmed: true }, before, before, metadata, { ...runtime, unexpectedSecret: 'fixture-injected-secret' });
    expect(receipt.passed).toBe(true); expect(receipt.probeProviderCalls).toBe(0);
    const serialized = JSON.stringify(receipt);
    for (const privateText of ['private-dataset-id', 'fixture-private-content', 'fixture-injected-secret', 'fixture-ciphertext', h.root]) expect(serialized).not.toContain(privateText);
  });
  it('fails continuity when a saved key is unavailable, data changes or jobs are active', () => {
    const h = fixture(); const before = h.snapshot();
    fs.writeFileSync(path.join(h.root, 'data.json'), JSON.stringify({ datasets: [] }));
    const receipt = probe.receiptFor({ expectedDatasets: 1, cleanLaunchConfirmed: true }, before, h.snapshot(), { signatureValid: true }, { datasetCount: 1, keys: { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }, noRunningJobs: false });
    expect(receipt.passed).toBe(false); expect(receipt.checks.encryptedCredentialsAvailable).toBe(false); expect(receipt.checks.profileUnchangedDuringProbe).toBe(false); expect(receipt.checks.noRunningJobs).toBe(false);
  });
  it.each([
    { label: 'no Google setup', configured: [], available: [], passes: true },
    { label: 'existing Sheets key missing', configured: ['GOOGLE_SHEETS_WEBHOOK_URL'], available: [], passes: false },
    { label: 'one of two existing Google keys missing', configured: ['GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN'], available: ['GOOGLE_SHEETS_WEBHOOK_URL'], passes: false },
    { label: 'both existing Google keys preserved', configured: ['GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN'], available: ['GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN'], passes: true },
  ])('preserves only configured Google credentials: $label', ({ configured, available, passes }) => {
    const h = fixture(); delete h.config.keys.GOOGLE_SHEETS_WEBHOOK_URL;
    for (const key of configured) h.config.keys[key] = { encrypted: true, value: 'fixture-encrypted-google' };
    fs.writeFileSync(path.join(h.root, 'config.json'), JSON.stringify(h.config));
    const before = h.snapshot(); const keys = { APIFY_API_TOKEN: true, OPENAI_API_KEY: true, GOOGLE_SHEETS_WEBHOOK_URL: false, GOOGLE_DOCS_ACCESS_TOKEN: false };
    for (const key of available) keys[key] = true;
    const runtime = { runtimeAppMatches: true, runtimeDataRootMatches: true, datasetsMatchProfile: true, generalWorkspacePresent: true, semrushWorkspacePresent: true, noRunningJobs: true, noEnabledSchedules: true, datasetCount: 1, keys };
    const receipt = probe.receiptFor({ expectedDatasets: 1, cleanLaunchConfirmed: true }, before, before, { signatureValid: true }, runtime);
    expect(receipt.passed).toBe(passes);
    expect(receipt.checks.googleCredentialsPreserved).toBe(passes);
    expect(receipt.checks.encryptedCredentialsAvailable).toBe(passes);
    for (const key of ['GOOGLE_SHEETS_WEBHOOK_URL', 'GOOGLE_DOCS_ACCESS_TOKEN']) {
      expect(receipt.credentialsAvailable[key]).toBe(available.includes(key));
      expect(receipt.encryptedEntriesPresent[key]).toBe(configured.includes(key));
    }
  });
  it('checks arm64 and Developer ID metadata without propagating tool output', () => {
    const exec = (name, args) => name.endsWith('plutil') ? { status: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.chrisdimarco.apifyscraperstudio' : 'Scraper Studio' } : name.endsWith('lipo') ? { status: 0, stdout: 'arm64' } : { status: 0, stderr: 'Authority=Developer ID Application: Fixture\nCodeDirectory flags=0x10000(runtime)\nTeamIdentifier=4X5MZ8MGH9\nprivate-output-not-returned' };
    const result = probe.installedMetadata('/Applications/Fixture.app', exec); expect(Object.values(result).every(Boolean)).toBe(true); expect(JSON.stringify(result)).not.toContain('Fixture');
  });
});
