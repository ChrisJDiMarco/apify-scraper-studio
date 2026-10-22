// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../src/shared/roles.json';

vi.mock('../src/renderer/src/App.jsx', () => ({ default: () => <p>Studio app</p> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = false; // main.jsx renders itself on import, outside act()

const TOKEN = 'ab'.repeat(32);
// Newer Node versions shadow jsdom's localStorage with an unconfigured one, so give the page a plain in-memory store.
const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => { stored.set(key, String(value)); }, removeItem: (key) => { stored.delete(key); }, clear: () => stored.clear() } });
// main.jsx reads the address and renders on import, so each test loads a fresh copy against its own fake server.
async function openPage(hash, answers, { head = '' } = {}) {
  vi.resetModules(); delete window.apifyStudio;
  document.head.innerHTML = head; document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', `/${hash}`);
  const order = []; const realReplace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => { order.push('clear address'); return realReplace(...args); });
  const fetch = vi.fn(async (url, init = {}) => {
    order.push(url); const queue = answers[url]; const [status, body, extra = {}] = (Array.isArray(queue[0]) ? queue.shift() : queue);
    return { status, ok: status >= 200 && status < 400, json: async () => body, init, ...extra };
  });
  vi.stubGlobal('fetch', fetch);
  await import('../src/web/main.jsx');
  return { order, fetch };
}
const SESSION = [200, { ok: true, user: '', signOut: true, viewer: { name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false } }];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); stored.clear(); });

describe('browser sign-in', () => {
  const ALEX_LINK = [200, { name: 'Alex Kim', email: 'a•••@semrush.com', signedInAs: null }];
  it('clears a sign-in link from the address bar, asks whose it is, and uses it only when they say so', async () => {
    const { order, fetch } = await openPage(`#signin=${TOKEN}`, { '/api/login/link': ALEX_LINK, '/api/login': [200, { ok: true }], '/api/session': SESSION });
    expect(await screen.findByRole('heading', { name: 'Sign in as Alex Kim?' })).toBeInTheDocument();
    expect(screen.getByText(/It works once and then stops working/)).toHaveTextContent('Alex Kim’s (a•••@semrush.com)');
    expect(order).toEqual(['clear address', '/api/login/link']); // nothing used yet
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Alex' }));
    expect(await screen.findByText('Studio app')).toBeInTheDocument();
    expect(order.slice(0, 4)).toEqual(['clear address', '/api/login/link', '/api/login', '/api/session']);
    expect(window.location.hash).toBe('');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ linkToken: TOKEN });
    expect(window.localStorage.getItem('studio.signin')).toBe('link');
  });

  it('keeps an admin who opens someone else’s link signed in as themselves unless they choose otherwise', async () => {
    const { order } = await openPage(`#signin=${TOKEN}`, { '/api/login/link': [200, { name: 'Leigh Park', email: 'l•••@searchengineland.com', signedInAs: { name: 'John Blanchard', same: false } }], '/api/session': SESSION });
    expect(await screen.findByRole('heading', { name: 'This link is for Leigh Park' })).toBeInTheDocument();
    expect(screen.getByText(/You’re signed in as John Blanchard on this browser/)).toHaveTextContent('use View as in People instead');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Stay signed in as John Blanchard', 'Sign out and continue as Leigh']);
    fireEvent.click(buttons[0]);
    expect(await screen.findByText('Studio app')).toBeInTheDocument();
    expect(order).not.toContain('/api/login'); // Leigh's link is still unused, and John is still John
  });

  it('goes straight in when the link is for whoever is already signed in, without using it', async () => {
    const { order } = await openPage(`#signin=${TOKEN}`, { '/api/login/link': [200, { name: 'Alex Kim', email: 'a•••@semrush.com', signedInAs: { name: 'Alex Kim', same: true } }], '/api/session': SESSION });
    expect(await screen.findByText('Studio app')).toBeInTheDocument();
    expect(order).not.toContain('/api/login');
  });

  it('shows a link that no longer works on its own screen, with the way to the sign-in page', async () => {
    await openPage(`#signin=${TOKEN}`, { '/api/login/link': [401, { error: roles.copy.linkInvalid, signIn: 'link-invalid' }], '/api/session': [401, { error: 'Sign in to this studio.', signIn: 'password', methods: { password: true, google: true, email: false } }] });
    expect(await screen.findByRole('alert')).toHaveTextContent(roles.copy.linkInvalid);
    expect(screen.queryByLabelText('Admin password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to sign-in' }));
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google/start');
  });

  it('keeps the link in memory to try again when the server is busy', async () => {
    const { fetch } = await openPage(`#signin=${TOKEN}`, { '/api/login/link': [[429, { error: 'Too many requests. Try again in a minute.' }], ALEX_LINK], '/api/login': [200, { ok: true }], '/api/session': SESSION });
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again in a minute.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Alex' }));
    expect(await screen.findByText('Studio app')).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ linkToken: TOKEN });
  });

  it('leads with Sign in with Google, offers an emailed link, and tucks the admin password away', async () => {
    const { fetch } = await openPage('', { '/api/session': [401, { error: 'Sign in to this studio.', signIn: 'password', methods: { password: true, google: true, email: true } }], '/api/login/email': [200, { ok: true, message: 'If that address belongs to someone in this studio, a sign-in link is on its way. It works once, for 20 minutes.' }] });
    expect(await screen.findByText('Sign in with the Google account your invite was sent to.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google/start');
    expect(screen.getByText('Admin password', { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
    fireEvent.change(screen.getByLabelText('No Google account? Get a link by email'), { target: { value: 'leigh@searchengineland.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('a sign-in link is on its way');
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ email: 'leigh@searchengineland.com' });
  });

  it('says why Google didn’t sign someone in', async () => {
    await openPage('#signin-error=not-invited', { '/api/session': [401, { error: 'Sign in to this studio.', signIn: 'password', methods: { password: true, google: true, email: false } }] });
    expect(await screen.findByRole('alert')).toHaveTextContent('That Google account isn’t in this studio.');
    expect(window.location.hash).toBe('');
  });

  it('with only links and the password, points people to their admin and keeps the password form open', async () => {
    window.localStorage.setItem('studio.signin', 'link');
    await openPage('', { '/api/session': [401, { error: 'Sign in to this studio.', signIn: 'password', methods: { password: true, google: false, email: false } }] });
    expect(await screen.findByText('Open the sign-in link your admin sent you. It signs you in on this browser.')).toBeInTheDocument();
    expect(screen.getByText('Signed out? Ask an admin for a new sign-in link: each one works once.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admins' })).toBeInTheDocument();
    expect(screen.getByLabelText('Admin password')).toHaveAttribute('type', 'password');
    expect(screen.queryByText(/team password/i)).toBeNull();
  });

  it('offers no sign out under company sign-in', async () => {
    await openPage('', { '/api/session': [200, { ok: true, user: 'pat@semrush.com', signOut: false, viewer: null }] });
    await screen.findByText('Studio app');
    await waitFor(() => expect(window.apifyStudio).toBeTruthy());
    expect(window.apifyStudio.signOut).toBeUndefined();
    expect(typeof window.apifyStudio.state).toBe('function');
  });

  // Behind company sign-in, an expired session is answered by the proxy: a redirect to the identity provider, its own
  // 401 with no studio body, or an HTML sign-in page. Each must show the "sign-in has expired" screen, not an error.
  const PROXY_SESSION = [200, { ok: true, user: 'pat@semrush.com', signOut: false, viewer: null }];
  const html = { headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) };
  for (const [label, answer] of [
    ['a redirect', [0, {}, { type: 'opaqueredirect', ok: false }]],
    ['a bare 401', [401, {}]],
    ['an HTML 403 sign-in page', [403, {}, html]],
  ]) {
    it(`shows the company sign-in has expired when the proxy answers with ${label}`, async () => {
      const { fetch } = await openPage('', { '/api/session': PROXY_SESSION, '/api/rpc': [answer] });
      await screen.findByText('Studio app');
      await expect(window.apifyStudio.state()).rejects.toThrow();
      expect(await screen.findByText(/Your company sign-in has expired/)).toBeInTheDocument();
      expect(fetch.mock.calls[1][1]).toMatchObject({ redirect: 'manual', headers: expect.objectContaining({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }) });
    });
  }

  it('says the studio didn’t answer instead of “Failed to fetch”', async () => {
    await openPage('', { '/api/session': SESSION });
    await screen.findByText('Studio app');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(window.apifyStudio.state()).rejects.toThrow('The studio didn’t answer. Check your connection, then try again.');
  });

  it('offers a reload once the server runs a newer build than this tab', async () => {
    const head = '<script type="module" crossorigin src="/assets/index-OLD.js"></script><link rel="stylesheet" href="/assets/index-OLD.css">';
    await openPage('', { '/api/session': [200, SESSION[1], { headers: new Headers({ 'content-type': 'application/json', 'x-studio-build': 'index-NEW.js index-NEW.css' }) }] }, { head });
    await screen.findByText('Studio app');
    expect(await screen.findByText('A new version of the studio is ready. Reload to use it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByText(/new version of the studio/)).toBeNull());
  });

  it('shows when live updates are paused, and clears it when they’re back', async () => {
    await openPage('', { '/api/session': SESSION });
    await screen.findByText('Studio app');
    window.dispatchEvent(new CustomEvent('studio-live', { detail: { live: false, reason: 'restarting' } }));
    expect(await screen.findByText('The studio is restarting for an update. This page reconnects on its own.')).toBeInTheDocument();
    window.dispatchEvent(new CustomEvent('studio-live', { detail: { live: true } }));
    await waitFor(() => expect(screen.queryByText(/restarting for an update/)).toBeNull());
  });
});
