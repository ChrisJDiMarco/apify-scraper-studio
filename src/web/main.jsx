import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../renderer/src/App.jsx';
import { createWebApi, postJson, request, SignedOut } from './web-api.js';
import '../renderer/src/styles.css';
import '../renderer/src/workflow.css';
import '../renderer/src/premium.css';
import '../renderer/src/semrush-shell.css';
import '../renderer/src/semrush-tools.css';
import '../renderer/src/craft.css';
import './web.css';

function SignIn({ mode, onSignedIn }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (mode === 'proxy') return <main className="web-login"><section><h1>Scraper Studio</h1><p>Your company sign-in has expired. Reload the page to sign in again.</p><button type="button" onClick={() => window.location.reload()}>Reload</button></section></main>;
  return <main className="web-login"><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await postJson('/api/login', { password }); setPassword(''); onSignedIn(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }}><h1>Scraper Studio</h1><p>Research and content studio. Sign in with the team password.</p>
    <label htmlFor="web-password">Password</label>
    <input id="web-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
    {error && <p className="web-login-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Open studio'}</button>
  </form></main>;
}

function WebStudio() {
  const [status, setStatus] = useState({ phase: 'checking', mode: 'password' });
  async function check() {
    try { await request('/api/session'); window.apifyStudio = window.apifyStudio || createWebApi(); setStatus({ phase: 'ready' }); }
    catch (failure) { setStatus(failure instanceof SignedOut ? { phase: 'signed-out', mode: failure.mode || 'password' } : { phase: 'error', message: failure.message }); }
  }
  useEffect(() => {
    check();
    const signedOut = (event) => setStatus((current) => (current.phase === 'ready' ? { phase: 'signed-out', mode: event.detail || 'password' } : current));
    window.addEventListener('studio-signed-out', signedOut);
    return () => window.removeEventListener('studio-signed-out', signedOut);
  }, []);
  if (status.phase === 'checking') return <main className="web-loading">Opening your studio…</main>;
  if (status.phase === 'error') return <main className="web-loading" role="alert">{status.message} <button type="button" onClick={check}>Try again</button></main>;
  if (status.phase === 'signed-out') return <SignIn mode={status.mode} onSignedIn={check} />;
  return <App />;
}

createRoot(document.getElementById('root')).render(<WebStudio />);
