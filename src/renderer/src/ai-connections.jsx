import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, ClipboardCopy, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import PROVIDERS from '../../shared/ai-providers.json';
import { Badge, Button } from './ui.jsx';
import { isMac } from './platform.js';
import './ai-settings.css';

// Settings → AI connections: how the studio reaches each AI vendor. Claude Code and Codex use the sign-in of the machine
// the studio runs on (on the browser studio, the server's); the four keys are saved encrypted and sent only to their
// vendor. Status and Test are free, except Claude Code's model check (one tiny request per model, a few cents).
const META = Object.fromEntries(PROVIDERS.connections.map((entry) => [entry.id, entry]));
const ORDER = ['claude', 'codex', 'claude-api', 'openai', 'openrouter', 'fal'];
const STATUS = {
  ready: ['ready', 'Ready'], 'sign-in': ['warning', 'Sign in'], 'not-installed': ['neutral', 'Not installed'], update: ['warning', 'Update needed'],
  'no-key': ['neutral', 'Add a key'], 'key-unreadable': ['danger', 'Key can’t be read'], checking: ['neutral', 'Checking…'],
};
const USES = { claude: 'Writing and research on your Claude plan', codex: 'Writing on your ChatGPT plan (not metered)', 'claude-api': 'Claude models, billed to the key', openai: 'GPT Image pictures and OpenAI models', openrouter: 'Any model through one key', fal: 'Pictures and short videos' };

function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard?.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (_) { setCopied(false); } }
  return <span className="ai-command"><Terminal size={13} aria-hidden="true" /><code>{command}</code><button type="button" className="ai-link" onClick={copy} aria-label={`Copy ${command}`}><ClipboardCopy size={13} aria-hidden="true" />{copied ? 'Copied' : 'Copy'}</button></span>;
}

function KeyField({ connection, saved, busy, onSaveKey, onClearKey }) {
  const meta = META[connection]; const [value, setValue] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function save() {
    if (!value.trim() || saving) return; setSaving(true); setError('');
    try { const done = await onSaveKey?.(meta.keyName, value.trim()); if (done) setValue(''); else setError('The key couldn’t be saved. Your entry is still here; try again.'); }
    catch (_) { setError('The key couldn’t be saved. Your entry is still here; try again.'); }
    finally { setSaving(false); }
  }
  return <div className="ai-key-row">
    <label className="ai-sr-only" htmlFor={`ai-key-${connection}`}>{meta.label}</label>
    <span className="ai-key-input"><KeyRound size={14} aria-hidden="true" /><input id={`ai-key-${connection}`} type="password" autoComplete="off" spellCheck="false" value={value} disabled={busy || saving} placeholder={saved ? 'Enter a replacement key' : meta.keyHint || 'Paste the key'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); }} /></span>
    <Button type="button" disabled={busy || saving || !value.trim()} onClick={save}>{saving ? 'Saving…' : 'Save key'}</Button>
    {saved && <Button type="button" className="ghost" disabled={busy || saving} onClick={() => onClearKey?.(meta.keyName)}>Clear</Button>}
    {error && <p className="error-line" role="alert">{error}</p>}
  </div>;
}

function TestResult({ result }) {
  if (!result) return null;
  const blocked = (result.models || []).filter((row) => !row.available);
  return <div className={`ai-test-result ${result.ok ? 'is-ok' : 'is-problem'}`} role="status">
    <strong>{result.ok ? result.detail || 'Works' : result.error || result.detail || 'Not ready yet.'}</strong>
    {blocked.length > 0 && <ul>{blocked.map((row) => <li key={row.id}><code>{row.id}</code> — {row.error}</li>)}</ul>}
  </div>;
}

export function AiConnections({ state = {}, meta = {}, api, busy, onSaveKey, onClearKey, onOpenRouting }) {
  const web = meta?.runtime === 'web';
  const [status, setStatus] = useState(null); const [loading, setLoading] = useState(false); const [problem, setProblem] = useState('');
  const [tests, setTests] = useState({}); const [testing, setTesting] = useState('');
  const [routing, setRouting] = useState(null); const [privacyState, setPrivacyState] = useState(''); const [privacyError, setPrivacyError] = useState('');
  const load = useCallback(async (fresh = false) => {
    if (typeof api?.getAiConnections !== 'function') return;
    setLoading(true); setProblem('');
    try { setStatus(await api.getAiConnections({ fresh })); } catch (error) { setProblem(error?.message || 'The connections couldn’t be checked.'); } finally { setLoading(false); }
  }, [api]);
  const keysSignature = JSON.stringify(state.keys || {});
  useEffect(() => { load(false); }, [load, keysSignature]);
  useEffect(() => {
    if (typeof api?.previewAiRouting !== 'function') return;
    let live = true; api.previewAiRouting({}).then((result) => { if (live) setRouting(result?.routing || null); }).catch(() => {});
    return () => { live = false; };
  }, [api]);
  async function test(connection) {
    if (testing || typeof api?.testAiConnection !== 'function') return;
    setTesting(connection);
    try { const result = await api.testAiConnection({ connection }); setTests((current) => ({ ...current, [connection]: result })); }
    catch (error) { setTests((current) => ({ ...current, [connection]: { ok: false, error: error?.message || 'The test didn’t finish.' } })); }
    finally { setTesting(''); load(true); }
  }
  async function savePrivacy(privacy) {
    if (!routing || typeof api?.saveAiRouting !== 'function') return;
    setPrivacyState('saving'); setPrivacyError('');
    try { const saved = await api.saveAiRouting({ routing: { ...routing, openrouter: { privacy } }, baseUpdatedAt: routing.updatedAt || '' }); setRouting(saved.routing); setPrivacyState('saved'); }
    catch (error) { setPrivacyError(error?.message || 'The setting couldn’t be saved.'); setPrivacyState(''); }
  }
  const rows = ORDER.map((id) => status?.connections?.find((row) => row.id === id) || { id, label: META[id].label, status: status ? 'no-key' : 'checking', detail: '', commands: [], usedBy: [] });
  const ready = rows.filter((row) => row.status === 'ready').length;
  return <section className="settings-block ai-connections" id="ai-connections" aria-labelledby="ai-connections-title" data-spot="settings.ai-connections">
    <div className="panel-head"><div><h3 id="ai-connections-title">AI connections</h3><p>How the studio reaches each AI vendor. {web ? 'Keys are stored on the studio server and never sent to browsers.' : isMac() ? 'Keys are stored in this Mac’s keychain.' : 'Keys are stored on this PC, encrypted with your Windows sign-in.'} Model routing decides which connection each job uses.</p></div>
      <div className="button-row"><Badge tone={ready ? 'ready' : 'warning'}>{status ? `${ready} of ${rows.length} ready` : 'Checking…'}</Badge><Button type="button" className="ghost" disabled={loading} onClick={() => load(true)}>{loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Check again</Button></div>
    </div>
    {problem && <p className="error-line" role="alert">{problem}</p>}
    <div className="ai-connection-grid">
      {rows.map((row) => {
        const info = META[row.id]; const [tone, word] = STATUS[row.status] || STATUS.checking; const cli = info.auth === 'subscription-cli';
        return <article className={`ai-connection-card is-${row.status}`} key={row.id} aria-labelledby={`ai-card-${row.id}`}>
          <header><div><h4 id={`ai-card-${row.id}`}>{info.label}</h4><small>{info.plan || USES[row.id]}</small></div><Badge tone={tone}>{word}</Badge></header>
          {row.detail && <p className="ai-connection-detail">{row.detail}</p>}
          {row.keyProblem && <p className="ai-connection-warning" role="alert"><CircleAlert size={14} aria-hidden="true" />{row.keyProblem === 'mismatch' ? 'This key was saved with a different STUDIO_SECRET_KEY. Start the studio with the original key, or clear it and save it again.' : 'This key can’t be read here. Clear it and save it again.'}</p>}
          {(row.commands || []).map((command) => <CopyCommand key={command.command} command={command.command} />)}
          {cli && web && row.serverNote && <p className="ai-connection-note">{row.serverNote}</p>}
          {!cli && <KeyField connection={row.id} saved={Boolean(row.keySaved || state.keys?.[info.keyName])} busy={busy} onSaveKey={onSaveKey} onClearKey={onClearKey} />}
          {row.id === 'openrouter' && <div className="ai-privacy">
            <label htmlFor="ai-openrouter-privacy">Which OpenRouter providers may see prompts</label>
            <select id="ai-openrouter-privacy" value={routing?.openrouter?.privacy || 'no-training'} disabled={!routing || privacyState === 'saving'} onChange={(event) => savePrivacy(event.target.value)}>
              {PROVIDERS.privacy.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            {privacyState === 'saved' && <small role="status">Saved. New requests use it.</small>}
            {privacyError && <small className="error-line" role="alert">{privacyError}</small>}
          </div>}
          <div className="ai-connection-actions">
            {row.id === 'claude'
              ? <><Button type="button" className="ghost" disabled={Boolean(testing) || row.status !== 'ready'} onClick={() => test('claude')}>{testing === 'claude' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}Check models</Button><small>Sends one tiny request per model through Claude Code, a few cents.</small></>
              : <><Button type="button" className="ghost" disabled={Boolean(testing) || (!cli && !row.keySaved && !state.keys?.[info.keyName])} onClick={() => test(row.id)}>{testing === row.id ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}Test</Button><small>Free: no paid request is sent.</small></>}
          </div>
          <TestResult result={tests[row.id]} />
          <footer className="ai-connection-footer">
            <span>{row.usedBy?.length ? `Used by ${row.usedBy.length} ${row.usedBy.length === 1 ? 'job' : 'jobs'}` : 'Not used by any job yet'}</span>
            {onOpenRouting && <button type="button" className="ai-link" onClick={onOpenRouting}>Open Model routing</button>}
          </footer>
        </article>;
      })}
    </div>
  </section>;
}
