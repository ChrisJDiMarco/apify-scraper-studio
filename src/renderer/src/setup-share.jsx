import React, { useState } from 'react';
import { CircleAlert, Download, FileCheck2, KeyRound, LoaderCircle, Upload } from 'lucide-react';
import { Button, number } from './ui.jsx';
import './setup-share.css';

// Share a configured workspace: the owner exports one file; a teammate previews and imports it in one step.
// The main process keeps an opened file (and any key in it) until the import is confirmed.
const plural = (count, word, many = `${word}s`) => `${number(count)} ${count === 1 ? word : many}`;
const money = (value) => `$${Number(value || 0).toFixed(Number(value) % 1 ? 2 : 0)}`;
function programLine(program) {
  const sources = [[program.sources?.x, 'X account'], [program.sources?.linkedin, 'LinkedIn account'], [program.sources?.reddit, 'subreddit']].filter(([count]) => count).map(([count, word]) => plural(count, word));
  const budgets = program.budgets ? `${money(program.budgets.collectionUsd)} collection + ${money(program.budgets.aiUsd)} AI per run` : '';
  const schedule = program.schedule && program.schedule.frequency !== 'manual' ? `${program.schedule.label || program.schedule.frequency}${program.schedule.arrivesPaused ? ' · arrives paused' : ''}` : '';
  return [sources.join(' · '), program.targetPerPlatform ? `${number(program.targetPerPlatform)} posts per platform` : '', budgets, schedule].filter(Boolean).join(' · ');
}
function SetupContents({ summary }) {
  const workspace = summary?.workspace || {}; const products = workspace.products || {};
  const rows = [
    ['Workspace', `${workspace.name || 'Workspace'}${workspace.editionLabel && workspace.editionLabel !== workspace.name ? ` · ${workspace.editionLabel}` : ''}`],
    ['Brand knowledge', workspace.knowledgeFields?.length ? plural(workspace.knowledgeFields.length, 'field') : 'None'],
    ['Approved products', products.total ? [plural(products.total, 'product'), products.enterprise?.length ? `${products.enterprise.length} Enterprise` : '', products.selfServe?.length ? `${products.selfServe.length} self-serve` : ''].filter(Boolean).join(' · ') : 'None'],
    ['Taxonomy', workspace.taxonomy ? plural(workspace.taxonomy.categories, 'category', 'categories') : 'None'],
    ['Reference documents', workspace.referenceDocs?.length ? workspace.referenceDocs.map((doc) => doc.title).join(' · ') : 'None'],
  ];
  return <div className="setup-contents">
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {summary?.programs?.length > 0 && <ul className="setup-programs" aria-label="Research programs in this file">{summary.programs.map((program) => <li key={program.id}><strong>{program.name}{program.action === 'update' ? <span> · updates the existing program</span> : null}</strong><small>{programLine(program)}</small></li>)}</ul>}
  </div>;
}

export function SetupShare({ api, mode = 'full', onImported, onOpenPrograms }) {
  const [includeToken, setIncludeToken] = useState(false);
  const [preview, setPreview] = useState(null);
  const [saveToken, setSaveToken] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  if (!api?.openSetupFile) return null;
  const act = async (kind, task) => { setBusy(kind); setError(''); try { await task(); } catch (failure) { setError(String(failure?.message || failure)); } finally { setBusy(''); } };
  const exportSetup = () => act('export', async () => { const done = await api.exportSetup({ includeApifyToken: includeToken }); if (!done?.cancelled) { setPreview(null); setResult({ kind: 'exported', ...done }); } });
  const openSetup = () => act('open', async () => {
    const opened = await api.openSetupFile(); if (opened?.cancelled) return;
    setResult(null); setPreview(opened); setSaveToken(Boolean(opened.apifyTokenIncluded && !opened.apifyTokenSaved));
  });
  const applySetup = () => act('apply', async () => {
    const done = await api.applySetup({ token: preview.token, saveApifyToken: Boolean(preview.apifyTokenIncluded && saveToken) });
    setPreview(null); setResult({ kind: 'imported', ...done }); onImported?.(done);
  });
  const spinner = (kind, Icon) => (busy === kind ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />);
  const importButton = <Button type="button" disabled={Boolean(busy)} onClick={openSetup}>{spinner('open', Upload)}Import setup…</Button>;

  return <div className={`setup-share setup-share-${mode}`}>
    {mode === 'full' ? <div className="setup-share-actions">
      <div className="setup-share-action">
        <h4>Export this workspace</h4>
        <p>One file with the brand knowledge, approved products, taxonomy, reference documents and research programs. Runs, collected posts and reports stay on this Mac.</p>
        <label className="setup-share-check"><input type="checkbox" checked={includeToken} disabled={Boolean(busy)} onChange={(event) => setIncludeToken(event.target.checked)} /><span>Include the shared Apify token<small>For a team that shares one Apify account. Anyone holding the file can spend on that account, so share it only through internal channels.</small></span></label>
        <Button type="button" className="ghost" disabled={Boolean(busy)} onClick={exportSetup}>{spinner('export', Download)}Export setup…</Button>
      </div>
      <div className="setup-share-action">
        <h4>Import a setup file</h4>
        <p>Load a teammate's workspace setup. You'll see exactly what changes before anything is imported, and schedules arrive paused.</p>
        {importButton}
      </div>
    </div> : !preview && !result && <div className="setup-share-banner"><FileCheck2 size={20} aria-hidden="true" /><div><strong>Got a setup file from your team?</strong><p>Import it to load the research program, brand knowledge, products and taxonomy in one step.</p></div>{importButton}</div>}

    {preview && <div className="setup-share-preview" role="region" aria-label="Setup to import">
      <div className="setup-share-preview-head"><strong>{preview.fileName}</strong><small>{preview.summary?.exportedAt ? `Exported ${new Date(preview.summary.exportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}{preview.summary?.appVersion ? ` · app ${preview.summary.appVersion}` : ''}</small></div>
      <SetupContents summary={preview.summary} />
      {preview.summary?.changes?.length > 0 && <ul className="setup-share-changes">{preview.summary.changes.map((line) => <li key={line}>{line}</li>)}</ul>}
      {preview.warnings?.length > 0 && <ul className="setup-share-warnings">{preview.warnings.map((line) => <li key={line}><CircleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
      {preview.apifyTokenIncluded && <label className="setup-share-check"><input type="checkbox" checked={saveToken} disabled={Boolean(busy)} onChange={(event) => setSaveToken(event.target.checked)} /><span><KeyRound size={13} aria-hidden="true" /> Save the Apify token from this file{preview.apifyTokenSaved ? ' (replaces the one saved on this Mac)' : ''}<small>Stored encrypted in this Mac's keychain, like a token you paste in Settings.</small></span></label>}
      <div className="setup-share-buttons"><Button type="button" disabled={Boolean(busy)} onClick={applySetup}>{spinner('apply', FileCheck2)}Import this setup</Button><Button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => setPreview(null)}>Cancel</Button></div>
    </div>}

    {result?.kind === 'exported' && <div className="setup-share-result" role="status"><strong>Saved {result.fileName}</strong><p>{[result.summary?.programs?.length ? plural(result.summary.programs.length, 'research program') : '', result.summary?.workspace?.products?.total ? plural(result.summary.workspace.products.total, 'product') : '', result.includesApifyToken ? 'includes the Apify token' : 'no keys included'].filter(Boolean).join(' · ')}.</p></div>}
    {result?.kind === 'imported' && <div className="setup-share-result" role="status"><strong>Imported {result.fileName}</strong><p>{[result.summary?.workspace?.name ? `Workspace: ${result.summary.workspace.name}` : '', result.programIds?.length ? plural(result.programIds.length, 'research program') : '', result.apifyTokenSaved ? 'Apify token saved' : ''].filter(Boolean).join(' · ')}. Next: Settings → Writing & research → Check Claude, then start with a small run.</p>{onOpenPrograms && <Button type="button" className="ghost" onClick={onOpenPrograms}>Open Research programs</Button>}</div>}
    {error && <p className="setup-share-error" role="alert">{error}</p>}
  </div>;
}
