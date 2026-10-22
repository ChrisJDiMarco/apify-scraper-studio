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
// Google sign-in comes back to /#signin-error=<code> when it didn't sign anyone in (studio-server.js googleCallback).
function takeSignInError() {
  const match = (window.location.hash || '').match(/^#signin-error=([a-z-]{1,24})$/);
  if (!match) return '';
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return match[1];
}
const signInError = takeSignInError();
const SIGN_IN_ERRORS = {
  'not-invited': 'That Google account isn’t in this studio. Use the Google account for the email your invite went to, or ask an admin to add you.',
  paused: 'Your access to this studio is paused. Ask an admin if you need it back.',
  domain: 'Use your work Google account.',
  unverified: 'Google hasn’t verified that account’s email address, so it can’t sign in here.',
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long. Try again.',
  busy: 'The studio has reached its sign-in limit. Ask an admin to restart it.',
  'google-off': 'Google sign-in isn’t set up for this studio. Use one of the options below.',
  failed: 'Google sign-in didn’t work. Try again.',
};
// A share link (#/report/…, #/trend/…, #/assets/…, #/prompt/…) opened while signed out is kept for this browser, so it
// still opens after the sign-in link (often in a new tab). App resolves it once the studio has loaded (useDeepLink).
stashDeepLink();
// Remembers how this browser signs in, so the signed-out screen can point back to the link. A convenience only.
const LINK_HINT = 'studio.signin';
function remember(value) { try { if (value) window.localStorage.setItem(LINK_HINT, value); else window.localStorage.removeItem(LINK_HINT); } catch (_) { /* storage blocked */ } }
function usedLink() { try { return window.localStorage.getItem(LINK_HINT) === 'link'; } catch (_) { return false; } }

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>;
}

// The signed-out screen. methods says what this studio offers (from the server's 401): Google, an emailed one-time
// link, and the admin password, which stays below as the way in for admins when nothing else works.
function SignIn({ mode, methods: given, error: initialError = '', onSignedIn }) {
  const [methods, setMethods] = useState(given || null);
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(''); const [emailError, setEmailError] = useState(''); const [sending, setSending] = useState(false);
  useEffect(() => {
    if (methods || mode === 'proxy') return;
    request('/api/session').then(onSignedIn, (failure) => setMethods(failure?.methods || { password: true }));
  }, []);
  if (mode === 'proxy') return <main className="web-login"><section><h1>Golden Thread</h1><p>Your company sign-in has expired. Reload the page to sign in again.</p><button type="button" onClick={() => window.location.reload()}>Reload</button></section></main>;
  if (!methods) return <main className="web-loading">Opening your studio…</main>;
  const others = methods.google || methods.email;
  const lead = methods.google ? 'Sign in with the Google account your invite was sent to.' : methods.email ? 'Enter your work email and we’ll send you a link that signs you in.' : 'Open the sign-in link your admin sent you. It signs you in on this browser.';
  const adminForm = <form className="web-login-admin" aria-labelledby="web-login-admins" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await postJson('/api/login', { password }); setPassword(''); remember(''); onSignedIn(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }}>
    {!others && <h2 id="web-login-admins">Admins</h2>}
    <label htmlFor="web-password">Admin password</label>
    <input id="web-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
    {error && <p className="web-login-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Open studio'}</button>
  </form>;
  return <main className="web-login"><section aria-labelledby="web-login-title">
    <h1 id="web-login-title">Golden Thread</h1>
    <p className="web-login-lead">{lead}</p>
    {initialError && <p className="web-login-error" role="alert">{SIGN_IN_ERRORS[initialError] || SIGN_IN_ERRORS.failed}</p>}
    {methods.google && <a className="web-login-google" href="/api/auth/google/start"><GoogleMark />Sign in with Google</a>}
    {methods.google && methods.email && <p className="web-login-or"><span>or</span></p>}
    {methods.email && (sent ? <p className="web-login-hint" role="status">{sent}</p> : <form className="web-login-email" onSubmit={async (event) => {
      event.preventDefault(); setSending(true); setEmailError('');
      try { const answer = await postJson('/api/login/email', { email }); setSent(answer?.message || 'Check your inbox for a sign-in link.'); } catch (failure) { setEmailError(failure.message); } finally { setSending(false); }
    }}>
      <label htmlFor="web-email">{methods.google ? 'No Google account? Get a link by email' : 'Work email'}</label>
      <input id="web-email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      {emailError && <p className="web-login-error" role="alert">{emailError}</p>}
      <button type="submit" className={methods.google ? 'web-login-secondary' : ''} disabled={sending || !email.trim()}>{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
    </form>)}
    {!others && usedLink() && <p className="web-login-hint">Signed out? Ask an admin for a new sign-in link: each one works once.</p>}
    {methods.password !== false && (others ? <details className="web-login-more"><summary>Admin password</summary>{adminForm}</details> : adminForm)}
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

// A link that was used, replaced, turned off or has expired gets its own screen, with the way to the sign-in page.
function LinkInvalid({ message, onRetry, onSignIn }) {
  return <main className="web-login"><section aria-labelledby="web-link-title">
    <h1 id="web-link-title">Golden Thread</h1>
    <p role="alert">{message}</p>
    {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : onSignIn && <button type="button" onClick={onSignIn}>Go to sign-in</button>}
  </section></main>;
}

// Before a one-time link is used: whose it is, and who this browser is signed in as now. Using someone else's link (an
// admin checking an invite) is never silent, and staying as yourself is the first choice.
function LinkConfirm({ link, onUse, onStay }) {
  const first = (link.name || '').split(/\s+/)[0] || 'them';
  const now = link.signedInAs;
  return <main className="web-login"><section aria-labelledby="web-link-title">
    <h1 id="web-link-title">{now ? `This link is for ${link.name || 'someone else'}` : `Sign in as ${link.name || 'this person'}?`}</h1>
    <p className="web-login-lead">This sign-in link is {link.name ? `${link.name}’s` : 'someone’s'}{link.email ? ` (${link.email})` : ''}. It works once and then stops working.</p>
    {now && <p className="web-login-hint">You’re signed in as {now.name} on this browser. Using the link would sign you out and sign you in as {first}. If you’re checking an invite, use View as in People instead.</p>}
    {now ? <>
      <button type="button" onClick={onStay}>Stay signed in as {now.name}</button>
      <button type="button" className="web-login-secondary" onClick={onUse}>Sign out and continue as {first}</button>
    </> : <>
      <button type="button" onClick={onUse}>Continue as {first}</button>
      <p>Not {first}? Close this page; the link stays unused.</p>
    </>}
  </section></main>;
}

function WebStudio() {
  const [status, setStatus] = useState(linkToken ? { phase: 'link-check' } : { phase: 'checking', mode: 'password' });
  async function check() {
    try {
      const session = await request('/api/session'); const api = window.apifyStudio = window.apifyStudio || createWebApi();
      if (session.signOut === false) delete api.signOut; // company sign-in owns the session: nothing to sign out of here
      setProxySignIn(session.signOut === false); // an expired company sign-in is then answered by the proxy, not the studio
      restoreDeepLink(); // the share link this browser opened before signing in, back in the address bar for App
      setStatus({ phase: 'ready' });
    }
    catch (failure) { setStatus(failure instanceof SignedOut ? { phase: 'signed-out', mode: failure.mode || 'password', methods: failure.methods || null } : { phase: 'error', message: failure.message }); }
  }
  // Asks whose link it is before using it. A link for the person already signed in here isn't used up: they're in.
  async function checkLink(token) {
    try {
      const link = await postJson('/api/login/link', { linkToken: token });
      if (link?.signedInAs?.same) return check();
      return setStatus({ phase: 'link-confirm', link, token });
    } catch (failure) {
      if (failure.status === 400) return check(); // company sign-in: links aren't used
      return setStatus({ phase: 'link-invalid', message: failure.status ? failure.message : 'The studio didn’t answer. Check your connection, then try again.', retry: failure instanceof SignedOut ? null : token, check: true });
    }
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
    if (linkToken) checkLink(linkToken); else check();
    const signedOut = (event) => setStatus((current) => (current.phase === 'ready' ? { phase: 'signed-out', mode: event.detail || 'password' } : current));
    window.addEventListener('studio-signed-out', signedOut);
    return () => window.removeEventListener('studio-signed-out', signedOut);
  }, []);
  if (status.phase === 'checking' || status.phase === 'linking' || status.phase === 'link-check') return <main className="web-loading">{status.phase === 'linking' ? 'Signing you in…' : 'Opening your studio…'}</main>;
  if (status.phase === 'link-confirm') return <LinkConfirm link={status.link} onUse={() => signInWithLink(status.token)} onStay={check} />;
  if (status.phase === 'link-invalid') return <LinkInvalid message={status.message} onRetry={status.retry ? () => (status.check ? checkLink(status.retry) : signInWithLink(status.retry)) : null} onSignIn={check} />;
  if (status.phase === 'error') return <main className="web-loading" role="alert">{status.message} <button type="button" onClick={check}>Try again</button></main>;
  if (status.phase === 'signed-out') return <SignIn mode={status.mode} methods={status.methods} error={signInError} onSignedIn={check} />;
  // The in-app confirmation sits above App, which asks through it, and draws inside the studio frame for its tokens.
  return <><ConfirmProvider container={() => document.querySelector('.app-shell')}><App /></ConfirmProvider><WebNotice /></>;
}

createRoot(document.getElementById('root')).render(<WebStudio />);
