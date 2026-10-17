import { describe, expect, it } from 'vitest';
import { LINK_KINDS, deepLinkTarget, linkFor, normalizeOrigin, parseHash, restoreDeepLink, shareOrigin, stashDeepLink, takeStashedDeepLink } from '../src/renderer/src/deep-links.js';

// A Map-backed stand-in for localStorage.
const memory = () => { const map = new Map(); return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map }; };

describe('share links', () => {
  it('reads the four kinds of link and nothing else', () => {
    expect(LINK_KINDS).toEqual(['report', 'trend', 'assets', 'prompt']);
    expect(parseHash('#/report/asset-1')).toEqual({ kind: 'report', id: 'asset-1' });
    expect(parseHash('#/trend/theme-aio')).toEqual({ kind: 'trend', id: 'theme-aio' });
    expect(parseHash('#/assets/theme%3Atheme-aio')).toEqual({ kind: 'assets', id: 'theme:theme-aio' });
    expect(parseHash('#/prompt/trends-report/')).toEqual({ kind: 'prompt', id: 'trends-report' });
    for (const hash of ['', '#', '#signin=abc', '#/report/', '#/report/../etc', '#/report/a%2Fb', '#/report/a b', '#/report/%E0%A4%A', '#/settings/x', '#/report/<script>', 'report/asset-1']) expect(parseHash(hash)).toBeNull();
  });

  it('turns a link into the place it opens', () => {
    expect(deepLinkTarget({ kind: 'report', id: 'asset-1' })).toEqual({ kind: 'report', id: 'asset-1', page: 'reports' });
    expect(deepLinkTarget({ kind: 'trend', id: 'theme-1' })).toEqual({ kind: 'trend', id: 'theme-1', page: 'trends' });
    expect(deepLinkTarget({ kind: 'assets', id: 'theme:theme-1' })).toEqual({ kind: 'folder', id: 'theme:theme-1', page: 'assets' });
    expect(deepLinkTarget({ kind: 'prompt', id: 'trends-report' })).toEqual({ kind: 'prompt', id: 'trends-report', page: 'prompts' });
    expect(deepLinkTarget(null)).toBeNull();
  });

  it('builds links only on a plain web address', () => {
    expect(linkFor('report', 'asset-1', { origin: 'https://studio.example.com' })).toBe('https://studio.example.com/#/report/asset-1');
    expect(linkFor('assets', 'theme:theme-aio', { origin: 'studio.example.com/team/' })).toBe('https://studio.example.com/team/#/assets/theme%3Atheme-aio');
    expect(linkFor('report', 'asset-1', { origin: '' })).toBe('');
    expect(linkFor('folder', 'asset-1', { origin: 'https://studio.example.com' })).toBe('');
    expect(linkFor('report', '../x', { origin: 'https://studio.example.com' })).toBe('');
    expect(normalizeOrigin('javascript:alert(1)')).toBe('');
    expect(normalizeOrigin('https://user:secret@studio.example.com')).toBe('');
    expect(normalizeOrigin('http://localhost:5173/index.html')).toBe('http://localhost:5173');
    expect(normalizeOrigin('https://studio.example.com/?q=1#x')).toBe('https://studio.example.com');
    // Round trip: a link opens what it names.
    expect(parseHash(new URL(linkFor('assets', 'theme:theme-aio', { origin: 'https://studio.example.com' })).hash)).toEqual({ kind: 'assets', id: 'theme:theme-aio' });
  });

  it('uses the page’s own address on the web and the saved Studio web address on the Mac', () => {
    expect(shareOrigin({ web: true, location: { origin: 'https://studio.example.com' } })).toBe('https://studio.example.com');
    expect(shareOrigin({ web: false, settings: { studioWebAddress: 'https://studio.example.com/' } })).toBe('https://studio.example.com');
    expect(shareOrigin({ web: false, settings: {} })).toBe('');
  });

  it('keeps a link opened while signed out for 30 minutes, once', () => {
    const storage = memory();
    expect(stashDeepLink('#signin=abc', storage, 1000)).toBeNull();
    expect(stashDeepLink('#/trend/theme-1', storage, 1000)).toEqual({ kind: 'trend', id: 'theme-1' });
    expect(takeStashedDeepLink(storage, 1000 + 29 * 60000)).toEqual({ kind: 'trend', id: 'theme-1' });
    expect(takeStashedDeepLink(storage, 1000 + 29 * 60000)).toBeNull();
    stashDeepLink('#/trend/theme-1', storage, 1000);
    expect(takeStashedDeepLink(storage, 1000 + 31 * 60000)).toBeNull();
    storage.setItem('studio.deeplink', '{"kind":"report","id":"../x","at":1000}');
    expect(takeStashedDeepLink(storage, 2000)).toBeNull();
    storage.setItem('studio.deeplink', 'not json');
    expect(takeStashedDeepLink(storage, 2000)).toBeNull();
  });

  it('puts a kept link back in the address bar after sign-in, unless the address already has one', () => {
    const storage = memory(); const calls = [];
    const win = (hash) => ({ location: { hash, pathname: '/', search: '' }, localStorage: storage, history: { replaceState: (_, __, url) => calls.push(url) } });
    stashDeepLink('#/report/asset-1', storage, Date.now());
    expect(restoreDeepLink(win(''))).toEqual({ kind: 'report', id: 'asset-1' });
    expect(calls).toEqual(['/#/report/asset-1']);
    stashDeepLink('#/report/asset-1', storage, Date.now());
    expect(restoreDeepLink(win('#/trend/theme-2'))).toBeNull();
    expect(storage.map.size).toBe(0);
  });
});
