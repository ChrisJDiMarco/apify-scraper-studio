import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import serverModule from '../src/main/studio-server.js';
const { createStudioServer } = serverModule;
const resources = [];
afterEach(async () => { for (const r of resources.splice(0)) { r.server.closeAllConnections?.(); await new Promise(resolve => r.server.close(resolve)); fs.rmSync(r.root, { recursive: true, force: true }); } });
async function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-server-test-')); const webRoot = path.join(root, 'public'); fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Fixture</title>'); fs.writeFileSync(path.join(webRoot, 'app.js'), 'window.fixture = true;'); fs.writeFileSync(path.join(root, 'private.txt'), 'PRIVATE FIXTURE OUTSIDE WEB ROOT');
  let activeWorkspaceId = 'general';
  const service = {
    recoverInterrupted: vi.fn(), publicState: () => ({ activeWorkspaceId, programs: [] }),
    contentCatalog: vi.fn(() => ({ deliverables: [] })),
    selectContentWorkspace: vi.fn(id => { activeWorkspaceId = id; return { activeWorkspaceId }; }),
    saveResearchProgram: vi.fn(payload => ({ id: 'saved', ...payload })),
    readStudioAsset: vi.fn(payload => ({ asset: { id: payload.assetId }, output: { title: 'Saved artifact' } })),
    openStudioAsset: vi.fn(() => { throw new Error('Never open the server filesystem in a browser RPC.'); }),
    exportStudioRun: vi.fn(() => { const exportPath = path.join(root, `export-${activeWorkspaceId}`); fs.mkdirSync(exportPath, { recursive: true }); fs.writeFileSync(path.join(exportPath, 'report.md'), `# ${activeWorkspaceId} fixture report`); return { id: `export-${activeWorkspaceId}`, workspaceId: activeWorkspaceId, path: exportPath, assetCount: 1, createdAt: '2026-09-27T12:00:00Z' }; }),
  };
  const { server } = createStudioServer({ root, webRoot, password: 'fixture-only-password-12345', service, host: {}, ...extra });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  resources.push({ server, root });
  async function request(route, { method = 'GET', body, cookie, origin = base, ...options } = {}) {
    return fetch(`${base}${route}`, { method, headers: { ...(method === 'POST' && origin !== false ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
  }
  async function login() { const response = await request('/api/login', { method: 'POST', body: { password: 'fixture-only-password-12345' } }); expect(response.status).toBe(200); return { cookie: response.headers.get('set-cookie').split(';')[0], response }; }
  return { root, webRoot, base, server, service, request, login };
}

describe('single-owner browser studio boundary', () => {
  it('requires a strong configured password and authenticates private API state with an HttpOnly session', async () => {
    expect(() => createStudioServer({ password: 'short' })).toThrow(/16 characters/);
    const h = await fixture({ secureCookies: true });
    expect((await h.request('/api/state')).status).toBe(401);
    expect((await h.request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status).toBe(401);
    const { cookie, response } = await h.login();
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
    const state = await h.request('/api/state', { cookie }); expect(state.status).toBe(200); expect((await state.json()).contentStudio.activeWorkspaceId).toBe('general');
    expect(state.headers.get('cache-control')).toBe('no-store'); expect(state.headers.get('x-frame-options')).toBe('DENY');
  });
  it('rejects missing or foreign origins before login and authenticated mutations', async () => {
    const h = await fixture();
    for (const origin of [false, 'https://foreign.example', 'file://local']) expect((await h.request('/api/login', { method: 'POST', origin, body: { password: 'fixture-only-password-12345' } })).status).not.toBe(200);
    const { cookie } = await h.login();
    for (const origin of [false, 'https://foreign.example']) expect((await h.request('/api/rpc', { method: 'POST', cookie, origin, body: { method: 'saveResearchProgram', payload: { name: 'Injected request' } } })).status).toBe(403);
    expect(h.service.saveResearchProgram).not.toHaveBeenCalled();
  });
  it('enforces the RPC allowlist and HTTP methods, and never calls desktop file-open from the web', async () => {
    const h = await fixture(); const { cookie } = await h.login();
    for (const method of ['constructor', '__proto__', 'recoverInterrupted', 'publicState', 'deleteWorkspace']) expect((await h.request('/api/rpc', { method: 'POST', cookie, body: { method } })).status).toBe(400);
    expect((await h.request('/api/rpc', { cookie })).status).toBe(404);
    expect((await h.request('/api/state', { method: 'DELETE', cookie })).status).toBe(404);
    const result = await h.request('/api/rpc', { method: 'POST', cookie, body: { method: 'openStudioAsset', payload: { assetId: 'asset-a' } } });
    expect(result.status).toBe(200); expect(h.service.readStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-a' }); expect(h.service.openStudioAsset).not.toHaveBeenCalled();
    expect(h.service.recoverInterrupted).toHaveBeenCalledOnce();
  });
  it('serves only webRoot files with CSP, no frame embedding, and an empty HEAD body', async () => {
    const h = await fixture();
    const page = await h.request('/'); expect(page.status).toBe(200); expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    const script = await h.request('/app.js'); expect(script.headers.get('content-type')).toContain('text/javascript');
    expect((await h.request('/private.txt')).status).toBe(404);
    expect((await h.request('/%2e%2e%2fprivate.txt')).status).toBe(404);
    expect((await h.request('/%2e%2e%2fpublic-other%2fprivate.txt')).status).toBe(404);
    const head = await h.request('/', { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
  });
  it('does not follow a symlink outside the public renderer directory', async () => {
    const h = await fixture(); fs.symlinkSync(path.join(h.root, 'private.txt'), path.join(h.webRoot, 'linked.txt'));
    const response = await h.request('/linked.txt'); expect(response.status).toBe(404); expect(await response.text()).not.toContain('PRIVATE FIXTURE');
  });
  it('limits password guessing and refuses malformed session cookies', async () => {
    const h = await fixture();
    for (let i = 0; i < 10; i++) expect((await h.request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status).toBe(401);
    expect((await h.request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status).toBe(429);
    expect((await h.request('/api/state', { cookie: 'studio_session=not-a-token' })).status).toBe(401);
    expect((await h.request('/api/state', { cookie: `studio_session=${'f'.repeat(64)}` })).status).toBe(401);
  });
  it('protects generated downloads and respects workspace ownership after switching', async () => {
    const h = await fixture(); const { cookie } = await h.login();
    const exported = await h.request('/api/rpc', { method: 'POST', cookie, body: { method: 'exportStudioRun', payload: { runId: 'run-a' } } });
    expect(exported.status).toBe(200); const result = await exported.json(); expect(result).not.toHaveProperty('path');
    expect((await h.request(result.downloadUrl)).status).toBe(401);
    expect((await h.request(result.downloadUrl, { cookie })).status).toBe(200);
    await h.request('/api/rpc', { method: 'POST', cookie, body: { method: 'selectContentWorkspace', payload: 'semrush' } });
    expect((await h.request(result.downloadUrl, { cookie })).status).toBe(404);
    expect((await h.request('/api/download/unknown', { cookie })).status).toBe(404);
  });
});
