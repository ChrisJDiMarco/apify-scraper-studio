import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleStop, Clapperboard, ClipboardCopy, CloudUpload, Download, ExternalLink, FileText, Folder, FolderOpen, Image as ImageIcon, LayoutTemplate, Link2, LoaderCircle, PenLine, RefreshCw, Search, Sparkles, TriangleAlert, Upload, Wand2, X } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { AssetEditor, canEditAsset, useUnsavedGuard } from './asset-editor.jsx';
import { formatDay, useCan, useViewer, writeProps } from './viewer.js';
import { formatDate, number, withViewTransition } from './ui.jsx';

// Assets in Simple mode. Channel assets made from a report (the n8n "Generate All Channel Assets" workflow) live in
// folders: one per report, one inside it per run, one per channel team inside that, as n8n filed them in Drive.
// Every picture, from those runs, Create content and Ask AI, is in the gallery below. Buttons follow the person's
// role (useCan): an editor makes and edits but never sees Settings, and nobody sees a button the server would refuse.
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const sentence = (value) => String(value || '').replace(/^./, (letter) => letter.toUpperCase());
const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
const modelName = (model) => String(model || '').replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const SOURCE_LABEL = { trend: 'From a trends report', report: 'From a report', 'google-doc': 'From a Google Doc', file: 'From a document', text: 'From pasted text' };
// What each picture set sends the image model besides its prompt (Settings → Brand reference images).
const referenceTitle = (references) => (references?.style || references?.logo ? `Sends ${[references.style ? plural(references.style, 'style example') : '', references.logo ? 'the approved logo' : ''].filter(Boolean).join(' and ')}` : 'No brand reference images yet');
function referenceHint(items) {
  const sets = items.filter((item) => item.kind === 'image');
  const using = sets.filter((item) => item.references?.style || item.references?.logo).length; const logos = sets.filter((item) => item.references?.logo).length;
  return using ? `Brand reference images: ${using} of ${plural(sets.length, 'picture set')}${logos ? `, ${logos} with the approved logo` : ''}.` : 'No brand reference images yet, so pictures follow the brand colors and leave the footer clean.';
}
const MAX_SOURCE_CHARS = 250000;

function runSummary(run) {
  const total = list(run.jobs).length; const done = list(run.jobs).filter((job) => job.status === 'succeeded').length;
  if (run.status === 'queued') return 'Starting…';
  if (run.status === 'running') return `Making assets · ${done} of ${total} ready`;
  if (run.status === 'succeeded') return `${plural(total, 'asset')} ready`;
  if (run.status === 'cancelled') return `Stopped · ${done} of ${total} ready`;
  return `${done} of ${total} ready · ${total - done} need${total - done === 1 ? 's' : ''} another try`;
}
// Errors arrive as written by the main process; keep them short enough to read in a row.
const brief = (value) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > 140 ? `${text.slice(0, 137)}…` : text; };
function jobLine(job, asset, live = true) {
  if (job.status === 'succeeded') return asset?.title || 'Ready';
  if (job.status === 'running') return job.kind === 'image' ? 'Drawing…' : 'Writing…';
  if (job.status === 'queued') return live ? 'Waiting its turn' : 'Not started';
  if (job.status === 'cancelled') return 'Stopped before it finished';
  // A draft that failed its checks twice reports the field that broke ("output.sections…"); say it plainly.
  return /^output\./.test(String(job.error || '')) ? 'Didn’t pass its checks after a second try' : brief(job.error) || 'Needs another try';
}

export function SimpleAssets({ api, web, kitRuns, assets, studioImages, sources, request, onRequestDone, cache, onCache, action, busy, imagesReady, googleReady, askAdmin = 'an admin', onDraft, onAsk, onSettings, onOpenReport, onViewChange }) {
  const can = useCan();
  const viewer = useViewer();
  const canMake = can('createAssetKit');
  const canPicture = can('createHelpImage') && Boolean(onDraft);
  // Without Settings, the way to pictures is a person: say who.
  const picturesOff = `Pictures are off for your team. ${askAdmin} can turn them on.`;
  const [place, setPlace] = useState({ folder: '', runId: '' });
  const [creating, setCreating] = useState(null);
  const [reading, setReading] = useState(null); // a written asset open in the viewer
  const [helpImages, setHelpImages] = useState(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null); // a picture open in the lightbox
  const [saved, setSaved] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api.listHelpImages ? api.listHelpImages() : []).then((rows) => { if (!cancelled) setHelpImages(list(rows)); }).catch(() => { if (!cancelled) setHelpImages([]); });
    return () => { cancelled = true; };
  }, []);
  // Requests from elsewhere: the asset dialog (from a report you were reading, or Ask AI), a folder, or Assets itself.
  useEffect(() => {
    if (!request) return;
    if (request.open === 'folder' || request.open === 'home') { setCreating(null); setReading(null); setOpen(null); setPlace({ folder: request.open === 'folder' ? request.folderKey || '' : '', runId: '' }); }
    else setCreating(request);
    onRequestDone?.();
  }, [request?.key]);

  const folders = useMemo(() => {
    const groups = new Map();
    for (const run of [...kitRuns].sort(newest)) { const key = run.kit.sourceKey; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(run); }
    return [...groups.entries()].map(([key, runs]) => {
      const ids = new Set(runs.map((run) => run.id)); const files = assets.filter((asset) => ids.has(asset.runId));
      return { key, runs, latest: runs[0], title: runs[0].kit.sourceTitle || runs[0].title || 'Report', kind: runs[0].kit.sourceKind, files, pictures: files.filter((asset) => asset.kind === 'image').sort(newest), live: runs.some((run) => ACTIVE.has(run.status)) };
    });
  }, [kitRuns, assets]);
  const folder = folders.find((entry) => entry.key === place.folder) || null;
  useEffect(() => { onViewChange?.(folder ? folder.title : ''); }, [folder?.key]);
  const kitFolderOf = useMemo(() => new Map(kitRuns.flatMap((run) => list(run.jobs).map((job) => [`${run.id}:${job.id}`, job.folder]))), [kitRuns]);

  const items = [
    ...studioImages.map((asset) => ({ key: `studio:${asset.id}`, id: asset.id, source: 'studio', kind: asset.kind === 'video' ? 'video' : 'image', title: asset.title || 'Campaign visual', createdAt: asset.createdAt, label: kitFolderOf.get(`${asset.runId}:${asset.deliverableId}`) || sentence(asset.channel) || 'Campaign visual' })),
    ...list(helpImages).map((image) => ({ key: `help:${image.id}`, id: image.id, source: 'help', kind: 'image', title: image.title, createdAt: image.createdAt, prompt: image.prompt, size: image.size, label: 'Made in Ask AI' })),
  ].sort(newest);
  const hasVideo = items.some((item) => item.kind === 'video');
  const shown = items.filter((item) => filter === 'all' || (filter === 'video' ? item.kind === 'video' : filter === item.source));
  // Thumbnails load a few at a time, newest first, and are kept for the session; folders reuse them.
  useEffect(() => {
    let cancelled = false;
    const queue = items.filter((item) => item.kind === 'image' && !cache[item.key]);
    async function worker() {
      while (!cancelled && queue.length) {
        const item = queue.shift();
        try {
          const url = item.source === 'help' ? (await api.readHelpImage({ id: item.id }))?.dataUrl : (await api.readStudioAsset({ assetId: item.id }))?.imageDataUrl;
          if (!cancelled && typeof url === 'string' && url.startsWith('data:image/')) onCache(item.key, url);
        } catch { /* the card keeps its placeholder and still opens the file */ }
      }
    }
    Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [items.map((item) => item.key).join('|')]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  async function download(item) {
    setSaved('');
    if (item.source === 'help') { const result = await action(() => api.saveHelpImage({ id: item.id })); if (result && !result.cancelled) setSaved(item.key); }
    else await action(() => api.openStudioAsset({ assetId: item.id }), web ? 'Download started.' : '');
  }
  const counts = { all: items.length, studio: items.filter((item) => item.source === 'studio').length, help: items.filter((item) => item.source === 'help').length, video: items.filter((item) => item.kind === 'video').length };
  const newPicture = () => (imagesReady ? onDraft('Create a picture of ') : onSettings?.());
  const go = (next) => withViewTransition(() => setPlace(next));
  // Written assets open in order of the run's folders, so ← and → page through the set.
  function openFile(asset, run) { setReading({ asset, run }); }
  function moveFile(step) {
    if (!reading) return;
    const order = list(reading.run.jobs).filter((job) => job.kind !== 'image').map((job) => assets.find((asset) => asset.runId === reading.run.id && asset.deliverableId === job.id)).filter(Boolean);
    const next = order[order.findIndex((asset) => asset.id === reading.asset.id) + step];
    if (next) setReading({ asset: next, run: reading.run });
  }
  function openPicture(asset, run) { setOpen({ key: `studio:${asset.id}`, id: asset.id, source: 'studio', kind: 'image', title: asset.title, createdAt: asset.createdAt, label: kitFolderOf.get(`${run.id}:${asset.deliverableId}`) || sentence(asset.channel) }); }
  function startAgain(entry) {
    const kind = entry.latest.kit.sourceKind;
    if (kind === 'google-doc') setCreating({ key: Date.now(), mode: 'link', link: entry.latest.kit.sourceUrl || '' });
    else if (entry.latest.kit.reportAssetId && ['trend', 'report'].includes(kind)) setCreating({ key: Date.now(), source: { kind: 'report', assetId: entry.latest.kit.reportAssetId } });
    else setCreating({ key: Date.now(), source: { kind: 'run', runId: entry.latest.id } });
  }
  function created(run) { setCreating(null); if (run?.kit?.sourceKey) go({ folder: run.kit.sourceKey, runId: run.id }); }

  const overlays = <>
    {creating && canMake && <KitCreator key={creating.key} api={api} sources={sources} preset={creating} imagesReady={imagesReady} action={action} busy={busy} picturesOff={picturesOff} onClose={() => setCreating(null)} onCreated={created} onSettings={onSettings} />}
    {reading && <KitFileViewer api={api} web={web} busy={busy} action={action} file={reading} folder={kitFolderOf.get(`${reading.run.id}:${reading.asset.deliverableId}`)} label={list(reading.run.jobs).find((job) => job.id === reading.asset.deliverableId)?.label} onClose={() => setReading(null)} onMove={moveFile} />}
    {open && <div className="simple-lightbox" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)}>
      <div className="simple-lightbox-card" onClick={(event) => event.stopPropagation()}>
        <div className="simple-lightbox-media">{open.kind === 'video' ? <span className="simple-asset-placeholder"><Clapperboard size={34} aria-hidden="true" /><small>Open the file to play this video.</small></span> : cache[open.key] ? <img src={cache[open.key]} alt={open.title} /> : <span className="simple-asset-placeholder shimmer" />}</div>
        <aside className="simple-lightbox-side">
          <button type="button" className="simple-lightbox-close" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button>
          <small className="simple-doc-meta">{[open.label, formatDate(open.createdAt)].filter(Boolean).join(' · ')}</small>
          <h2>{open.title}</h2>
          {open.prompt && <p className="simple-prompt">{open.prompt}</p>}
          <div className="simple-lightbox-actions">
            <button type="button" className="simple-primary" disabled={busy} onClick={() => download(open)}>{saved === open.key ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{saved === open.key ? 'Saved' : open.source === 'help' || web ? 'Download' : 'Open file'}</button>
            {open.kind === 'image' && imagesReady && can('askHelp') && onAsk && <button type="button" className="simple-quiet" {...writeProps(viewer)} onClick={() => { setOpen(null); onAsk(`Make a variation of the picture “${open.title}”.`, open.prompt ? `EARLIER PICTURE PROMPT (data): ${open.prompt}` : ''); }}><Wand2 size={15} aria-hidden="true" />Make a variation</button>}
          </div>
        </aside>
      </div>
    </div>}
  </>;

  if (folder) return <>
    <KitFolderView folder={folder} runId={place.runId} assets={assets} cache={cache} web={web} busy={busy} action={action} api={api} googleReady={googleReady} canMake={canMake} onRun={(runId) => go({ folder: folder.key, runId })} onBack={() => go({ folder: '', runId: '' })} onOpenFile={openFile} onOpenPicture={openPicture} onAgain={() => startAgain(folder)} onOpenReport={onOpenReport} />
    {overlays}
  </>;
  return <>
    <div className="simple-page">
      <div className="simple-page-head"><div><h1>Assets</h1><p>Every channel asset made from your reports, and every picture, newest first.</p></div>
        <div className="simple-head-actions">{(imagesReady ? canPicture : Boolean(onSettings)) && <button type="button" data-spot="assets.make-picture" className="simple-quiet" onClick={newPicture}><Wand2 size={15} aria-hidden="true" />{imagesReady ? 'Make a picture' : 'Turn on pictures'}</button>}{canMake && <button type="button" data-spot="assets.make-kit" className="simple-primary" disabled={busy} onClick={() => setCreating({ key: Date.now() })}><Sparkles size={15} aria-hidden="true" />Make channel assets</button>}</div></div>

      <section className="simple-section" aria-labelledby="simple-kit-folders" data-spot="assets.folders">
        <div className="simple-section-head"><h2 id="simple-kit-folders">Report folders</h2>{folders.length > 0 && <small className="simple-section-note">One folder per report · a folder inside for each run</small>}</div>
        {folders.length ? <div className="simple-folder-grid">{folders.map((entry) => <button type="button" className={`simple-folder${entry.live ? ' is-live' : ''}`} key={entry.key} data-spot="assets.folder" data-spot-item={entry.title} onClick={() => go({ folder: entry.key, runId: entry.latest.id })} aria-label={`Open the ${entry.title} folder`}>
          <span className="simple-folder-cover" aria-hidden="true">{entry.pictures.length ? entry.pictures.slice(0, 3).map((asset) => cache[`studio:${asset.id}`] ? <img key={asset.id} src={cache[`studio:${asset.id}`]} alt="" /> : <span key={asset.id} className="shimmer" />) : <span className="simple-folder-glyph"><Folder size={34} /></span>}</span>
          <span className="simple-folder-copy">
            <strong>{entry.title}</strong>
            <small>{entry.live ? <><LoaderCircle className="spin" size={13} aria-hidden="true" />{runSummary(entry.runs.find((run) => ACTIVE.has(run.status)))}</> : [plural(entry.runs.length, 'run'), plural(entry.files.length, 'file'), formatDate(entry.latest.createdAt)].join(' · ')}</small>
          </span>
        </button>)}</div>
          : <div className="simple-kit-intro">
            <span className="simple-kit-intro-art" aria-hidden="true"><Folder size={26} /><Folder size={26} /><Folder size={26} /></span>
            <div><strong>Turn one report into every channel asset</strong><p>Blog posts, the newsletter pack, search ads and a landing page, PR research, social captions and hero graphics, the affiliate pack, the enterprise brief, and the Backlinko, Exploding Topics and Search Engine Land pieces. Each run gets its own folder, split by channel team.</p></div>
            {canMake && <button type="button" className="simple-primary" disabled={busy} onClick={() => setCreating({ key: Date.now() })}>Choose a report<ArrowRight size={15} aria-hidden="true" /></button>}
          </div>}
      </section>

      <section className="simple-section" aria-labelledby="simple-pictures" data-spot="assets.pictures">
        <div className="simple-section-head"><h2 id="simple-pictures">Pictures</h2></div>
        {helpImages !== null && items.length > 0 && <div className="simple-filters is-tight" role="group" aria-label="Asset type" data-spot="assets.picture-types">{[['all', 'All'], ['studio', 'Campaign visuals'], ['help', 'Made in Ask AI'], ...(hasVideo ? [['video', 'Videos']] : [])].filter(([value]) => value === 'all' || counts[value]).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{number(counts[value])}</span></button>)}</div>}
        {helpImages === null ? <div className="simple-asset-grid" aria-busy="true">{[0, 1, 2].map((n) => <div className="simple-asset skeleton" key={n}><span className="simple-asset-frame" /></div>)}</div>
          : !items.length ? <div className="simple-empty"><ImageIcon size={22} aria-hidden="true" /><p>{imagesReady ? 'No pictures yet. Ask AI can make one for any trend or report, and channel asset runs draw hero graphics too.' : onSettings ? 'Add an OpenAI key in Settings and pictures can be made for your trends, reports and channel assets.' : picturesOff}</p>{(imagesReady ? canPicture : Boolean(onSettings)) && <button type="button" className="simple-quiet" onClick={newPicture}>{imagesReady ? 'Make your first picture' : 'Open Settings'}</button>}</div>
          : <div className="simple-asset-grid">{shown.map((item) => <button type="button" className="simple-asset" key={item.key} onClick={() => setOpen(item)} aria-label={`Open ${item.title}`}>
            <span className="simple-asset-frame">{item.kind === 'video' ? <span className="simple-asset-placeholder"><Clapperboard size={26} aria-hidden="true" /></span> : cache[item.key] ? <img src={cache[item.key]} alt="" loading="lazy" /> : <span className="simple-asset-placeholder shimmer" />}</span>
            <span className="simple-asset-copy"><strong>{item.title}</strong><small>{[item.label, formatDate(item.createdAt)].filter(Boolean).join(' · ')}</small></span>
          </button>)}</div>}
      </section>
    </div>
    {overlays}
  </>;
}

// One report's folder: a sub-folder per run on the left, the open run's channel folders on the right.
function KitFolderView({ folder, runId, assets, cache, web, busy, action, api, googleReady, canMake = true, onRun, onBack, onOpenFile, onOpenPicture, onAgain, onOpenReport }) {
  const run = folder.runs.find((entry) => entry.id === runId) || folder.runs[0];
  useEffect(() => { document.querySelector('.simple-main')?.scrollTo?.({ top: 0 }); }, [folder.key]);
  return <div className="simple-page simple-kit-page">
    <button type="button" className="simple-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />All assets</button>
    <div className="simple-page-head"><div><h1>{folder.title}</h1><p>{[SOURCE_LABEL[folder.kind] || 'From a report', plural(folder.runs.length, 'run'), plural(folder.files.length, 'file')].join(' · ')}</p></div>
      <div className="simple-head-actions">{folder.latest.kit.reportAssetId && ['trend', 'report'].includes(folder.kind) && <button type="button" data-spot="kit.report" className="simple-quiet" onClick={() => onOpenReport(folder.latest.kit.reportAssetId)}><FileText size={15} aria-hidden="true" />Read the report</button>}{canMake && <button type="button" data-spot="kit.again" className="simple-primary" disabled={busy} onClick={onAgain}><Sparkles size={15} aria-hidden="true" />Make another set</button>}</div></div>
    <div className="simple-kit-layout">
      <div className="simple-kit-runs" role="group" aria-label="Runs in this folder" data-spot="kit.runs">{folder.runs.map((entry) => <button type="button" key={entry.id} aria-current={entry.id === run.id ? 'true' : undefined} onClick={() => onRun(entry.id)}>
        <span className="simple-kit-run-glyph">{ACTIVE.has(entry.status) ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : entry.id === run.id ? <FolderOpen size={17} aria-hidden="true" /> : <Folder size={17} aria-hidden="true" />}</span>
        <span><strong>{formatDate(entry.createdAt)}</strong><small>{runSummary(entry)}</small></span>
      </button>)}</div>
      <KitRun key={run.id} run={run} assets={assets.filter((asset) => asset.runId === run.id)} cache={cache} web={web} busy={busy} action={action} api={api} googleReady={googleReady} onOpenFile={onOpenFile} onOpenPicture={onOpenPicture} />
    </div>
  </div>;
}

// One run's folder, laid out as n8n left it in Drive: a folder per channel team with that team's files.
function KitRun({ run, assets, cache, web, busy, action, api, googleReady, onOpenFile, onOpenPicture }) {
  const can = useCan();
  const viewer = useViewer();
  const jobs = list(run.jobs); const total = jobs.length; const done = jobs.filter((job) => job.status === 'succeeded').length; const unfinished = total - done;
  const live = ACTIVE.has(run.status);
  const channels = jobs.reduce((all, job) => { const name = job.folder || 'Other'; (all[name] ||= []).push(job); return all; }, {});
  const delivered = run.googleDelivery?.folderUrl || '';
  async function stop() { if (window.confirm('Stop making these assets? Finished ones are kept, and you can finish the rest later.')) await action(() => api.cancelStudioRun({ runId: run.id }), 'Stopped. Finished assets are kept.'); }
  async function finish() {
    // A retry needs room for what's left; finished assets are never paid for twice.
    const cap = Math.min(1000, Math.max(Number(run.maxBudgetUsd) || 0, Math.ceil((Number(run.reservedUsd) || 0) + unfinished * 2)));
    if (!window.confirm(`Finish the ${plural(unfinished, 'asset')} that didn’t make it?\n\nThis can spend up to ${money(Math.max(0, cap - (Number(run.reservedUsd) || 0)))} more. Finished assets aren’t made again.`)) return;
    await action(() => api.retryStudioRun({ runId: run.id, maxBudgetUsd: cap }), 'Finishing the rest. Assets appear here as they’re ready.');
  }
  return <section className="simple-kit-run" aria-label={run.kit.folderName}>
    <header className="simple-kit-run-head" data-spot="kit.run">
      <span className="simple-kit-run-icon"><FolderOpen size={22} aria-hidden="true" /></span>
      <div><h2>{run.kit.folderName}</h2><p>{[runSummary(run), run.costUsd > 0 ? `${money(run.costUsd)}${live ? ' so far' : ''}` : '', run.ai?.route === 'codex' ? 'Codex' : run.ai?.model ? modelName(run.ai.model) : ''].filter(Boolean).join(' · ')}</p></div>
    </header>
    {live && <div className="simple-kit-progress" role="progressbar" aria-label="Assets ready" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${Math.max(4, Math.round((done / Math.max(1, total)) * 100))}%` }} /></div>}
    <div className="simple-kit-run-actions">
      <button type="button" data-spot="kit.save" className="simple-primary" disabled={busy || !assets.length} onClick={() => action(() => api.saveAssetKitFolder({ runId: run.id }), web ? 'Download started.' : 'Saved to your Downloads folder.')}><Download size={15} aria-hidden="true" />{web ? 'Download folder' : 'Save folder'}</button>
      {googleReady && can('publishStudioRun') && <button type="button" data-spot="kit.drive" className="simple-quiet" title={live ? 'Available when the run finishes' : undefined} {...writeProps(viewer, busy || !assets.length || live)} onClick={() => action(() => api.publishStudioRun({ runId: run.id }), 'Saved to Google Drive.')}><CloudUpload size={15} aria-hidden="true" />Save to Google Drive</button>}
      {delivered && <a className="simple-quiet" href={delivered} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Open in Drive</a>}
      {live && can('cancelStudioRun') && <button type="button" data-spot="kit.stop" className="simple-quiet" {...writeProps(viewer, busy)} onClick={stop}><CircleStop size={15} aria-hidden="true" />Stop</button>}
      {!live && unfinished > 0 && can('retryStudioRun') && <button type="button" data-spot="kit.finish" className="simple-quiet" {...writeProps(viewer, busy)} onClick={finish}><RefreshCw size={15} aria-hidden="true" />Finish the rest</button>}
    </div>
    {list(run.warnings).length > 0 && <p className="simple-kit-note">{run.warnings[0]}</p>}
    <div className="simple-kit-channels" data-spot="kit.channels">{Object.entries(channels).map(([name, rows]) => <section className="simple-kit-channel" key={name} aria-label={name}>
      <h3><Folder size={16} aria-hidden="true" /><span>{name}</span><small>{rows.filter((job) => job.status === 'succeeded').length}/{rows.length}</small></h3>
      <ul>{rows.map((job) => <KitFile key={job.id} job={job} run={run} live={live} assets={assets.filter((asset) => asset.deliverableId === job.id)} cache={cache} onOpenFile={onOpenFile} onOpenPicture={onOpenPicture} />)}</ul>
    </section>)}</div>
  </section>;
}

function JobState({ job }) {
  if (job.status === 'succeeded') return <span className="simple-kit-state done" title="Ready"><Check size={13} aria-hidden="true" /></span>;
  if (job.status === 'running') return <span className="simple-kit-state" title="Working"><LoaderCircle className="spin" size={14} aria-hidden="true" /></span>;
  if (job.status === 'queued' || job.status === 'cancelled') return <span className="simple-kit-state waiting" title={job.status === 'cancelled' ? 'Stopped' : 'Waiting'} />;
  return <span className="simple-kit-state problem" title={job.error || 'Needs another try'}><TriangleAlert size={13} aria-hidden="true" /></span>;
}
function KitFile({ job, run, live, assets, cache, onOpenFile, onOpenPicture }) {
  if (job.kind === 'image') {
    const pictures = [...assets].sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0));
    return <li className="simple-kit-file is-pictures">
      <span className="simple-kit-file-icon"><ImageIcon size={17} aria-hidden="true" /></span>
      <span className="simple-kit-file-copy"><strong>{job.label}</strong><small>{pictures.length ? plural(pictures.length, 'picture') : jobLine(job, null, live)}</small></span>
      <JobState job={job} />
      <span className="simple-kit-thumbs">{[0, 1, 2].map((index) => { const asset = pictures.find((row) => (row.variantIndex ?? 0) === index); const url = asset && cache[`studio:${asset.id}`]; return asset ? <button type="button" key={index} aria-label={`Open ${asset.title}`} onClick={() => onOpenPicture(asset, run)}>{url ? <img src={url} alt="" /> : <span className="shimmer" />}</button> : <span key={index} className={`simple-kit-thumb-empty${job.status === 'running' ? ' shimmer' : ''}`} />; })}</span>
    </li>;
  }
  const asset = assets[0];
  return <li><button type="button" className="simple-kit-file" disabled={!asset} onClick={() => onOpenFile(asset, run)} aria-label={asset ? `Open ${job.label}` : undefined}>
    <span className="simple-kit-file-icon">{job.id === 'landingpage' ? <LayoutTemplate size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span>
    <span className="simple-kit-file-copy"><strong>{job.label}</strong><small title={job.error || undefined}>{jobLine(job, asset, live)}</small></span>
    <JobState job={job} />
  </button></li>;
}

// A written asset, read in place: copy it, open the file, page through the run with ← and →, or (admins and editors)
// edit it. An edit is saved beside the original, so the folder, its download and later sets use the new text.
function KitFileViewer({ api, web, busy, action, file, folder, label, onClose, onMove }) {
  const { asset } = file;
  const can = useCan();
  const viewer = useViewer();
  const guard = useUnsavedGuard();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const body = useRef(null);
  useEffect(() => { setEditing(false); }, [asset.id]);
  useEffect(() => {
    let cancelled = false; setPayload(null); setError(''); setCopied(false); body.current?.scrollTo?.({ top: 0 });
    Promise.resolve().then(() => api.readStudioAsset({ assetId: asset.id })).then((result) => { if (!cancelled) setPayload(result); }).catch((failure) => { if (!cancelled) setError(failure?.message || 'This file could not be opened.'); });
    return () => { cancelled = true; };
  }, [asset.id, reloadKey]);
  // Closing asks first when there are unsaved edits; while editing, Esc and the arrows belong to the editor.
  const close = () => { if (guard.confirmLeave()) onClose(); };
  useEffect(() => {
    if (editing) return undefined;
    const onKey = (event) => { if (event.target.closest?.('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key === 'Escape') onClose(); if (event.key === 'ArrowLeft') onMove(-1); if (event.key === 'ArrowRight') onMove(1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset.id, editing]);
  const markdown = typeof payload?.markdown === 'string' ? payload.markdown : '';
  const editedRow = payload?.edited || asset.edited;
  const edited = editedRow?.at ? { at: editedRow.at, byName: editedRow.byName || editedRow.by?.name || '' } : null;
  // The editor starts from the version whose text it shows (what was loaded), so a save made by someone else since is
  // refused instead of overwritten.
  const loadedEdit = payload?.edited?.at ? { at: payload.edited.at, byName: payload.edited.byName || payload.edited.by?.name || '' } : null;
  const canEdit = Boolean(api.editStudioAsset && can('editStudioAsset') && canEditAsset(asset));
  async function copy() { try { await navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  function saved(result) {
    setEditing(false);
    if (result?.restored) { setReloadKey((value) => value + 1); return; }
    const row = result?.asset?.edited;
    setPayload((current) => ({ ...(current || {}), markdown: result?.markdown ?? markdown, edited: row?.at ? { at: row.at, byName: row.byName || row.by?.name || '' } : current?.edited || null }));
  }
  return <div className="simple-lightbox" role="dialog" aria-modal="true" aria-label={label || asset.title} onClick={close}>
    <div className={`simple-kit-viewer${editing ? ' is-editing' : ''}`} onClick={(event) => event.stopPropagation()}>
      <header className="simple-kit-viewer-bar">
        <span><small>{[folder, label, edited ? `Edited by ${edited.byName || 'someone'}${edited.at ? ` · ${formatDay(edited.at)}` : ''}` : ''].filter(Boolean).join(' · ')}</small><strong>{asset.title}</strong></span>
        {!editing && <div className="simple-reader-tools">
          {canEdit && <button type="button" {...writeProps(viewer, !markdown)} onClick={() => setEditing(true)}><PenLine size={15} aria-hidden="true" />Edit</button>}
          <button type="button" disabled={!markdown} onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy text'}</button>
          <button type="button" disabled={busy} onClick={() => action(() => api.openStudioAsset({ assetId: asset.id }), web ? 'Download started.' : '')}>{web ? <Download size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}{web ? 'Download' : asset.deliverableId === 'landingpage' ? 'Open the page' : 'Open file'}</button>
        </div>}
        <button type="button" className="simple-lightbox-close" aria-label="Close" onClick={close}><X size={18} /></button>
      </header>
      <div className="simple-kit-viewer-body" ref={body}>
        {editing ? <AssetEditor api={api} asset={asset} markdown={markdown} edited={loadedEdit} action={action} web={web} onSaved={saved} onCancel={() => setEditing(false)} />
          : <article className="simple-doc">{error ? <p className="simple-error" role="alert">{error}</p> : !payload ? <div className="simple-doc-skeleton" role="status" aria-label="Opening the file"><span /><span /><span /><span /><span /></div> : markdown ? <MarkdownContent>{markdown}</MarkdownContent> : <p className="simple-error">This file has no readable text. Try Open file.</p>}</article>}
      </div>
    </div>
  </div>;
}

// Make channel assets: pick the report (one in the library, a Google Doc link, or pasted text), check what will be
// made and what it can cost, then start. Nothing is spent until "Make" is pressed.
function KitCreator({ api, sources, preset, imagesReady, action, busy, picturesOff = '', onClose, onCreated, onSettings }) {
  const viewer = useViewer();
  const fixed = preset?.source || null;
  const [step, setStep] = useState(fixed ? 'review' : 'source');
  const [mode, setMode] = useState(preset?.mode || 'report');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState('');
  const [link, setLink] = useState(preset?.link || '');
  const [doc, setDoc] = useState(null); // a Google Doc that was read
  const [file, setFile] = useState(null); // an uploaded document
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState('');
  const [plan, setPlan] = useState(null);
  const [chosen, setChosen] = useState(null); // null: everything the kit offers
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const first = useRef(null);
  const source = fixed || (mode === 'report' ? (picked ? { kind: 'report', assetId: picked } : null)
    : mode === 'link' ? (doc ? { kind: 'upload', title: doc.title, text: doc.text, url: doc.url, format: 'google-doc' } : null)
    : text.trim() ? (file ? { kind: 'upload', title: title.trim() || file.title, text, fileName: file.fileName || '' } : { kind: 'text', title: title.trim(), text }) : null);
  useEffect(() => { first.current?.focus(); }, [step, mode]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !starting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [starting]);
  // The plan (folders, prices, minutes) comes from the studio; it reads the report but spends nothing.
  useEffect(() => {
    if (step !== 'review' || !source) return undefined;
    let cancelled = false; setPlanning(true); setProblem('');
    Promise.resolve().then(() => api.planAssetKit({ source, ...(chosen ? { deliverableIds: [...chosen] } : {}) })).then((result) => { if (!cancelled) { setPlan(result); setPlanning(false); } }).catch((failure) => { if (!cancelled) { setProblem(failure?.message || 'This report can’t be used. Try another one.'); setPlanning(false); } });
    return () => { cancelled = true; };
  }, [step, chosen ? [...chosen].sort().join('|') : 'all']);
  const shownSources = sources.filter((row) => !query.trim() || row.title.toLowerCase().includes(query.trim().toLowerCase()));
  async function readDoc() {
    if (!/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]{10,}/.test(link.trim())) { setProblem('Paste a Google Docs link: https://docs.google.com/document/d/…'); return; }
    setReading(true); setProblem('');
    try { const result = await api.importStudioSource({ url: link.trim() }); if (result?.text) setDoc(result); }
    catch (failure) { setProblem(failure?.message || 'That Google Doc could not be read.'); }
    finally { setReading(false); }
  }
  async function uploadFile() {
    setProblem('');
    try { const result = await api.importStudioSource(); if (result?.text) { setFile(result); setText(result.text); if (!title.trim()) setTitle(result.title || ''); } }
    catch (failure) { setProblem(failure?.message || 'That document could not be read.'); }
  }
  function toggle(id) {
    const all = list(plan?.folders).flatMap((folder) => folder.items).filter((item) => item.available);
    const current = new Set(chosen || all.filter((item) => item.selected).map((item) => item.id));
    if (current.has(id)) current.delete(id); else current.add(id);
    if (current.size) setChosen(current);
  }
  async function start() {
    if (!plan || !source) return;
    setStarting(true);
    const run = await action(() => api.createAssetKit({ source, ...(chosen ? { deliverableIds: [...chosen] } : {}), maxBudgetUsd: plan.estimate.capUsd }), `Making ${plural(plan.estimate.calls, 'asset')}. They’ll fill this folder as they’re ready.`);
    setStarting(false);
    if (run) onCreated(run);
  }
  const selected = list(plan?.folders).flatMap((folder) => folder.items).filter((item) => item.selected);
  const pictures = selected.filter((item) => item.kind === 'image').reduce((sum, item) => sum + (item.pictures || 0), 0);
  const tabs = [['report', 'Your reports', FileText], ['link', 'Google Doc link', Link2], ['paste', 'Paste text', ClipboardCopy]];
  return <div className="simple-sheet" role="dialog" aria-modal="true" aria-labelledby="simple-kit-title">
    <div className="simple-sheet-card">
      <header className="simple-sheet-head">
        <div><small>{step === 'source' ? 'Step 1 of 2' : fixed ? 'Channel assets' : 'Step 2 of 2'}</small><h2 id="simple-kit-title">{step === 'source' ? 'Which report should the assets come from?' : 'Check what will be made'}</h2></div>
        <button type="button" className="simple-lightbox-close" aria-label="Close" disabled={starting} onClick={onClose}><X size={18} /></button>
      </header>
      {step === 'source' ? <div className="simple-sheet-body">
        <div className="simple-segment" role="tablist" aria-label="Where the report comes from">{tabs.map(([id, label, Icon]) => <button type="button" role="tab" key={id} data-spot={`kit-dialog.${id === 'report' ? 'reports' : id}`} aria-selected={mode === id} onClick={() => { setMode(id); setProblem(''); }}><Icon size={15} aria-hidden="true" />{label}</button>)}</div>
        {mode === 'report' ? <div className="simple-source-pick">
          {sources.length > 6 && <label className="simple-search wide"><Search size={16} aria-hidden="true" /><input ref={first} aria-label="Search reports" placeholder="Search reports" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {sources.length ? <div className="simple-source-list" role="radiogroup" aria-label="Reports">{shownSources.map((row, index) => <button type="button" role="radio" key={row.key} ref={index === 0 && sources.length <= 6 ? first : undefined} aria-checked={picked === row.assetId} onClick={() => setPicked(row.assetId)}>
            <span className="simple-radio" aria-hidden="true" /><span><strong>{row.title}</strong><small>{[row.detail, formatDate(row.createdAt)].filter(Boolean).join(' · ')}</small></span>
          </button>)}{!shownSources.length && <p className="simple-source-none">No reports match “{query}”.</p>}</div>
            : <div className="simple-empty"><p>No reports yet. Approve trends to get reports written, or use a Google Doc link or pasted text.</p></div>}
        </div>
          : mode === 'link' ? <div className="simple-source-link">
            {doc ? <div className="simple-source-card"><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><span><strong>{doc.title}</strong><small>Google Doc · {plural(doc.characters || doc.text.length, 'character')}</small></span><button type="button" className="simple-quiet" onClick={() => { setDoc(null); setProblem(''); }}>Use another doc</button></div>
              : <><label className="simple-field"><span>Google Doc link</span><div className="simple-inline"><input ref={first} type="url" inputMode="url" placeholder="https://docs.google.com/document/d/…" value={link} onChange={(event) => { setLink(event.target.value); setProblem(''); }} onKeyDown={(event) => { if (event.key === 'Enter') readDoc(); }} /><button type="button" className="simple-primary" disabled={reading || !link.trim()} onClick={readDoc}>{reading ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}{reading ? 'Reading…' : 'Read it'}</button></div></label>
                <p className="simple-hint">Works with docs shared as “Anyone with the link”, and with any doc the Google account in Settings can open.</p></>}
          </div>
          : <div className="simple-source-paste">
            <label className="simple-field"><span>Title <em>(optional)</em></span><input ref={first} value={title} maxLength={160} placeholder="Named after the first line if you leave it blank" onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="simple-field"><span>Report text</span><textarea rows={9} value={text} placeholder="Paste the trend report or brief here…" onChange={(event) => { setText(event.target.value); setFile(null); setProblem(''); }} /></label>
            <div className="simple-paste-foot"><button type="button" className="simple-link" onClick={uploadFile}><Upload size={14} aria-hidden="true" />Or upload a .docx, .md or .txt file</button><small className={text.length > MAX_SOURCE_CHARS ? 'over' : ''}>{number(text.length)} / {number(MAX_SOURCE_CHARS)} characters</small></div>
          </div>}
        {problem && <p className="simple-error" role="alert">{problem}</p>}
      </div>
        : <div className="simple-sheet-body">
          {problem ? <p className="simple-error" role="alert">{problem}</p> : !plan ? <div className="simple-doc-skeleton" role="status" aria-label="Reading the report"><span /><span /><span /></div> : <>
            <div className="simple-source-card"><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><span><strong>{plan.title}</strong><small>{[SOURCE_LABEL[plan.sourceKind], plural(plan.characters, 'character'), plan.evidenceCount ? plural(plan.evidenceCount, 'cited source') : '', plan.earlierRuns ? `${plural(plan.earlierRuns, 'earlier run')} in its folder` : ''].filter(Boolean).join(' · ')}</small></span>{!fixed && <button type="button" className="simple-quiet" disabled={starting} onClick={() => { setStep('source'); setPlan(null); setChosen(null); }}>Change</button>}</div>
            <div className="simple-kit-plan" data-spot="kit-dialog.plan">{plan.folders.map((folder) => <div className="simple-kit-plan-folder" key={folder.id}>
              <span className="simple-kit-plan-name"><Folder size={15} aria-hidden="true" />{folder.name}</span>
              <span className="simple-kit-plan-items">{folder.items.map((item) => { const name = `${sentence(item.label.replace(/^[^—]+—\s*/, ''))}${item.kind === 'image' ? ` ×${item.pictures}` : ''}`; return <button type="button" key={item.id} className="simple-check-chip" role="checkbox" aria-checked={item.selected} aria-label={name} disabled={!item.available || starting || planning} title={!item.available ? (onSettings ? 'Turn on pictures in Settings to include these' : picturesOff) : item.kind === 'image' ? referenceTitle(item.references) : undefined} onClick={() => toggle(item.id)}>
                <span className="simple-check" aria-hidden="true">{item.selected && <Check size={12} />}</span>{item.kind === 'image' ? <ImageIcon size={13} aria-hidden="true" /> : null}{name}
              </button>; })}</span>
            </div>)}</div>
            {!plan.imagesReady && (onSettings ? <p className="simple-hint">Pictures are off. <button type="button" className="simple-link" onClick={onSettings}>Turn them on in Settings</button> to add the hero graphics.</p> : <p className="simple-hint">{picturesOff} Only the written drafts are made until then.</p>)}
            {plan.imagesReady && pictures > 0 && <p className="simple-hint" data-spot="kit-dialog.references">{referenceHint(selected)}{onSettings && <> <button type="button" className="simple-link" disabled={starting} onClick={onSettings}>{selected.some((item) => item.references?.style || item.references?.logo) ? 'Change them in Settings' : 'Add style examples and logos in Settings'}</button></>}</p>}
            <div className="simple-kit-estimate" data-spot="kit-dialog.estimate">
              <div><strong>{plural(selected.length, 'asset')}</strong><small>{[plural(plan.folders.filter((folder) => folder.items.some((item) => item.selected)).length, 'folder'), pictures ? plural(pictures, 'picture') : ''].filter(Boolean).join(' · ')}</small></div>
              {plan.route === 'codex'
                ? <div><strong>Your Codex plan</strong><small>Codex doesn’t report costs{pictures ? '; pictures use OpenAI' : ''}</small></div>
                : <div><strong>About {money(plan.estimate.totalUsd)}</strong><small>Stops at {money(plan.estimate.capUsd)} at most</small></div>}
              <div><strong>About {number(plan.minutes)} minutes</strong><small>{plan.route === 'codex' ? 'Codex' : plan.estimate.modelLabel} writes{pictures ? ', OpenAI draws' : ''}</small></div>
            </div>
            {list(plan.warnings).length > 0 && <p className="simple-hint">{plan.warnings[0]}</p>}
          </>}
        </div>}
      <footer className="simple-sheet-foot">
        {step === 'review' && !fixed ? <button type="button" className="simple-quiet" disabled={starting} onClick={() => { setStep('source'); setPlan(null); setChosen(null); setProblem(''); }}><ArrowLeft size={15} aria-hidden="true" />Back</button> : <button type="button" className="simple-quiet" disabled={starting} onClick={onClose}>Cancel</button>}
        {step === 'source'
          ? <button type="button" className="simple-primary" disabled={!source || text.length > MAX_SOURCE_CHARS} onClick={() => { setProblem(''); setStep('review'); }}>Next: check what’s made<ArrowRight size={15} aria-hidden="true" /></button>
          : <button type="button" data-spot="kit-dialog.make" className="simple-primary" {...writeProps(viewer, !plan || planning || starting || busy || !selected.length || Boolean(problem))} onClick={start}>{starting ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}{starting ? 'Starting…' : `Make ${plural(selected.length, 'asset')}`}</button>}
      </footer>
    </div>
  </div>;
}

// Reports a kit can come from, as the Reports tab lists them; a trend's report and toolkit are one choice.
export function kitSourcesFrom(reports, contentRuns) {
  const runs = new Map(list(contentRuns).map((run) => [run.id, run])); const seen = new Set(); const rows = [];
  for (const report of reports) {
    const run = runs.get(report.runId);
    if (run?.themeId && ['evidence-report', 'editorial-toolkit'].includes(report.deliverableId)) {
      if (seen.has(run.id)) continue; seen.add(run.id);
      const pair = reports.filter((row) => row.runId === run.id);
      rows.push({ key: run.id, assetId: (pair.find((row) => row.deliverableId === 'evidence-report') || report).id, title: run.title || report.title || 'Trend', detail: pair.length > 1 ? 'Trends report + editorial toolkit' : 'Trends report', createdAt: report.createdAt });
    } else rows.push({ key: report.id, assetId: report.id, title: report.title || 'Report', detail: sentence(report.channel) || 'Report', createdAt: report.createdAt });
  }
  return rows;
}
