import React, { useEffect, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { readinessItems } from '../../shared/health.js';
import { AiConnections } from './ai-connections.jsx';
import { BrandImages } from './brand-images.jsx';
import { ModelRouting } from './model-routing.jsx';
import { SetupShare } from './setup-share.jsx';
import { Badge, Button, JsonBlock, short, statusTone } from './ui.jsx';
import { normalizeOrigin } from './deep-links.js';

// The Mac app's "Studio web address": the browser studio's address, so Copy link in reports, the Library and channel
// briefs can build links teammates open there. The browser studio uses its own address, so it never shows this.
function StudioWebAddress({ settings = {}, busy, onSaveSettings }) {
  const saved = settings.studioWebAddress || '';
  const [value, setValue] = useState(saved);
  const [problem, setProblem] = useState('');
  useEffect(() => { setValue(saved); setProblem(''); }, [saved]);
  const clean = normalizeOrigin(value);
  function save() {
    if (value.trim() && !clean) { setProblem('Enter the studio’s web address, like https://studio.example.com.'); return; }
    setProblem(''); onSaveSettings({ studioWebAddress: value.trim() ? clean : '' });
  }
  return <section className="settings-block settings-links" aria-labelledby="settings-links-title" data-spot="settings.web-address">
    <div className="panel-head"><div><h3 id="settings-links-title">Studio web address</h3><p>Copy link in reports, the Library and channel briefs builds links on the browser studio’s address, so teammates open them there. Leave it blank and Copy link stays hidden on this Mac.</p></div><Badge tone={saved ? 'ready' : 'neutral'}>{saved ? 'Links on' : 'Optional'}</Badge></div>
    <label htmlFor="settings-web-address">Browser studio address</label>
    <div className="inline"><input id="settings-web-address" type="url" inputMode="url" autoComplete="url" spellCheck="false" placeholder="https://studio.example.com" value={value} aria-invalid={problem ? 'true' : undefined} aria-describedby={problem ? 'settings-web-address-error' : undefined} onChange={(event) => { setValue(event.target.value); setProblem(''); }} /><Button type="button" disabled={busy || (!value.trim() && !saved) || (Boolean(clean) && clean === saved)} onClick={save}>Save</Button>{saved && <Button type="button" className="ghost" disabled={busy} onClick={() => { setValue(''); onSaveSettings({ studioWebAddress: '' }); }}>Clear</Button>}</div>
    {problem ? <p id="settings-web-address-error" className="error-line" role="alert">{problem}</p> : <small>{clean && clean !== saved ? `Links will start with ${clean}/#/…` : saved ? `Links start with ${saved}/#/…` : 'Ask whoever runs the browser studio for its address.'}</small>}
  </section>;
}

// Where the Sheets bridge creates Google Docs and Google Sheets. Each accepts a folder link or ID; blank means My Drive.
const DRIVE_FOLDERS = [
  { key: 'trendReportsFolderId', label: 'Trend reports folder', hint: 'Folder where new trend reports are created, like n8n’s ‘New Trends Output’.' },
  { key: 'toolkitsFolderId', label: 'Editorial toolkits folder', hint: 'Folder where new editorial toolkits are created. Blank uses the default Docs folder.' },
  { key: 'docsFolderId', label: 'Default Docs folder', hint: 'Every other published report goes here. Blank means your My Drive.' },
  { key: 'sheetsExportFolderId', label: 'Google Sheets exports folder', hint: 'Where Sheets → Export → Create Google Sheet saves new spreadsheets. Blank means your My Drive.' },
];
const driveFolders = (sheets = {}) => Object.fromEntries(DRIVE_FOLDERS.map(({ key }) => [key, sheets?.[key] || '']));

// The studio's connections, for admins. The Simple | Advanced layout switch lives in the sidebar now. `role` defaults to
// admin so older callers keep everything; anyone else gets a note instead of controls the server would refuse.
// AI connections and Model routing (ai-connections.jsx, model-routing.jsx) talk to the studio through setupApi (the
// renderer's API: getAiConnections, testAiConnection, listAiModels, previewAiRouting, saveAiRouting, estimateAiTaskTest,
// testAiTask). layout ('simple' | 'classic') turns Model routing's job groups into accordions in the Simple layout.
export function SettingsView({ role = 'admin', setupApi, onOpenPrograms, state, meta, busy, layout, onSaveKey, onClearKey, onSaveSettings, onTestSheetsBridge, onArchiveAndClearSheets, onImportWorkingSheets, onReplaySheetRun, onOpenDataFolder, onOpenWorkspace, onSaveMondayBoard, onClearMondayBoard }) {
  const web = meta?.runtime === 'web'; // the browser studio: keys and the Claude connection live on the studio server
  const [token, setToken] = useState('');
  const [docsToken, setDocsToken] = useState('');
  const [mondayToken, setMondayToken] = useState('');
  const [mondayBoard, setMondayBoard] = useState(state.monday?.boardId || '');
  const activeWorkspace = state.contentStudio?.workspaces?.find(workspace => workspace.id === state.contentStudio.activeWorkspaceId);
  const semrush = activeWorkspace?.editionId === 'semrush';
  const imagesConfigured = Boolean(state.contentStudio?.capabilities?.imagesConfigured ?? state.keys.OPENAI_API_KEY);
  const [aiStatus, setAiStatus] = useState(null);
  const [checkingAi, setCheckingAi] = useState(false);
  const [sheetWebhook, setSheetWebhook] = useState('');
  const [maxItems, setMaxItems] = useState(state.settings.maxItems || 1000);
  const [sheetForm, setSheetForm] = useState({
    workingSpreadsheetUrl: state.settings.sheets?.workingSpreadsheetUrl || '',
    archiveFolderId: state.settings.sheets?.archiveFolderId || '',
    twitterTab: state.settings.sheets?.twitterTab || 'Twitter',
    linkedinTab: state.settings.sheets?.linkedinTab || 'LinkedIn',
    redditTab: state.settings.sheets?.redditTab || 'Reddit',
    ...driveFolders(state.settings.sheets),
  });
  useEffect(() => setMaxItems(state.settings.maxItems || 1000), [state.settings.maxItems]);
  useEffect(() => {
    setSheetForm({
      workingSpreadsheetUrl: state.settings.sheets?.workingSpreadsheetUrl || '',
      archiveFolderId: state.settings.sheets?.archiveFolderId || '',
      twitterTab: state.settings.sheets?.twitterTab || 'Twitter',
      linkedinTab: state.settings.sheets?.linkedinTab || 'LinkedIn',
      redditTab: state.settings.sheets?.redditTab || 'Reddit',
      ...driveFolders(state.settings.sheets),
    });
  }, [
    state.settings.sheets?.workingSpreadsheetUrl,
    state.settings.sheets?.archiveFolderId,
    state.settings.sheets?.twitterTab,
    state.settings.sheets?.linkedinTab,
    state.settings.sheets?.redditTab,
    ...DRIVE_FOLDERS.map(({ key }) => state.settings.sheets?.[key]),
  ]);

  function updateSheetField(key, value) {
    setSheetForm((current) => ({ ...current, [key]: value }));
  }

  // What a saved secret's field says. In the browser studio, keys live on the studio server, never in the browser.
  const savedHere = web ? 'Saved on the studio server' : 'Stored securely on this device';
  // The diagnostics cards read every AI connection's status (free: versions, sign-ins and saved keys).
  async function checkConnections() {
    if (typeof setupApi?.getAiConnections !== 'function') return;
    setCheckingAi(true);
    try { setAiStatus(await setupApi.getAiConnections({ fresh: true })); } catch (error) { setAiStatus({ connections: [], error: error?.message || 'The connections couldn’t be checked.' }); } finally { setCheckingAi(false); }
  }
  const openRouting = () => document.getElementById('model-routing')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const sourceSettings = (
      <div className="field-grid two">
        <label data-spot="settings.apify">Apify API token
          <div className="inline">
            <input aria-label="Apify API token" autoComplete="off" type="password" value={token} placeholder={state.keys.APIFY_API_TOKEN ? savedHere : 'Paste token'} onChange={(event) => setToken(event.target.value)} />
            <Button disabled={busy || !token} onClick={() => { onSaveKey('APIFY_API_TOKEN', token).then((saved) => { if (saved) setToken(''); }); }}>Save</Button>
            <Button className="ghost" disabled={busy || !state.keys.APIFY_API_TOKEN} onClick={() => onClearKey('APIFY_API_TOKEN')}>Clear</Button>
          </div>
        </label>
        <label>Maximum rows to download
          <div className="inline">
            <input aria-label="Maximum rows to download" type="number" min="1" max="10000" value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
            <Button disabled={busy || !Number.isInteger(Number(maxItems)) || Number(maxItems) < 1 || Number(maxItems) > 10000} onClick={() => onSaveSettings({ maxItems })}>Save</Button>
          </div><small>The most rows the studio downloads from one scraper run. Each scraper’s own settings decide how much it collects and what it costs; research programs set their own limits.</small>
        </label>

      </div>
  );

  if (role !== 'admin') {
    const admins = (Array.isArray(state.team?.admins) ? state.team.admins : []).map((admin) => admin?.name).filter(Boolean).slice(0, 3);
    const who = admins.length > 1 ? `${admins.slice(0, -1).join(', ')} or ${admins[admins.length - 1]}` : admins[0] || 'an admin';
    return <section className="panel full settings-view settings-locked" aria-labelledby="settings-locked-title"><div className="panel-head"><div><h3 id="settings-locked-title">Settings are for admins</h3><p>Connections, keys and pictures are set up once for the whole studio. Ask {who} if something needs changing.</p></div></div></section>;
  }
  return (
    <section className="panel full settings-view">
      <div className="panel-head">
        <div><h3>Connect your tools</h3><p>Connect source collection, writing, and image generation in one place.</p></div>
        <div className="button-row">
          <Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys.APIFY_API_TOKEN ? 'Apify saved' : 'Apify missing'}</Badge>
          <Badge tone={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'ready' : 'neutral'}>{state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Sheets saved' : 'Sheets optional'}</Badge>
        </div>
      </div>
      {/* First, in both editions: without Apify nothing new can be collected. */}
      <section className="settings-block settings-sources" aria-labelledby="settings-sources-title"><div className="panel-head"><div><h3 id="settings-sources-title">Source collection</h3><p>{semrush ? 'Connect Apify to research the accounts and communities you choose.' : 'Connect Apify to run your scrapers and research the accounts and communities you choose.'}</p></div><Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys.APIFY_API_TOKEN ? 'Credential saved' : 'Setup needed'}</Badge></div>{sourceSettings}</section>
      {/* Every AI vendor and which one each job uses (Settings left nav: AI connections, Model routing). */}
      <AiConnections state={state} meta={meta} api={setupApi} busy={busy} onSaveKey={onSaveKey} onClearKey={onClearKey} onOpenRouting={setupApi?.previewAiRouting ? openRouting : undefined} />
      {setupApi?.previewAiRouting && <ModelRouting state={state} api={setupApi} busy={busy} role={role} layout={layout || state.settings?.uiMode} />}
      {setupApi?.addBrandImage && <BrandImages api={setupApi} workspace={activeWorkspace} busy={busy} imagesConfigured={imagesConfigured} />}
      <details className="settings-block" data-spot="settings.google-docs"><summary>Google Docs <span>Import private research documents</span></summary>
        <p>Connect a Google OAuth access token with Docs read permission for imports and Drive file creation permission for delivery. Tokens expire; reconnect when prompted. You can also upload a DOCX file without a Google connection.</p>
        {state.keys.GOOGLE_SHEETS_WEBHOOK_URL && <p><small>Publishing to Google Drive uses your Sheets bridge, so this token is only needed for imports.</small></p>}
        <label>Google Docs access token<div className="inline"><input aria-label="Google Docs access token" type="password" autoComplete="off" value={docsToken} placeholder={state.keys.GOOGLE_DOCS_ACCESS_TOKEN ? savedHere : 'Paste an authorized access token'} onChange={event => setDocsToken(event.target.value)}/><Button disabled={busy || !docsToken} onClick={() => onSaveKey('GOOGLE_DOCS_ACCESS_TOKEN', docsToken).then(saved => { if (saved) setDocsToken(''); })}>Connect Docs</Button><Button className="ghost" disabled={busy || !state.keys.GOOGLE_DOCS_ACCESS_TOKEN} onClick={() => onClearKey('GOOGLE_DOCS_ACCESS_TOKEN')}>Disconnect</Button></div></label>
      </details>
      {onSaveMondayBoard && <details className="settings-block settings-monday" open={Boolean(state.monday?.connected && !state.monday?.boardId) || undefined}><summary>Monday.com <span>{state.monday?.boardName ? `Trend board syncs to ${state.monday.boardName}` : state.monday?.connected ? 'Connected · choose a board' : 'Mirror the trend board'}</span></summary>
        <p>Each trend on the Trend board becomes a Monday.com item, and its Status column follows the card with Monday’s own labels: Potential trend (Needs your OK), Approved, In production (Being written), Ready to use (Ready) or Passed (Skipped). Use a personal API token from Monday.com (your avatar → Developers → My access tokens).</p>
        <label>Monday.com API token<div className="inline"><input aria-label="Monday.com API token" type="password" autoComplete="off" value={mondayToken} placeholder={state.keys.MONDAY_API_TOKEN ? savedHere : 'Paste a personal API token'} onChange={event => setMondayToken(event.target.value)}/><Button disabled={busy || !mondayToken} onClick={() => onSaveKey('MONDAY_API_TOKEN', mondayToken.trim()).then(saved => { if (saved) setMondayToken(''); })}>Connect</Button><Button className="ghost" disabled={busy || !state.keys.MONDAY_API_TOKEN} onClick={() => onClearKey('MONDAY_API_TOKEN')}>Disconnect</Button></div></label>
        <label>Board ID<div className="inline"><input aria-label="Monday.com board ID" inputMode="numeric" value={mondayBoard} placeholder="The number in the board’s URL, e.g. 1234567890" onChange={event => setMondayBoard(event.target.value.replace(/[^0-9]/g, ''))}/><Button disabled={busy || !state.keys.MONDAY_API_TOKEN || !mondayBoard} onClick={() => onSaveMondayBoard({ boardId: mondayBoard })}>Use this board</Button>{state.monday?.boardId && <Button className="ghost" disabled={busy} onClick={() => { setMondayBoard(''); onClearMondayBoard(); }}>Forget board</Button>}</div></label>
        {state.monday?.boardId && <p className="settings-note">Board <strong>{state.monday.boardName || state.monday.boardId}</strong> · {state.monday.statusColumnId ? 'Status column found' : 'No Status column yet'} · {state.monday.notesColumnId ? 'Long text column found for trend notes' : 'Add a Long text column to include trend notes'}{state.monday.syncedCount ? ` · ${state.monday.syncedCount} trends synced` : ''}</p>}
        {(state.monday?.warnings || []).map(warning => <p key={warning} className="settings-note">{warning}</p>)}
      </details>}
      <details className="settings-block" data-spot="settings.google-sheets"><summary>Google Sheets <span>Optional integration</span></summary>
        <div className="panel-head compact">
          <div><h3>Google Sheets bridge</h3><p>Use an Apps Script webhook to archive, clear, import, and write shared weekly sheets, and to create Google Sheets and Docs in your Drive.</p></div>
        </div>
        <div className="field-grid two">
          <label>Apps Script webhook URL
            <div className="inline">
              <input aria-label="Apps Script webhook URL" autoComplete="off" type="password" value={sheetWebhook} placeholder={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? savedHere : 'Paste Apps Script web app URL'} onChange={(event) => setSheetWebhook(event.target.value)} />
              <Button disabled={busy || !sheetWebhook} onClick={() => { onSaveKey('GOOGLE_SHEETS_WEBHOOK_URL', sheetWebhook).then((saved) => { if (saved) setSheetWebhook(''); }); }}>Save</Button>
              <Button className="ghost" disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL} onClick={() => onClearKey('GOOGLE_SHEETS_WEBHOOK_URL')}>Clear</Button>
            </div>
          </label>
          <label>Working spreadsheet URL
            <input value={sheetForm.workingSpreadsheetUrl} onChange={(event) => updateSheetField('workingSpreadsheetUrl', event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          </label>
          <label>Archive folder ID
            <input value={sheetForm.archiveFolderId} onChange={(event) => updateSheetField('archiveFolderId', event.target.value)} placeholder="Google Drive folder ID" />
          </label>
          <label>X (Twitter) tab
            <input value={sheetForm.twitterTab} onChange={(event) => updateSheetField('twitterTab', event.target.value)} />
          </label>
          <label>LinkedIn tab
            <input value={sheetForm.linkedinTab} onChange={(event) => updateSheetField('linkedinTab', event.target.value)} />
          </label>
          <label>Reddit tab
            <input value={sheetForm.redditTab} onChange={(event) => updateSheetField('redditTab', event.target.value)} />
          </label>
        </div>
        <div className="panel-head compact">
          <div><h3>Google Drive folders</h3><p>{state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Publish to Google Drive creates native Google Docs through this bridge, with no access token to paste or renew.' : 'Save the webhook URL above to publish reports as Google Docs without an access token.'} Paste a folder link or ID.</p></div>
        </div>
        <div className="field-grid two">
          {DRIVE_FOLDERS.map(({ key, label, hint }) => (
            <label key={key}>{label}
              <input aria-label={label} value={sheetForm[key]} spellCheck="false" onChange={(event) => updateSheetField(key, event.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
              <small>{hint}</small>
            </label>
          ))}
        </div>
        <div className="button-row">
          <Button disabled={busy} onClick={() => onSaveSettings({ sheets: sheetForm })}>Save sheet settings</Button>
          <Button className="ghost" disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId} onClick={onTestSheetsBridge}>Test bridge</Button>
          <Button
            className="ghost"
            disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId}
            onClick={() => {
              if (window.confirm('Clone the working spreadsheet to archive, then clear the configured working tabs?')) onArchiveAndClearSheets({});
            }}
          >
            Archive + clear
          </Button>
          <Button className="ghost" disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId} onClick={onImportWorkingSheets}>Pull working sheet</Button>
        </div>
        {state.sheetRuns?.length > 0 && (
          <div className="stack">
            {state.sheetRuns.slice(0, 3).map((run) => (
              <article className="readiness-card" key={run.id}>
                <Badge tone={statusTone(run.status)}>{run.kind}</Badge>
                <p>{short(run.error || run.archiveUrl || run.spreadsheetUrl || run.tabName || run.datasetId || run.spreadsheetId || 'Sheet run saved', 160)}</p>
                {run.status === 'failed' && (
                  <Button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (run.kind === 'archive-clear' && !window.confirm('Replay archive + clear for this failed sheet run?')) return;
                      onReplaySheetRun(run.id);
                    }}
                  >
                    Replay
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </details>
      {!web && <StudioWebAddress settings={state.settings} busy={busy} onSaveSettings={onSaveSettings} />}
      {setupApi?.openSetupFile && <section className="settings-block settings-setup" aria-labelledby="settings-setup-title"><div className="panel-head"><div><h3 id="settings-setup-title">Share your setup</h3><p>Give a teammate this workspace's research program and knowledge in one file, or load one they shared with you.</p></div></div><SetupShare api={setupApi} web={web} onOpenPrograms={onOpenPrograms} /></section>}
      <details className="settings-health" data-spot="settings.diagnostics"><summary>Connection diagnostics</summary>
        <div className="settings-diagnostics-check"><Button type="button" className="ghost" disabled={busy || checkingAi} onClick={checkConnections}>{checkingAi ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}{checkingAi ? 'Checking…' : 'Check connections'}</Button><small>Reads every AI connection’s version, sign-in and saved key again. Free: nothing is sent to a model.</small></div>
        <div className="readiness-grid">
        {readinessItems(state, meta, aiStatus || { connections: [] }).map((original) => original.id === 'apify' ? { ...original, detail: state.keys?.APIFY_API_TOKEN ? (web ? 'Saved on the studio server' : original.detail) : 'Not connected yet. Add the token under Source collection, at the top of this page.' }
          : web && original.id === 'workspace' ? { ...original, label: 'Studio server', tone: 'ready', detail: 'Workspace data is saved on the studio server.' }
          : original).concat(aiStatus ? [] : [{ id: 'ai', label: 'AI connections', tone: 'neutral', detail: 'Not checked yet. Choose Check connections.' }]).map((item) => (
          <article className="readiness-card" key={item.id}>
            <Badge tone={item.tone}>{item.label}</Badge>
            <p>{short(item.detail, 160)}</p>
          </article>
        ))}
        </div>
      </details>
      <details className="settings-block"><summary>{web ? 'Studio details' : 'Local files & workspace details'}</summary>{!web && <div className="button-row">
        <Button className="ghost" disabled={busy} onClick={onOpenDataFolder}>Open data folder</Button>
        <Button className="ghost" disabled={busy} onClick={onOpenWorkspace}>Open workspace</Button>
      </div>}
      <JsonBlock value={web ? { app: meta?.name, version: meta?.version, runtime: 'Browser studio (data stays on the studio server)' } : { app: meta?.name, version: meta?.version, dataRoot: meta?.dataRoot }} /></details>
    </section>
  );
}

