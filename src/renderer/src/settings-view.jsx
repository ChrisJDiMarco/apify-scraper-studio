import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { readinessItems } from '../../shared/health.js';
import { DEFAULT_PROGRAM_AI } from './research-program-fields.jsx';
import { SetupShare } from './setup-share.jsx';
import { Badge, Button, JsonBlock, short, statusTone } from './ui.jsx';

// Where the Sheets bridge creates Google Docs and Google Sheets. Each accepts a folder link or ID; blank means My Drive.
const DRIVE_FOLDERS = [
  { key: 'trendReportsFolderId', label: 'Trend reports folder', hint: 'Folder where new trend reports are created, like n8n’s ‘New Trends Output’.' },
  { key: 'toolkitsFolderId', label: 'Editorial toolkits folder', hint: 'Folder where new editorial toolkits are created. Blank uses the default Docs folder.' },
  { key: 'docsFolderId', label: 'Default Docs folder', hint: 'Every other published report goes here. Blank means your My Drive.' },
  { key: 'sheetsExportFolderId', label: 'Google Sheets exports folder', hint: 'Where Sheets → Export → Create Google Sheet saves new spreadsheets. Blank means your My Drive.' },
];
const driveFolders = (sheets = {}) => Object.fromEntries(DRIVE_FOLDERS.map(({ key }) => [key, sheets?.[key] || '']));

const CLAUDE_ROUTES = [
  ['auto', 'Automatic (recommended)', 'Uses the Claude app when it is installed, signed in and up to date; otherwise the API key below.'],
  ['claude', 'Claude app (Claude Code)', "Uses this Mac's Claude Code sign-in and plan."],
  ['claude-api', 'Anthropic API key', "Calls the API directly; usage is billed to the key's account."],
];
const ROUTE_BADGE = { auto: 'Automatic', claude: 'Claude app', 'claude-api': 'API key', codex: 'Codex selected' };
function routeSummary(result) {
  if (result.route === 'claude') return `Claude app ${result.version || ''}`.trim() + (result.loggedIn ? ' · signed in' : '');
  if (result.route === 'claude-api') return 'Anthropic API key';
  return result.version || 'Available';
}
function AiCheckResult({ result }) {
  const models = Array.isArray(result.models) ? result.models : [];
  return <div className={`settings-ai-result ${result.ok ? 'ok' : 'problem'}`} role="status">
    <strong>{result.ok ? `Ready · using ${routeSummary(result)}` : result.route ? `Using ${routeSummary(result)}, with a problem` : 'Claude is not reachable yet'}</strong>
    {result.provider === 'auto' && result.route === 'claude-api' && result.cli && <small>The Claude app was skipped: {result.cli.installed ? result.cli.missingFlags?.length ? `version ${result.cli.version} is too old` : result.cli.loggedIn ? 'it is unavailable' : 'it is not signed in' : 'it is not installed'}.</small>}
    {models.length > 0 && <ul>{models.map((model) => <li key={model.id} className={model.available ? 'ok' : 'problem'}>{model.available ? '✓' : '✕'} {model.id}{model.available ? '' : ` — ${model.error}`}</li>)}</ul>}
    {result.error && !result.ok && <p>{result.error}</p>}
  </div>;
}

export function SettingsView({ setupApi, onOpenPrograms, state, meta, busy, onSaveKey, onClearKey, onSaveSettings, onTestSheetsBridge, onArchiveAndClearSheets, onImportWorkingSheets, onReplaySheetRun, onCheckAi, onCheckCodex, onTestImages, onOpenDataFolder, onOpenWorkspace, onSaveMondayBoard, onClearMondayBoard }) {
  const [token, setToken] = useState('');
  const [docsToken, setDocsToken] = useState('');
  const [mondayToken, setMondayToken] = useState('');
  const [mondayBoard, setMondayBoard] = useState(state.monday?.boardId || '');
  const [imageKey, setImageKey] = useState('');
  const [imageCheck, setImageCheck] = useState(null);
  const [imageAction, setImageAction] = useState('');
  const [imageError, setImageError] = useState('');
  const semrush = state.contentStudio?.workspaces?.find(workspace => workspace.id === state.contentStudio.activeWorkspaceId)?.editionId === 'semrush';
  const imagesConfigured = Boolean(state.keys.OPENAI_API_KEY);
  const imageBusy = busy || Boolean(imageAction);
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
  const [aiProvider, setAiProvider] = useState(state.settings.aiProvider || 'auto');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [aiModel, setAiModel] = useState(state.settings.aiModel || 'claude-opus-5-5');
  const [aiMaxBudgetUsd, setAiMaxBudgetUsd] = useState(state.settings.aiMaxBudgetUsd ?? 1);
  const [aiChecks, setAiChecks] = useState({});
  const [checkingAi, setCheckingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiStatus = aiChecks[aiProvider] || null;
  const aiName = aiProvider === 'codex' ? 'Codex' : 'Claude';
  const savedProvider = state.settings.aiProvider || 'auto';
  const validAiSettings = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(aiModel) && Number.isFinite(Number(aiMaxBudgetUsd)) && Number(aiMaxBudgetUsd) >= 0.01 && Number(aiMaxBudgetUsd) <= 100;

  useEffect(() => {
    setAiProvider(state.settings.aiProvider || 'auto');
    setAiModel(state.settings.aiModel || 'claude-opus-5-5');
    setAiMaxBudgetUsd(state.settings.aiMaxBudgetUsd ?? 1);
  }, [state.settings.aiProvider, state.settings.aiModel, state.settings.aiMaxBudgetUsd]);

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

  useEffect(() => { setImageCheck(null); }, [imagesConfigured]);

  async function saveImageCredential() {
    if (imageBusy || !imageKey.trim()) return;
    setImageAction('save'); setImageError('');
    try {
      const saved = await onSaveKey('OPENAI_API_KEY', imageKey.trim());
      if (!saved) throw new Error('not-saved');
      setImageKey(''); setImageCheck(null);
    } catch { setImageError('Could not save the image credential. Your entry is still here; please try again.'); }
    finally { setImageAction(''); }
  }
  async function removeImageCredential() {
    if (imageBusy) return;
    setImageAction('remove'); setImageError('');
    try {
      const cleared = await onClearKey('OPENAI_API_KEY');
      if (cleared === null) return; // the person kept the key
      if (!cleared) throw new Error('not-cleared');
      setImageCheck(null);
    } catch { setImageError('Could not remove the saved image credential. Please try again.'); }
    finally { setImageAction(''); }
  }
  async function checkImages() {
    if (imageBusy || !onTestImages) return;
    setImageAction('check'); setImageError(''); setImageCheck(null);
    try {
      const result = await onTestImages();
      if (!result) throw new Error('No connection result was returned. Please try again.');
      setImageCheck(result);
    } catch (failure) { setImageError(failure?.message || 'Could not check image access. Please try again.'); }
    finally { setImageAction(''); }
  }

  function updateSheetField(key, value) {
    setSheetForm((current) => ({ ...current, [key]: value }));
  }

  async function checkAi() {
    setCheckingAi(true);
    setAiError('');
    try {
      const result = onCheckAi ? await onCheckAi({ provider: aiProvider, model: aiModel, models: [...new Set([aiModel, ...Object.values(DEFAULT_PROGRAM_AI.models)])] })
        : aiProvider === 'codex' && onCheckCodex ? await onCheckCodex()
        : { ok: false, error: 'This app version cannot check Claude. Reopen the updated app.' };
      setAiChecks((current) => ({ ...current, [aiProvider]: result }));
    } catch (err) {
      setAiChecks((current) => ({ ...current, [aiProvider]: { ok: false, error: err.message || String(err) } }));
    } finally {
      setCheckingAi(false);
    }
  }

  async function saveAi() {
    if (!validAiSettings || savingAi) return;
    setSavingAi(true);
    setAiError('');
    try {
      const result = await onSaveSettings({ aiProvider, aiModel, aiMaxBudgetUsd: Number(aiMaxBudgetUsd) });
      if (!result) setAiError('AI settings could not be saved. Your choices are still here; please try again.');
    } catch (err) {
      setAiError(err.message || 'AI settings could not be saved.');
    } finally { setSavingAi(false); }
  }

  const sourceSettings = (
      <div className="field-grid two">
        <label>Apify API token
          <div className="inline">
            <input aria-label="Apify API token" autoComplete="off" type="password" value={token} placeholder={state.keys.APIFY_API_TOKEN ? 'Stored securely on this device' : 'Paste token'} onChange={(event) => setToken(event.target.value)} />
            <Button disabled={busy || !token} onClick={() => { onSaveKey('APIFY_API_TOKEN', token).then((saved) => { if (saved) setToken(''); }); }}>Save</Button>
            <Button className="ghost" disabled={busy} onClick={() => onClearKey('APIFY_API_TOKEN')}>Clear</Button>
          </div>
        </label>
        <label>Maximum rows to download
          <div className="inline">
            <input aria-label="Maximum rows to download" type="number" min="1" max="10000" value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
            <Button disabled={busy || !Number.isInteger(Number(maxItems)) || Number(maxItems) < 1 || Number(maxItems) > 10000} onClick={() => onSaveSettings({ maxItems })}>Save</Button>
          </div><small>Actor input controls scraping volume and cost. This limits the rows downloaded.</small>
        </label>

      </div>
  );

  return (
    <section className="panel full settings-view">
      <div className="panel-head">
        <div><h3>Connect your tools</h3><p>Connect source collection, writing, and image generation in one place.</p></div>
        <div className="button-row">
          <Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys.APIFY_API_TOKEN ? 'Apify saved' : 'Apify missing'}</Badge>
          <Badge tone={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'ready' : 'neutral'}>{state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Sheets saved' : 'Sheets optional'}</Badge>
        </div>
      </div>
      {setupApi?.openSetupFile && <section className="settings-block settings-setup" aria-labelledby="settings-setup-title"><div className="panel-head"><div><h3 id="settings-setup-title">Share your setup</h3><p>Give a teammate this workspace's research program and knowledge in one file, or load one they shared with you.</p></div></div><SetupShare api={setupApi} onOpenPrograms={onOpenPrograms} /></section>}
      {semrush && <section className="settings-block settings-sources" aria-labelledby="settings-sources-title"><div className="panel-head"><div><h3 id="settings-sources-title">Source collection</h3><p>Connect Apify to research the accounts and communities you choose.</p></div><Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'neutral'}>{state.keys.APIFY_API_TOKEN ? 'Credential saved' : 'Setup needed'}</Badge></div>{sourceSettings}</section>}
      <section className="settings-block" aria-labelledby="settings-ai-title">
        <div className="panel-head"><div><h3 id="settings-ai-title">Writing & research</h3><p>Claude writes the research, reports and drafts. Reach it through the Claude app on this Mac or an Anthropic API key.</p></div><Badge tone={aiChecks[savedProvider]?.ok ? 'ready' : 'neutral'}>{ROUTE_BADGE[savedProvider] || 'Claude'}</Badge></div>
        {aiProvider !== 'codex' && <fieldset className="settings-route" disabled={busy || savingAi || checkingAi}><legend>How to reach Claude</legend>
          {CLAUDE_ROUTES.map(([value, title, detail]) => <label className="settings-route-option" key={value}><input type="radio" name="settings-ai-route" value={value} checked={aiProvider === value} onChange={() => { setAiProvider(value); setAiError(''); }} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}
        </fieldset>}
        {(aiProvider === 'auto' || aiProvider === 'claude-api') && <div className="settings-api-key">
          <label htmlFor="settings-anthropic-key">Anthropic API key{state.keys.ANTHROPIC_API_KEY ? <span className="settings-key-saved"> · saved</span> : null}</label>
          <div className="inline"><input id="settings-anthropic-key" type="password" autoComplete="off" spellCheck="false" value={anthropicKey} disabled={busy} placeholder={state.keys.ANTHROPIC_API_KEY ? 'Enter a replacement key' : 'sk-ant-…'} onChange={(event) => setAnthropicKey(event.target.value)} /><Button type="button" disabled={busy || !anthropicKey.trim()} onClick={() => { onSaveKey('ANTHROPIC_API_KEY', anthropicKey.trim()).then((saved) => { if (saved) setAnthropicKey(''); }); }}>Save key</Button>{state.keys.ANTHROPIC_API_KEY && <Button type="button" className="ghost" disabled={busy} onClick={() => onClearKey('ANTHROPIC_API_KEY')}>Clear</Button>}</div>
          <small>{aiProvider === 'auto' ? 'Used only when the Claude app is missing, signed out or out of date. ' : ''}Stored encrypted in this Mac's keychain and sent only to Anthropic. Usage is billed to the key's account at list prices.</small>
        </div>}
        <div className="field-grid two">
          {aiProvider !== 'codex' ? <>
            <label>Default Claude model<input aria-label="Claude model" value={aiModel} disabled={busy || savingAi} spellCheck="false" onChange={(event) => setAiModel(event.target.value.trim())} /><small>For chat, reports and drafts. Research programs choose a model per stage.</small></label>
            <label>Claude budget per request (USD)<input aria-label="Claude budget per request (USD)" type="number" min="0.01" max="100" step="0.01" value={aiMaxBudgetUsd} disabled={busy || savingAi} onChange={(event) => setAiMaxBudgetUsd(event.target.value)} /><small>A ceiling for a single chat, report or draft request.</small></label>
          </> : <p>Codex uses its existing CLI configuration. Claude settings are kept for when you switch back.</p>}
        </div>
        <div className="settings-ai-check"><Button type="button" disabled={busy || checkingAi || savingAi} onClick={checkAi}>{checkingAi ? 'Checking…' : `Check ${aiName}`}</Button><small>{aiProvider === 'codex' ? 'Checks the Codex CLI connection.' : 'Finds the route and confirms the models research uses. Through the Claude app this sends one tiny request per model (a few cents); the API check is free.'}</small></div>
        {aiStatus && <AiCheckResult result={aiStatus} />}
        {aiError && <p className="error-line" role="alert">{aiError}</p>}
        <div className="button-row"><Button type="button" disabled={busy || savingAi || !validAiSettings} onClick={saveAi}>{savingAi ? 'Saving…' : 'Save AI settings'}</Button><small>{aiProvider !== savedProvider ? 'Save to switch to this route for new requests.' : 'Save to apply these choices to new requests.'}</small></div>
        <details className="settings-provider-options" open={aiProvider === 'codex' ? true : undefined}><summary>Advanced writing provider <span>Optional Codex CLI</span></summary><label className="cs-check settings-codex"><input type="checkbox" checked={aiProvider === 'codex'} disabled={busy || checkingAi || savingAi} onChange={(event) => { setAiProvider(event.target.checked ? 'codex' : 'auto'); setAiError(''); }} /><span>Use the OpenAI Codex CLI instead of Claude<small>Research programs are tuned for Claude; Codex ignores the per-stage models.</small></span></label></details>
      </section>
      <section className="settings-block settings-images" aria-labelledby="settings-images-title">
        <div className="settings-image-heading"><span className="settings-image-icon"><ImageIcon size={21} aria-hidden="true" /></span><div><h3 id="settings-images-title">Image generation</h3><p>Create original campaign visuals with OpenAI Images.</p></div><Badge tone={imagesConfigured ? 'ready' : 'neutral'}>{imagesConfigured ? 'Credential saved' : 'Setup needed'}</Badge></div>
        <p className="settings-image-intro">Your writing provider stays separate. Images use an OpenAI API credential and have their own API usage and billing.</p>
        <label htmlFor="settings-image-key">OpenAI API key</label>
        <div className="settings-image-key-row"><span className="settings-image-key-input"><KeyRound size={15} aria-hidden="true" /><input id="settings-image-key" aria-label="OpenAI API key" type="password" autoComplete="off" spellCheck="false" value={imageKey} disabled={imageBusy} placeholder={imagesConfigured ? 'Enter a replacement credential' : 'Paste your OpenAI API key'} onChange={event => { setImageKey(event.target.value); setImageError(''); }} /></span><Button type="button" disabled={imageBusy || !imageKey.trim()} onClick={saveImageCredential}>{imageAction === 'save' ? 'Saving…' : 'Save image key'}</Button>{imagesConfigured && <Button type="button" className="ghost" disabled={imageBusy} onClick={removeImageCredential}>Remove saved key</Button>}</div>
        <p className="settings-image-storage">Desktop credentials are stored on this computer. In a hosted studio, image credentials are configured on the backend and never sent to browsers.</p>
        <div className="settings-image-check"><Button type="button" className="ghost" disabled={imageBusy || !imagesConfigured || !onTestImages} onClick={checkImages}>{imageAction === 'check' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}{imageAction === 'check' ? 'Checking image access…' : 'Check image access'}</Button><small>Checks model access without generating an image or starting a paid generation.</small></div>
        {imageCheck && <div className={`settings-image-receipt ${imageCheck.accessVerified ? 'verified' : ''}`} role="status"><strong>{imageCheck.accessVerified ? 'Image model access confirmed' : imageCheck.configured ? 'Image access needs attention' : 'Image credential is not configured'}</strong>{imageCheck.model && <span>Model: {imageCheck.model}</span>}{imageCheck.message && <p>{imageCheck.message}</p>}<small>No image was generated by this check. Generation is verified when an image request completes.</small></div>}
        {imageError && <p className="error-line" role="alert">{imageError}</p>}
      </section>
      <details className="settings-health"><summary>Connection diagnostics</summary><div className="readiness-grid">
        {readinessItems(state, meta, aiChecks.codex).map((original) => original.id === 'codex' ? { id: 'ai', label: aiProvider === 'codex' ? 'Codex CLI' : 'Claude', tone: aiStatus?.ok ? 'ready' : aiStatus?.error ? 'warning' : 'neutral', detail: aiStatus?.ok ? routeSummary(aiStatus) : aiStatus?.error || 'Not checked yet.' } : original).map((item) => (
          <article className="readiness-card" key={item.id}>
            <Badge tone={item.tone}>{item.label}</Badge>
            <p>{short(item.detail, 160)}</p>
          </article>
        ))}
      </div>
      </details>
      {!semrush && sourceSettings}
      <details className="settings-block"><summary>Google Docs <span>Import private research documents</span></summary>
        <p>Connect a Google OAuth access token with Docs read permission for imports and Drive file creation permission for delivery. Tokens expire; reconnect when prompted. You can also upload a DOCX file without a Google connection.</p>
        {state.keys.GOOGLE_SHEETS_WEBHOOK_URL && <p><small>Publishing to Google Drive uses your Sheets bridge, so this token is only needed for imports.</small></p>}
        <label>Google Docs access token<div className="inline"><input aria-label="Google Docs access token" type="password" autoComplete="off" value={docsToken} placeholder={state.keys.GOOGLE_DOCS_ACCESS_TOKEN ? 'Stored securely on this device' : 'Paste an authorized access token'} onChange={event => setDocsToken(event.target.value)}/><Button disabled={busy || !docsToken} onClick={() => onSaveKey('GOOGLE_DOCS_ACCESS_TOKEN', docsToken).then(saved => { if (saved) setDocsToken(''); })}>Connect Docs</Button><Button className="ghost" disabled={busy} onClick={() => onClearKey('GOOGLE_DOCS_ACCESS_TOKEN')}>Disconnect</Button></div></label>
      </details>
      {onSaveMondayBoard && <details className="settings-block settings-monday" open={Boolean(state.monday?.connected && !state.monday?.boardId) || undefined}><summary>Monday.com <span>{state.monday?.boardName ? `Trend board syncs to ${state.monday.boardName}` : state.monday?.connected ? 'Connected · choose a board' : 'Mirror the trend board'}</span></summary>
        <p>Each trend on the Trend board becomes a Monday.com item, and its Status column follows the card: Potential trend, Approved, In production, Ready to use, or Passed. Use a personal API token from Monday.com (your avatar → Developers → My access tokens).</p>
        <label>Monday.com API token<div className="inline"><input aria-label="Monday.com API token" type="password" autoComplete="off" value={mondayToken} placeholder={state.keys.MONDAY_API_TOKEN ? 'Stored securely on this device' : 'Paste a personal API token'} onChange={event => setMondayToken(event.target.value)}/><Button disabled={busy || !mondayToken} onClick={() => onSaveKey('MONDAY_API_TOKEN', mondayToken.trim()).then(saved => { if (saved) setMondayToken(''); })}>Connect</Button><Button className="ghost" disabled={busy || !state.keys.MONDAY_API_TOKEN} onClick={() => onClearKey('MONDAY_API_TOKEN')}>Disconnect</Button></div></label>
        <label>Board ID<div className="inline"><input aria-label="Monday.com board ID" inputMode="numeric" value={mondayBoard} placeholder="The number in the board’s URL, e.g. 1234567890" onChange={event => setMondayBoard(event.target.value.replace(/[^0-9]/g, ''))}/><Button disabled={busy || !state.keys.MONDAY_API_TOKEN || !mondayBoard} onClick={() => onSaveMondayBoard({ boardId: mondayBoard })}>Use this board</Button>{state.monday?.boardId && <Button className="ghost" disabled={busy} onClick={() => { setMondayBoard(''); onClearMondayBoard(); }}>Forget board</Button>}</div></label>
        {state.monday?.boardId && <p className="settings-note">Board <strong>{state.monday.boardName || state.monday.boardId}</strong> · {state.monday.statusColumnId ? 'Status column found' : 'No Status column yet'} · {state.monday.notesColumnId ? 'Long text column found for trend notes' : 'Add a Long text column to include trend notes'}{state.monday.syncedCount ? ` · ${state.monday.syncedCount} trends synced` : ''}</p>}
        {(state.monday?.warnings || []).map(warning => <p key={warning} className="settings-note">{warning}</p>)}
      </details>}
      <details className="settings-block"><summary>Google Sheets <span>Optional integration</span></summary>
        <div className="panel-head compact">
          <div><h3>Google Sheets bridge</h3><p>Use an Apps Script webhook to archive, clear, import, and write shared weekly sheets, and to create Google Sheets and Docs in your Drive.</p></div>
        </div>
        <div className="field-grid two">
          <label>Apps Script webhook URL
            <div className="inline">
              <input aria-label="Apps Script webhook URL" autoComplete="off" type="password" value={sheetWebhook} placeholder={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Stored securely on this device' : 'Paste Apps Script web app URL'} onChange={(event) => setSheetWebhook(event.target.value)} />
              <Button disabled={busy || !sheetWebhook} onClick={() => { onSaveKey('GOOGLE_SHEETS_WEBHOOK_URL', sheetWebhook).then((saved) => { if (saved) setSheetWebhook(''); }); }}>Save</Button>
              <Button className="ghost" disabled={busy} onClick={() => onClearKey('GOOGLE_SHEETS_WEBHOOK_URL')}>Clear</Button>
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
      <details className="settings-block"><summary>Local files & workspace details</summary><div className="button-row">
        <Button className="ghost" disabled={busy} onClick={onOpenDataFolder}>Open data folder</Button>
        <Button className="ghost" disabled={busy} onClick={onOpenWorkspace}>Open workspace</Button>
      </div>
      <JsonBlock value={{ app: meta?.name, version: meta?.version, dataRoot: meta?.dataRoot }} /></details>
    </section>
  );
}

