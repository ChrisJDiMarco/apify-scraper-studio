import React, { useEffect, useState } from 'react';
import { CircleAlert, Copy, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { Badge, Button } from './ui.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { timeAgo } from './monday-ui.jsx';
import './drive-settings.css';

// Settings → Google Drive (HANDOFF.md → Google Drive folder sync). Rendered by settings-view.jsx in the section the left
// nav lists as `google-drive` (settings-sections.js), with the common section props ({ state, api, busy, web,
// savedHere, onSaveKey, onClearKey }). state.driveSync comes from src/main/drive-sync.js publicState(): { connected,
// mode: 'service-account' | 'token' | '', email, folder: { id, name, url, sharedDrive } | null, autoAdd,
// includeChannelAssets, rev, files, failed, waiting, lastSyncAt, lastError, backfill, lastBackfill, migratedPrograms }.
// Nothing here costs money: it copies reports the studio already wrote.
const fmt = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const plural = (count, word, many = `${word}s`) => `${fmt(count)} ${Number(count) === 1 ? word : many}`;
const KIND_LABEL = { added: 'Added', updated: 'Updated', failed: 'Failed' };
const KIND_TONE = { added: 'ready', updated: 'neutral', failed: 'danger' };

export function driveStatus(drive = {}) {
  if (!drive.connected) return ['neutral', 'Not connected'];
  if (!drive.folder) return ['warning', 'Choose a folder'];
  if (Number(drive.failed) > 0) return ['danger', 'Needs attention'];
  return drive.autoAdd ? ['ready', 'Syncing'] : ['neutral', 'Not syncing'];
}

export function DriveSettings({ state, api, busy = false, savedHere = 'Stored securely on this device', onSaveKey }) {
  const drive = state?.driveSync || {};
  const confirm = useConfirm();
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'problem', text }
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [token, setToken] = useState('');
  const [folderLink, setFolderLink] = useState('');
  const [changingFolder, setChangingFolder] = useState(!drive.folder);
  const [logOpen, setLogOpen] = useState(false);
  // The setup's revision: kept from each save's answer, so a second change made before the state push arrives isn't
  // refused as someone else's.
  const [rev, setRev] = useState(drive.rev);
  useEffect(() => { setRev(drive.rev); }, [drive.rev]);
  const keepRev = (result) => { if (result?.driveSync && result.driveSync.rev !== undefined) setRev(result.driveSync.rev); };
  useEffect(() => { if (!drive.folder) setChangingFolder(true); }, [drive.folder?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tone, badge] = driveStatus(drive);
  const disabled = busy || Boolean(working);
  const serviceAccount = drive.mode === 'service-account';
  const run = async (label, work, after) => {
    setWorking(label); setMessage(null);
    try { const result = await work(); after?.(result); return result; }
    catch (error) { setMessage({ tone: 'problem', text: error?.message || 'Google Drive didn’t answer. Try again.' }); return null; }
    finally { setWorking(''); }
  };
  const connect = () => run('connect', () => api.connectDriveSync({ serviceAccountKey: key }), (result) => { setKey(''); setReplacing(false); setMessage({ tone: 'ok', text: `Connected as ${result?.email || 'the service account'}. Share your Drive folder with this address as Editor, then paste the folder link below.` }); });
  const saveFolder = () => run('folder', () => api.saveDriveSync({ folder: folderLink, rev }), (result) => { keepRev(result); const saved = result?.driveSync?.folder; setFolderLink(''); setChangingFolder(false); setMessage({ tone: 'ok', text: `The studio can add files to “${saved?.name || 'the folder'}”.` }); });
  const toggle = (field, value) => run(field, () => api.saveDriveSync({ [field]: value, rev }), keepRev);
  const test = () => run('test', () => api.testDriveSync(), (result) => setMessage({ tone: 'ok', text: result?.message || 'Working.' }));
  const copyAll = () => run('copy', () => api.startDriveBackfill(), (result) => setMessage({ tone: 'ok', text: result?.joined ? 'Already copying. Progress shows below.' : result?.total ? `Copying ${plural(result.total, 'file')} to Drive. You can keep working; Cancel stops it.` : 'Nothing to copy yet: the studio has no reports in this workspace.' }));
  const cancelCopy = () => run('cancel', () => api.cancelJob(drive.backfill.jobId), () => setMessage({ tone: 'ok', text: 'Stopped. Files already copied stay in Drive.' }));
  async function disconnect() {
    const ok = await confirm({ title: 'Disconnect Google Drive?', lines: ['New reports stop going to Drive and the service account key is removed from the studio. Files already in Drive stay there.', 'Connect the same folder again later and the studio updates those files instead of copying them twice.'], confirmLabel: 'Disconnect', tone: 'danger' });
    if (ok) run('disconnect', () => api.disconnectDriveSync(), (result) => { keepRev(result); setChangingFolder(true); setMessage({ tone: 'ok', text: 'Disconnected. Files already in Drive stay there.' }); });
  }
  async function copyEmail() {
    try { await navigator.clipboard.writeText(drive.email); setMessage({ tone: 'ok', text: 'Address copied. Paste it into the folder’s Share box in Drive.' }); }
    catch (_) { setMessage({ tone: 'problem', text: `Couldn’t copy. The address is ${drive.email}.` }); }
  }

  return <section className="settings-block gd-settings" aria-labelledby="gd-settings-title" data-spot="settings.google-drive">
    <div className="panel-head"><div><h3 id="gd-settings-title">Google Drive</h3><p>Connect a Drive folder once, and every report the studio writes is added there as a Google Doc, in folders that match the Library. Editing a report updates the same Doc.</p></div><Badge tone={tone}>{badge}</Badge></div>
    {message && <p className={`gd-message ${message.tone === 'ok' ? 'is-ok' : 'is-problem'}`} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
    {drive.lastError && !message && Number(drive.failed) > 0 && <p className="gd-message is-problem" role="alert"><CircleAlert size={14} aria-hidden="true" />{drive.lastError}</p>}

    <div className="gd-step">
      <h4><span className="gd-step-number" aria-hidden="true">1</span>Sign in to Google</h4>
      {serviceAccount && !replacing
        ? <>
          <p className="gd-help">Connected with the service account <strong className="gd-email">{drive.email}</strong>.</p>
          <p className="gd-share">Share your Drive folder with this address as Editor (in a shared drive: Contributor or higher).</p>
          <div className="gd-actions"><Button type="button" className="ghost" disabled={disabled} onClick={copyEmail}><Copy size={14} aria-hidden="true" />Copy address</Button><Button type="button" className="ghost" disabled={disabled} onClick={() => setReplacing(true)}>Replace key</Button></div>
        </>
        : <>
          <p className="gd-help">Use a Google service account: it doesn’t expire and acts on its own, not as a person. In Google Cloud, open IAM &amp; Admin → Service accounts, create one, then Keys → Add key → JSON. Turn on the Google Drive API for that project.</p>
          <label className="gd-field" htmlFor="gd-key">Service account JSON key
            <textarea id="gd-key" rows={4} spellCheck="false" autoComplete="off" autoCorrect="off" autoCapitalize="off" value={key} placeholder={serviceAccount ? savedHere : 'Paste the whole JSON file here'} onChange={(event) => setKey(event.target.value)} />
            <small className="gd-muted">The key is checked with Google, then saved encrypted ({savedHere.toLowerCase()}). It’s never shown again.</small>
          </label>
          <div className="gd-actions">
            <Button type="button" disabled={disabled || !key.trim()} onClick={connect}>{working === 'connect' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Connect</Button>
            {replacing && <Button type="button" className="ghost" disabled={disabled} onClick={() => { setReplacing(false); setKey(''); }}>Cancel</Button>}
          </div>
          {!serviceAccount && <details className="gd-details">
            <summary>Use an access token instead</summary>
            <p className="gd-help">A Google access token with Drive permission works for a quick try, but it expires after about an hour, and then nothing goes to Drive until a new one is pasted. It’s the same token as Google Docs below.</p>
            {drive.mode === 'token' && <p className="gd-help"><strong>Using the access token now.</strong> Connect a service account to keep syncing without renewing it.</p>}
            <label className="gd-field" htmlFor="gd-token">Google access token
              <span className="gd-row"><input id="gd-token" type="password" autoComplete="off" value={token} placeholder={state?.keys?.GOOGLE_DOCS_ACCESS_TOKEN ? savedHere : 'Paste an access token'} onChange={(event) => setToken(event.target.value)} />
                <Button type="button" disabled={disabled || !token || typeof onSaveKey !== 'function'} onClick={() => Promise.resolve(onSaveKey('GOOGLE_DOCS_ACCESS_TOKEN', token)).then((saved) => { if (saved) setToken(''); })}>Save token</Button></span>
            </label>
          </details>}
        </>}
    </div>

    <div className="gd-step">
      <h4><span className="gd-step-number" aria-hidden="true">2</span>Choose the folder</h4>
      {drive.folder && !changingFolder
        ? <>
          <p className="gd-help">Reports go to <a href={drive.folder.url} target="_blank" rel="noreferrer noopener">{drive.folder.name}<ExternalLink size={11} aria-hidden="true" /></a>{drive.folder.sharedDrive ? ' in a shared drive' : ''}.{drive.files ? ` ${plural(drive.files, 'file')} there so far${drive.lastSyncAt ? `, the last ${timeAgo(drive.lastSyncAt)}` : ''}.` : ''}</p>
          <div className="gd-actions">
            <Button type="button" className="ghost" disabled={disabled} onClick={test}>{working === 'test' ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Test</Button>
            <Button type="button" className="ghost" disabled={disabled} onClick={() => setChangingFolder(true)}>Change folder</Button>
          </div>
        </>
        : <>
          <label className="gd-field" htmlFor="gd-folder">Drive folder link
            <span className="gd-row"><input id="gd-folder" type="url" inputMode="url" spellCheck="false" autoComplete="off" value={folderLink} placeholder="https://drive.google.com/drive/folders/…" onChange={(event) => setFolderLink(event.target.value)} />
              <Button type="button" disabled={disabled || !drive.connected || !folderLink.trim()} onClick={saveFolder}>{working === 'folder' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Save folder</Button>
              {drive.folder && <Button type="button" className="ghost" disabled={disabled} onClick={() => { setChangingFolder(false); setFolderLink(''); }}>Cancel</Button>}</span>
            <small className="gd-muted">{drive.connected ? 'Open the folder in Drive (a folder in a shared drive works too) and copy the address from the browser. The studio checks it can add files there.' : 'Sign in first (step 1).'}</small>
          </label>
        </>}
    </div>

    <div className="gd-step">
      <h4><span className="gd-step-number" aria-hidden="true">3</span>What goes to Drive</h4>
      <label className="gd-check"><input type="checkbox" checked={Boolean(drive.autoAdd)} disabled={disabled} onChange={(event) => toggle('autoAdd', event.target.checked)} /><span><strong>Add every new report to Drive</strong><small>Trends reports, editorial toolkits and quick scan reports, a few seconds after they’re written. An edit updates the same Doc about a minute after the last change. This is one switch for the whole studio; research programs no longer have their own.</small></span></label>
      <label className="gd-check"><input type="checkbox" checked={Boolean(drive.includeChannelAssets)} disabled={disabled} onChange={(event) => toggle('includeChannelAssets', event.target.checked)} /><span><strong>Include channel assets</strong><small>Each set goes in its trend’s folder, one folder per channel team. Written assets become Google Docs; pictures go as PNG files. Videos stay in the studio.</small></span></label>
      {drive.migratedPrograms > 0 && <p className="gd-muted">Turned on for you because {plural(drive.migratedPrograms, 'research program')} had “Publish reports to Google Drive” on.</p>}
      <dl className="gd-facts">
        <div><dt>Folders</dt><dd>Mirror the Library: one folder per research run, named by date and program; quick scans as “Quick scan · topic”; inside a run, one folder per trend with its trends report and editorial toolkit.</dd></div>
        <div><dt>Format</dt><dd>Google Doc, converted from the report as the studio shows it.</dd></div>
      </dl>
    </div>

    <div className="gd-step">
      <h4><span className="gd-step-number" aria-hidden="true">4</span>Reports written before</h4>
      {drive.backfill
        ? <div className="gd-progress" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /><span>Copying… {fmt(drive.backfill.done)} of {fmt(drive.backfill.total)}{drive.backfill.failed ? ` · ${fmt(drive.backfill.failed)} failed` : ''}</span><Button type="button" className="ghost" disabled={busy || working === 'cancel'} onClick={cancelCopy}>Cancel</Button></div>
        : <>
          <p className="gd-help">Copy the reports already in this workspace into the folder. Files already there are updated, never added twice.</p>
          <div className="gd-actions"><Button type="button" className="ghost" disabled={disabled || !drive.connected || !drive.folder} onClick={copyAll}>{working === 'copy' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Copy existing reports</Button></div>
          {drive.lastBackfill && <p className="gd-muted">Last copy: {[drive.lastBackfill.added && `${fmt(drive.lastBackfill.added)} added`, drive.lastBackfill.updated && `${fmt(drive.lastBackfill.updated)} updated`, drive.lastBackfill.unchanged && `${fmt(drive.lastBackfill.unchanged)} already there`, drive.lastBackfill.failed && `${fmt(drive.lastBackfill.failed)} failed`].filter(Boolean).join(' · ') || 'nothing to copy'}{drive.lastBackfill.cancelled ? ' (stopped)' : ''}.</p>}
        </>}
    </div>

    {(drive.connected || drive.files > 0) && <details className="gd-details" onToggle={(event) => setLogOpen(event.currentTarget.open)}><summary>Sync log{Number(drive.failed) > 0 ? ` · ${plural(drive.failed, 'file')} to retry` : ''}</summary>{logOpen && <DriveSyncLog api={api} disabled={disabled} onMessage={setMessage} />}</details>}
    {(drive.connected || drive.folder) && <div className="gd-actions gd-end"><Button type="button" className="ghost" disabled={disabled} onClick={disconnect}>{working === 'disconnect' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Disconnect</Button></div>}
  </section>;
}

// The newest 200 rows: what was added, updated or failed, with Retry on failures. Mounted (and read) each time it opens.
export function DriveSyncLog({ api, disabled = false, onMessage }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState('');
  const load = () => Promise.resolve().then(() => api.readDriveSyncLog({ limit: 200 })).then((result) => { setRows(Array.isArray(result?.rows) ? result.rows : []); setError(''); }).catch((failure) => setError(failure?.message || 'The sync log couldn’t be read.'));
  useEffect(() => { if (typeof api?.readDriveSyncLog === 'function') load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function retry(row) {
    setRetrying(row.assetId);
    try { const result = await api.retryDriveSync({ assetId: row.assetId }); onMessage?.({ tone: 'ok', text: result?.kind === 'skipped' ? `“${row.title}” is no longer in the studio, so there’s nothing to send.` : `“${row.title}” is in Drive now.` }); }
    catch (failure) { onMessage?.({ tone: 'problem', text: failure?.message || 'Google Drive didn’t accept the file.' }); }
    finally { setRetrying(''); load(); }
  }
  if (error) return <p className="gd-message is-problem" role="alert">{error}</p>;
  if (!rows) return <p className="gd-muted" role="status">Loading…</p>;
  if (!rows.length) return <p className="gd-muted">Nothing has gone to Drive yet.</p>;
  // Retry only on a file's newest row, and only while it is still failing.
  const newest = new Set(); const seen = new Set(); for (const row of rows) if (row.assetId && !seen.has(row.assetId)) { seen.add(row.assetId); newest.add(row.id); }
  return <ul className="gd-log" aria-label="Google Drive sync log">
    {rows.map((row) => <li key={row.id} className={`gd-log-row is-${row.kind}`}>
      <span className="gd-log-when">{timeAgo(row.at)}</span>
      <Badge tone={KIND_TONE[row.kind] || 'neutral'}>{KIND_LABEL[row.kind] || row.kind}</Badge>
      <span className="gd-log-what"><strong>{row.title || 'A report'}</strong>{row.where && <small>{row.where}</small>}{row.error && <small className="gd-log-error">{row.error}</small>}</span>
      <span className="gd-log-tools">
        {row.url && <a href={row.url} target="_blank" rel="noreferrer noopener">Open<ExternalLink size={11} aria-hidden="true" /></a>}
        {row.kind === 'failed' && newest.has(row.id) && <Button type="button" className="ghost" disabled={disabled || Boolean(retrying)} onClick={() => retry(row)}>{retrying === row.assetId && <LoaderCircle size={13} className="spin" aria-hidden="true" />}Retry</Button>}
      </span>
    </li>)}
  </ul>;
}
