import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { readinessItems } from '../../shared/health.js';
import { AiConnections } from './ai-connections.jsx';
import { BrandImages } from './brand-images.jsx';
import { ModelRouting } from './model-routing.jsx';
import { SetupShare } from './setup-share.jsx';
import { Badge, Button, JsonBlock, short, statusTone } from './ui.jsx';
import { normalizeOrigin } from './deep-links.js';
import { useNarrow } from './role-screens.jsx';
import { SETTINGS_SECTION_IDS, sectionId, sectionStatus, visibleSections } from './settings-sections.js';
import { revealSection, useSectionSpy } from './section-spy.js';
import { SettingsNav } from './settings-nav.jsx';
import { MondaySettings } from './monday-settings.jsx';
import './settings-view.css';

// The Mac app's "Studio web address": the browser studio's address, so Copy link in reports, the Library and channel
// briefs can build links teammates open there. The browser studio uses its own address, so it never shows this.
function WebAddressSection({ settings = {}, busy, onSaveSettings }) {
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
const sheetFormOf = (sheets = {}) => ({ workingSpreadsheetUrl: sheets?.workingSpreadsheetUrl || '', archiveFolderId: sheets?.archiveFolderId || '', twitterTab: sheets?.twitterTab || 'Twitter', linkedinTab: sheets?.linkedinTab || 'LinkedIn', redditTab: sheets?.redditTab || 'Reddit', ...driveFolders(sheets) });
// Names for the saved keys a problem banner talks about (the server's own list is in src/main/index.js KEY_LABELS).
const KEY_LABELS = { APIFY_API_TOKEN: 'Apify token', ANTHROPIC_API_KEY: 'Anthropic API key', GOOGLE_SHEETS_WEBHOOK_URL: 'Google Sheets bridge link', GOOGLE_DOCS_ACCESS_TOKEN: 'Google Drive token', OPENAI_API_KEY: 'OpenAI key', MONDAY_API_TOKEN: 'Monday.com token', OPENROUTER_API_KEY: 'OpenRouter key', FAL_KEY: 'fal.ai key' };

function SourcesSection({ state, busy, semrush, savedHere, onSaveKey, onClearKey, onSaveSettings }) {
  const [token, setToken] = useState('');
  const [maxItems, setMaxItems] = useState(state.settings?.maxItems || 1000);
  useEffect(() => setMaxItems(state.settings?.maxItems || 1000), [state.settings?.maxItems]);
  const saved = Boolean(state.keys?.APIFY_API_TOKEN);
  // First, in both editions: without Apify nothing new can be collected.
  return <section className="settings-block settings-sources" aria-labelledby="settings-sources-title"><div className="panel-head"><div><h3 id="settings-sources-title">Source collection</h3><p>{semrush ? 'Connect Apify to research the accounts and communities you choose.' : 'Connect Apify to run your scrapers and research the accounts and communities you choose.'}</p></div><Badge tone={saved ? 'ready' : 'warning'}>{saved ? 'Credential saved' : 'Setup needed'}</Badge></div>
    <div className="field-grid two">
      <label data-spot="settings.apify">Apify API token
        <div className="inline">
          <input aria-label="Apify API token" autoComplete="off" type="password" value={token} placeholder={saved ? savedHere : 'Paste token'} onChange={(event) => setToken(event.target.value)} />
          <Button disabled={busy || !token} onClick={() => { onSaveKey('APIFY_API_TOKEN', token).then((done) => { if (done) setToken(''); }); }}>Save</Button>
          <Button className="ghost" disabled={busy || !saved} onClick={() => onClearKey('APIFY_API_TOKEN')}>Clear</Button>
        </div>
      </label>
      <label>Maximum rows to download
        <div className="inline">
          <input aria-label="Maximum rows to download" type="number" min="1" max="10000" value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
          <Button disabled={busy || !Number.isInteger(Number(maxItems)) || Number(maxItems) < 1 || Number(maxItems) > 10000} onClick={() => onSaveSettings({ maxItems })}>Save</Button>
        </div><small>The most rows the studio downloads from one scraper run. Each scraper’s own settings decide how much it collects and what it costs; research programs set their own limits.</small>
      </label>
    </div>
  </section>;
}

function GoogleDocsSection({ state, busy, savedHere, onSaveKey, onClearKey }) {
  const [docsToken, setDocsToken] = useState('');
  return <details className="settings-block" data-spot="settings.google-docs"><summary>Google Docs <span>Import private research documents</span></summary>
    <p>Connect a Google OAuth access token with Docs read permission for imports and Drive file creation permission for delivery. Tokens expire; reconnect when prompted. You can also upload a DOCX file without a Google connection.</p>
    {state.keys?.GOOGLE_SHEETS_WEBHOOK_URL && <p><small>Publishing to Google Drive uses your Sheets bridge, so this token is only needed for imports.</small></p>}
    <label>Google Docs access token<div className="inline"><input aria-label="Google Docs access token" type="password" autoComplete="off" value={docsToken} placeholder={state.keys?.GOOGLE_DOCS_ACCESS_TOKEN ? savedHere : 'Paste an authorized access token'} onChange={event => setDocsToken(event.target.value)}/><Button disabled={busy || !docsToken} onClick={() => onSaveKey('GOOGLE_DOCS_ACCESS_TOKEN', docsToken).then(saved => { if (saved) setDocsToken(''); })}>Connect Docs</Button><Button className="ghost" disabled={busy || !state.keys?.GOOGLE_DOCS_ACCESS_TOKEN} onClick={() => onClearKey('GOOGLE_DOCS_ACCESS_TOKEN')}>Disconnect</Button></div></label>
  </details>;
}

function GoogleSheetsSection({ state, busy, savedHere, onSaveKey, onClearKey, onSaveSettings, onTestSheetsBridge, onArchiveAndClearSheets, onImportWorkingSheets, onReplaySheetRun }) {
  const sheets = state.settings?.sheets || {};
  const [sheetWebhook, setSheetWebhook] = useState('');
  const [sheetForm, setSheetForm] = useState(() => sheetFormOf(sheets));
  useEffect(() => { setSheetForm(sheetFormOf(sheets)); }, [sheets.workingSpreadsheetUrl, sheets.archiveFolderId, sheets.twitterTab, sheets.linkedinTab, sheets.redditTab, ...DRIVE_FOLDERS.map(({ key }) => sheets[key])]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateSheetField = (key, value) => setSheetForm((current) => ({ ...current, [key]: value }));
  const bridge = Boolean(state.keys?.GOOGLE_SHEETS_WEBHOOK_URL);
  const working = bridge && Boolean(sheets.workingSpreadsheetId);
  return <details className="settings-block" data-spot="settings.google-sheets"><summary>Google Sheets <span>Optional integration</span></summary>
    <div className="panel-head compact">
      <div><h3>Google Sheets bridge</h3><p>Use an Apps Script webhook to archive, clear, import, and write shared weekly sheets, and to create Google Sheets and Docs in your Drive.</p></div>
    </div>
    <div className="field-grid two">
      <label>Apps Script webhook URL
        <div className="inline">
          <input aria-label="Apps Script webhook URL" autoComplete="off" type="password" value={sheetWebhook} placeholder={bridge ? savedHere : 'Paste Apps Script web app URL'} onChange={(event) => setSheetWebhook(event.target.value)} />
          <Button disabled={busy || !sheetWebhook} onClick={() => { onSaveKey('GOOGLE_SHEETS_WEBHOOK_URL', sheetWebhook).then((saved) => { if (saved) setSheetWebhook(''); }); }}>Save</Button>
          <Button className="ghost" disabled={busy || !bridge} onClick={() => onClearKey('GOOGLE_SHEETS_WEBHOOK_URL')}>Clear</Button>
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
      <div><h3>Google Drive folders</h3><p>{bridge ? 'Publish to Google Drive creates native Google Docs through this bridge, with no access token to paste or renew.' : 'Save the webhook URL above to publish reports as Google Docs without an access token.'} Paste a folder link or ID.</p></div>
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
      <Button className="ghost" disabled={busy || !working} onClick={onTestSheetsBridge}>Test bridge</Button>
      <Button className="ghost" disabled={busy || !working} onClick={() => { if (window.confirm('Clone the working spreadsheet to archive, then clear the configured working tabs?')) onArchiveAndClearSheets({}); }}>Archive + clear</Button>
      <Button className="ghost" disabled={busy || !working} onClick={onImportWorkingSheets}>Pull working sheet</Button>
    </div>
    {state.sheetRuns?.length > 0 && (
      <div className="stack">
        {state.sheetRuns.slice(0, 3).map((run) => (
          <article className="readiness-card" key={run.id}>
            <Badge tone={statusTone(run.status)}>{run.kind}</Badge>
            <p>{short(run.error || run.archiveUrl || run.spreadsheetUrl || run.tabName || run.datasetId || run.spreadsheetId || 'Sheet run saved', 160)}</p>
            {run.status === 'failed' && <Button className="ghost" disabled={busy} onClick={() => { if (run.kind === 'archive-clear' && !window.confirm('Replay archive + clear for this failed sheet run?')) return; onReplaySheetRun(run.id); }}>Replay</Button>}
          </article>
        ))}
      </div>
    )}
  </details>;
}

function ShareSection({ setupApi, web, onOpenPrograms }) {
  return <section className="settings-block settings-setup" aria-labelledby="settings-setup-title"><div className="panel-head"><div><h3 id="settings-setup-title">Share your setup</h3><p>Give a teammate this workspace's research program and knowledge in one file, or load one they shared with you.</p></div></div><SetupShare api={setupApi} web={web} onOpenPrograms={onOpenPrograms} /></section>;
}

// Saved keys this studio can't read and data files that were damaged at startup (names only, never values), then every
// connection's readiness. Check connections is free: it reads versions, sign-ins and saved keys again.
function DiagnosticsSection({ state, meta, busy, web, setupApi }) {
  const [aiStatus, setAiStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  async function checkConnections() {
    if (typeof setupApi?.getAiConnections !== 'function') return;
    setChecking(true);
    try { setAiStatus(await setupApi.getAiConnections({ fresh: true })); } catch (error) { setAiStatus({ connections: [], error: error?.message || 'The connections couldn’t be checked.' }); } finally { setChecking(false); }
  }
  const keyProblems = Object.entries(state.keyProblems || {}).filter(([, problem]) => problem);
  const recovered = Array.isArray(state.storeRecovery) ? state.storeRecovery : [];
  return <details className="settings-health" data-spot="settings.diagnostics" open={keyProblems.length || recovered.length ? true : undefined}><summary>Connection diagnostics</summary>
    {(keyProblems.length > 0 || recovered.length > 0) && <div className="settings-problems" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      <ul>
        {keyProblems.map(([name, problem]) => <li key={name}>The saved {KEY_LABELS[name] || name} can’t be read {problem === 'mismatch' ? 'with this studio’s secret key (STUDIO_SECRET_KEY). Start the studio with the original key, or clear it and save it again.' : 'here: it was saved by another installation. Clear it and save it again.'}</li>)}
        {recovered.map((entry) => <li key={`${entry.file}-${entry.kept}`}>{entry.store || 'A data file'} ({entry.file}) was damaged, so the studio started without it. A copy was kept as {entry.kept}.</li>)}
      </ul>
    </div>}
    <div className="settings-diagnostics-check"><Button type="button" className="ghost" disabled={busy || checking} onClick={checkConnections}>{checking ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}{checking ? 'Checking…' : 'Check connections'}</Button><small>Reads every AI connection’s version, sign-in and saved key again. Free: nothing is sent to a model.</small></div>
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
  </details>;
}

const EDITION_LABEL = { semrush: 'Semrush edition', general: 'General edition' };
const countLine = (row) => [row.programs ? `${row.programs} ${row.programs === 1 ? 'program' : 'programs'}` : '', row.runs ? `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}` : '', row.assets ? `${row.assets} ${row.assets === 1 ? 'asset' : 'assets'}` : ''].filter(Boolean).join(', ');
function DetailsSection({ state, meta, busy, web, onOpenDataFolder, onOpenWorkspace }) {
  const studio = state.contentStudio || {};
  const policy = studio.workspacePolicy || {};
  const active = (studio.workspaces || []).find((row) => row.id === studio.activeWorkspaceId);
  const archived = Array.isArray(policy.archived) ? policy.archived : [];
  return <details className="settings-block settings-details"><summary>{web ? 'Studio details' : 'Local files & workspace details'}</summary>
    {policy.mode === 'single' && <div className="settings-workspace-note">
      <p><strong>Workspace: {active?.name || policy.name || 'Main'}</strong> ({EDITION_LABEL[policy.editionId] || EDITION_LABEL.semrush}). This build has one workspace.</p>
      {archived.length > 0 && <p><small>Kept on disk, hidden in this build: {archived.map((row) => `${row.name}${countLine(row) ? ` (${countLine(row)})` : ''}`).join('; ')}.</small></p>}
    </div>}
    {!web && <div className="button-row">
      <Button className="ghost" disabled={busy} onClick={onOpenDataFolder}>Open data folder</Button>
      <Button className="ghost" disabled={busy} onClick={onOpenWorkspace}>Open workspace</Button>
    </div>}
    <JsonBlock value={web ? { app: meta?.name, version: meta?.version, runtime: 'Browser studio (data stays on the studio server)' } : { app: meta?.name, version: meta?.version, dataRoot: meta?.dataRoot }} />
  </details>;
}

// The studio's connections, for admins, with a section nav on the left (settings-sections.js lists the sections, in
// page order). The Simple | Advanced layout switch lives in the sidebar now. `role` defaults to admin so older callers
// keep everything; anyone else gets a note instead of controls the server would refuse.
// AI connections and Model routing (ai-connections.jsx, model-routing.jsx) talk to the studio through setupApi (the
// renderer's API: getAiConnections, testAiConnection, listAiModels, previewAiRouting, saveAiRouting, estimateAiTaskTest,
// testAiTask). layout ('simple' | 'classic') turns Model routing's job groups into accordions in the Simple layout.
// `request` ({ key, section } | null) jumps to a section once per key (a #/settings/<section> link, a setup step, a Show
// me step); `extraSections` ({ [id]: () => element }) lets another build supply or replace a section's renderer without
// editing this file; `narrow` forces the compact "Jump to" menu (tests).
export function SettingsView({ role = 'admin', setupApi, onOpenPrograms, state, meta, busy, layout, request = null, extraSections = {}, narrow: forcedNarrow, onSaveKey, onClearKey, onSaveSettings, onTestSheetsBridge, onArchiveAndClearSheets, onImportWorkingSheets, onReplaySheetRun, onOpenDataFolder, onOpenWorkspace, onSaveMondayBoard, onClearMondayBoard }) {
  const web = meta?.runtime === 'web'; // the browser studio: keys and the Claude connection live on the studio server
  const mediaNarrow = useNarrow();
  const narrow = forcedNarrow ?? mediaNarrow;
  const activeWorkspace = state.contentStudio?.workspaces?.find(workspace => workspace.id === state.contentStudio.activeWorkspaceId);
  const semrush = activeWorkspace?.editionId === 'semrush';
  const imagesConfigured = Boolean(state.contentStudio?.capabilities?.imagesConfigured ?? state.keys?.OPENAI_API_KEY);
  // What a saved secret's field says. In the browser studio, keys live on the studio server, never in the browser.
  const savedHere = web ? 'Saved on the studio server' : 'Stored securely on this device';
  const common = { state, meta, busy, web, role, layout: layout || state.settings?.uiMode, savedHere, api: setupApi, onSaveKey, onClearKey, onSaveSettings, onSaveMondayBoard, onClearMondayBoard };

  // One renderer per section id in settings-sections.js; a missing renderer hides its section (ctx.has).
  const renderers = {
    sources: () => <SourcesSection {...common} semrush={semrush} />,
    ai: () => <AiConnections state={state} meta={meta} api={setupApi} busy={busy} onSaveKey={onSaveKey} onClearKey={onClearKey} onOpenRouting={setupApi?.previewAiRouting ? () => go('models', { viaKeyboard: false }) : undefined} />,
    models: setupApi?.previewAiRouting ? () => <ModelRouting state={state} api={setupApi} busy={busy} role={role} layout={layout || state.settings?.uiMode} /> : null,
    'brand-images': setupApi?.addBrandImage ? () => <BrandImages api={setupApi} workspace={activeWorkspace} busy={busy} imagesConfigured={imagesConfigured} /> : null,
    'google-docs': () => <GoogleDocsSection {...common} />,
    'google-sheets': () => <GoogleSheetsSection {...common} onTestSheetsBridge={onTestSheetsBridge} onArchiveAndClearSheets={onArchiveAndClearSheets} onImportWorkingSheets={onImportWorkingSheets} onReplaySheetRun={onReplaySheetRun} />,
    monday: () => <MondaySettings {...common} />, // monday-settings.jsx (connect, board, mapping, two-way sync, the log)
    'web-address': () => <WebAddressSection settings={state.settings} busy={busy} onSaveSettings={onSaveSettings} />,
    share: setupApi?.openSetupFile ? () => <ShareSection setupApi={setupApi} web={web} onOpenPrograms={onOpenPrograms} /> : null,
    diagnostics: () => <DiagnosticsSection {...common} setupApi={setupApi} />,
    details: () => <DetailsSection {...common} onOpenDataFolder={onOpenDataFolder} onOpenWorkspace={onOpenWorkspace} />,
    ...extraSections,
  };
  const ctx = { state, web, has: { models: Boolean(renderers.models), brandImages: Boolean(renderers['brand-images']), monday: Boolean(renderers.monday), setupShare: Boolean(renderers.share) } };
  const sections = visibleSections(ctx).filter((section) => typeof renderers[section.id] === 'function');
  const ids = sections.map((section) => section.id);
  const statuses = useMemo(() => Object.fromEntries(ids.map((id) => [id, sectionStatus(id, ctx)]).filter(([, status]) => status)), [ids.join('|'), state.keys, state.keyProblems, state.settings, state.contentStudio, state.monday, state.sheetRuns, state.storeRecovery]); // eslint-disable-line react-hooks/exhaustive-deps
  const spy = useSectionSpy({ ids, enabled: role === 'admin' });
  const element = (id) => (typeof document === 'undefined' ? null : document.getElementById(`settings-${id}`));
  function go(id, { viaKeyboard = false, smooth = true } = {}) {
    const el = element(id); if (!el) return;
    spy.lock(id); revealSection(el, { smooth, focus: viaKeyboard });
  }
  // A section request (#/settings/<section>, a setup step, a Show me step) jumps there once per key; an unknown or
  // hidden section leaves the page at the top.
  const handled = useRef(null);
  useLayoutEffect(() => {
    if (!request?.key || handled.current === request.key) return undefined;
    handled.current = request.key;
    const id = sectionId(request.section);
    if (!id || !SETTINGS_SECTION_IDS.includes(id) || !ids.includes(id)) return undefined;
    spy.setActive(id);
    const frame = typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame(() => go(id, { smooth: false })) : 0;
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [request?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (role !== 'admin') {
    const admins = (Array.isArray(state.team?.admins) ? state.team.admins : []).map((admin) => admin?.name).filter(Boolean).slice(0, 3);
    const who = admins.length > 1 ? `${admins.slice(0, -1).join(', ')} or ${admins[admins.length - 1]}` : admins[0] || 'an admin';
    return <section className="panel full settings-view settings-locked" aria-labelledby="settings-locked-title"><div className="panel-head"><div><h3 id="settings-locked-title">Settings are for admins</h3><p>Connections, keys and pictures are set up once for the whole studio. Ask {who} if something needs changing.</p></div></div></section>;
  }
  return (
    <div className="settings-shell" data-narrow={narrow || undefined}>
      <SettingsNav sections={sections} statuses={statuses} active={spy.active} narrow={narrow} onGo={(id, options) => go(id, options)} />
      <section className="panel full settings-view">
        <div className="panel-head">
          <div><h3>Connect your tools</h3><p>Connect source collection, writing, and image generation in one place.</p></div>
          <div className="button-row">
            <Badge tone={state.keys?.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys?.APIFY_API_TOKEN ? 'Apify saved' : 'Apify missing'}</Badge>
            <Badge tone={state.keys?.GOOGLE_SHEETS_WEBHOOK_URL ? 'ready' : 'neutral'}>{state.keys?.GOOGLE_SHEETS_WEBHOOK_URL ? 'Sheets saved' : 'Sheets optional'}</Badge>
          </div>
        </div>
        <div className="settings-sections">
          {sections.map((section) => <div key={section.id} id={`settings-${section.id}`} className="settings-anchor" data-settings-section={section.id}>{renderers[section.id]()}</div>)}
        </div>
      </section>
    </div>
  );
}
