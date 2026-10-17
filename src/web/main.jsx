import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import App from '../renderer/src/App.jsx';
import { ConfirmProvider } from '../renderer/src/confirm-dialog.jsx';
import { restoreDeepLink, stashDeepLink } from '../renderer/src/deep-links.js';
import { createWebApi, postJson, request, setProxySignIn, SignedOut } from './web-api.js';
import '../renderer/src/styles.css';
import '../renderer/src/workflow.css';
import '../renderer/src/premium.css';
import '../renderer/src/semrush-shell.css';
import '../renderer/src/semrush-tools.css';
import '../renderer/src/craft.css';
import './web.css';

// A personal sign-in link opens the studio at /#signin=<token>. The fragment never reaches the server or its logs, and
// the token leaves the address bar (and history) before anything else runs, so it isn't left on screen or bookmarked.
function takeLinkToken() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#signin=')) return '';
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const raw = hash.slice('#signin='.length).trim();
  return (raw.match(/^[a-f0-9]{64}/i)?.[0] || raw.slice(0, 200)).toLowerCase(); // mail apps sometimes append punctuation
}
const linkToken = takeLinkToken();
// A share link (#/report/…, #/trend/…, #/assets/…, #/prompt/…) opened while signed out is kept for this browser, so it
// still opens after the sign-in link (often in a new tab). App resolves it once the studio has loaded (useDeepLink).
stashDeepLink();
// Remembers how this browser signs in, so the signed-out screen can point back to the link. A convenience only.
const LINK_HINT = 'studio.signin';
function remember(value) { try { if (value) window.localStorage.setItem(LINK_HINT, value); else window.localStorage.removeItem(LINK_HINT); } catch (_) { /* storage blocked */ } }
function usedLink() { try { return window.localStorage.getItem(LINK_HINT) === 'link'; } catch (_) { return false; } }

function SignIn({ mode, onSignedIn }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (mode === 'proxy') return <main className="web-login"><section><h1>Scraper Studio</h1><p>Your company sign-in has expired. Reload the page to sign in again.</p><button type="button" onClick={() => window.location.reload()}>Reload</button></section></main>;
  return <main className="web-login"><section aria-labelledby="web-login-title">
    <h1 id="web-login-title">Scraper Studio</h1>
    <p className="web-login-lead">Open the sign-in link your admin sent you. It signs you in on this browser.</p>
    {usedLink() && <p className="web-login-hint">Signed out? Open your sign-in link again.</p>}
    <form className="web-login-admin" aria-labelledby="web-login-admins" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try { await postJson('/api/login', { password }); setPassword(''); remember(''); onSignedIn(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    }}>
      <h2 id="web-login-admins">Admins</h2>
      <label htmlFor="web-password">Admin password</label>
      <input id="web-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p className="web-login-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Open studio'}</button>
    </form>
  </section></main>;
}

// One quiet notice over the studio, from web-api.js: a newer build after a deploy (reload to get it), or live updates
// paused while the server restarts or is at its tab limit. Drawn inside the studio frame for its tokens.
const NOTICE_COPY = {
  updated: 'A new version of the studio is ready. Reload to use it.',
  restarting: 'The studio is restarting for an update. This page reconnects on its own.',
  busy: 'Live updates are paused: the studio has too many open tabs. This page catches up every 30 seconds. Close tabs you aren’t using to get them back.',
};
function WebNotice() {
  const [updated, setUpdated] = useState(false); const [live, setLive] = useState(''); const [hidden, setHidden] = useState('');
  useEffect(() => {
    const onUpdated = () => setUpdated(true);
    const onLive = (event) => setLive(event.detail?.live ? '' : event.detail?.reason || '');
    window.addEventListener('studio-updated', onUpdated); window.addEventListener('studio-live', onLive);
    return () => { window.removeEventListener('studio-updated', onUpdated); window.removeEventListener('studio-live', onLive); };
  }, []);
  const kind = updated ? 'updated' : live;
  if (!kind || hidden === kind) return null;
  const host = document.querySelector('.studio-frame') || document.querySelector('.app-shell') || document.body;
  const button = { minHeight: 32, padding: '0 14px', borderRadius: 999, border: '1px solid var(--s-line-strong, #cfd6d0)', background: 'var(--s-card, #fff)', color: 'var(--s-ink, #181e15)', font: 'inherit', fontWeight: 600, cursor: 'pointer' };
  return createPortal(<div className="web-notice" role="status" aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 2147483000, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'min(640px, calc(100vw - 32px))', padding: '10px 12px 10px 16px', borderRadius: 'var(--s-radius-row, 16px)', border: '1px solid var(--s-line, #e3e8e4)', background: 'var(--s-card, #fff)', color: 'var(--s-ink, #181e15)', boxShadow: 'var(--s-shadow-pop, 0 30px 80px rgba(0,0,0,.28))', font: '14px/1.45 system-ui, sans-serif' }}>
    <span style={{ flex: 1 }}>{NOTICE_COPY[kind]}</span>
    {kind === 'updated' && <button type="button" style={{ ...button, background: 'var(--s-accent, #c190ff)', borderColor: 'transparent', color: 'var(--s-on-accent, #181e15)' }} onClick={() => window.location.reload()}>Reload</button>}
    {kind !== 'restarting' && <button type="button" style={button} onClick={() => setHidden(kind)}>{kind === 'updated' ? 'Later' : 'Close'}</button>}
  </div>, host);
}

// A link that was replaced, turned off or has expired gets its own screen: the person has no password to type.
function LinkInvalid({ message, onRetry }) {
  return <main className="web-login"><section aria-labelledby="web-link-title">
    <h1 id="web-link-title">Scraper Studio</h1>
    <p role="alert">{message}</p>
    {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
  </section></main>;
}

function WebStudio() {
  const [status, setStatus] = useState(linkToken ? { phase: 'linking' } : { phase: 'checking', mode: 'password' });
  async function check() {
    try {
      const session = await request('/api/session'); const api = window.apifyStudio = window.apifyStudio || createWebApi();
      if (session.signOut === false) delete api.signOut; // company sign-in owns the session: nothing to sign out of here
      setProxySignIn(session.signOut === false); // an expired company sign-in is then answered by the proxy, not the studio
      restoreDeepLink(); // the share link this browser opened before signing in, back in the address bar for App
      setStatus({ phase: 'ready' });
    }
    catch (failure) { setStatus(failure instanceof SignedOut ? { phase: 'signed-out', mode: failure.mode || 'password' } : { phase: 'error', message: failure.message }); }
  }
  async function signInWithLink(token) {
    setStatus({ phase: 'linking' });
    try { await postJson('/api/login', { linkToken: token }); remember('link'); }
    catch (failure) {
      // Behind company sign-in, links aren't used (400): the proxy already signed this person in.
      if (failure.status !== 400) {
        // A dead link can't be retried; a busy server or a dropped connection can, with the token kept in memory.
        return setStatus({ phase: 'link-invalid', message: failure.status ? failure.message : 'The studio didn’t answer. Check your connection, then try again.', retry: failure instanceof SignedOut ? null : token });
      }
    }
    return check();
  }
  useEffect(() => {
    if (linkToken) signInWithLink(linkToken); else check();
    const signedOut = (event) => setStatus((current) => (current.phase === 'ready' ? { phase: 'signed-out', mode: event.detail || 'password' } : current));
    window.addEventListener('studio-signed-out', signedOut);
    return () => window.removeEventListener('studio-signed-out', signedOut);
  }, []);
  if (status.phase === 'checking' || status.phase === 'linking') return <main className="web-loading">{status.phase === 'linking' ? 'Signing you in…' : 'Opening your studio…'}</main>;
  if (status.phase === 'link-invalid') return <LinkInvalid message={status.message} onRetry={status.retry ? () => signInWithLink(status.retry) : null} />;
  if (status.phase === 'error') return <main className="web-loading" role="alert">{status.message} <button type="button" onClick={check}>Try again</button></main>;
  if (status.phase === 'signed-out') return <SignIn mode={status.mode} onSignedIn={check} />;
  // The in-app confirmation sits above App, which asks through it, and draws inside the studio frame for its tokens.
  return <><ConfirmProvider container={() => document.querySelector('.app-shell')}><App /></ConfirmProvider><WebNotice /></>;
}

createRoot(document.getElementById('root')).render(<WebStudio />);
