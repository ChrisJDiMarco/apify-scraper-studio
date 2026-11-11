import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleStop, Clapperboard, ClipboardCopy, CloudUpload, Download, ExternalLink, FileText, Folder, FolderOpen, Image as ImageIcon, LayoutTemplate, LoaderCircle, Megaphone, PenLine, Radar, RefreshCw, Search, Sparkles, TriangleAlert, Wand2, X, Zap } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import { studioRefDragProps } from './ask-slash.js';
import { AssetEditor, AssetStatusMenu, canEditAsset, statusLabel, statusOf, useUnsavedGuard } from './asset-editor.jsx';
import { brandFrom } from './brand-check.js';
import { copyText, trapTab, useModalFocus, useToast } from './role-screens.jsx';
import { CODEX_UNCAPPED, newerPromptsFor } from './studio-actions.js';
import { newestPromptsQuestion, retryCap } from './cost-lines.js';
import { useConfirm } from './confirm-dialog.jsx';
import { useHelpImages } from './help-images.js';
import { KitCreator, kitSourcesFrom } from './kit-creator.jsx';
import { formatDay, useCan, useViewer, writeProps } from './viewer.js';
import { thumbnailOf } from './thumb-cache.js';
import { readJsonChoice, saveJsonChoice } from './choices.js';
import { formatDate, number, withViewTransition } from './ui.jsx';
import { VideoPlayer, VideoTile } from './video-preview.jsx';
import { SOURCE_LABEL, TYPE_LABEL, buildLibraryTree, channelName, channelOf, cleanTitle, dayLabel, filterLibrary, folderSummary, libraryChannels, pathTo, periodLabel, rangeWindow, runSummary, scanFolders, trendFolders } from '../../shared/library-tree.js';
import './library.css';

// Assets in Simple mode, filed as the Library is (src/shared/library-tree.js): a folder per research run, a folder per
// trend inside it, and inside each trend its Trends report and toolkit, its channel assets (the n8n "Generate All
// Channel Assets" workflow: a folder per set, one per channel team inside that, as n8n filed them in Drive) and its
// pictures. Sets made from a Google Doc, a file or pasted text are under Other sources. Every picture, from those
// sets, Create content and Ask AI, is in the gallery below. Buttons follow the person's role (useCan): an editor makes
// and edits but never sees Settings, and nobody sees a button the server would refuse.
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const sentence = (value) => String(value || '').replace(/^./, (letter) => letter.toUpperCase());
const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
const modelName = (model) => String(model || '').replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
// The folders Simple Assets opens as pages; any other folder (a set, a channel, a trend's Pictures) opens its page.
// Drafts without a trend and Other files (and each draft campaign) open as a list of their files.
const PAGES = new Set(['research-run', 'trend', 'source', 'draft-run', 'orphans']);
// The filters on Assets: when (the date the work was made), which research program, which channel, and what kind.
const RANGES = [['all', 'All time'], ['week', 'This week'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom dates']];
const KINDS = [['', 'All types'], ['reports', 'Reports'], ['channel-asset', 'Channel assets'], ['pictures', 'Pictures'], ['draft', 'Drafts']];
const KIND_TYPES = { reports: ['trend-report', 'toolkit', 'scan-report'], 'channel-asset': ['channel-asset'], pictures: ['picture', 'video'], draft: ['draft'] };
// Files that open in the report reader (everything written that isn't part of a channel-asset set).
const READ_TYPES = new Set(['trend-report', 'toolkit', 'scan-report', 'draft']);
const FILE_ROWS = 200; // the All files table shows the newest; search and filters reach the rest
const NO_FILTERS = Object.freeze({ range: 'all', from: '', to: '', program: '', channel: '', kind: '', group: 'trend' });
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Kept here too: Simple mode and older imports read it from Assets.
export { kitSourcesFrom };

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

// `tree` is the Library tree SimpleMode builds (buildLibraryTree); without it Assets builds its own from the studio
// records it is given (researchRuns, contentRuns, themes, programs, editionId, adoptionsByTheme), and with only kit
// runs every set files under Other sources. `workspace` (optional) gives the editor's brand check its Claims to avoid.
// The person's own channels (prefs.focusChannels, from My channels) open first in a set and are pre-ticked in Make
// channel assets.
export function SimpleAssets({ api, web, tree, researchRuns = [], contentRuns, themes = [], programs = [], editionId = '', adoptionsByTheme = {}, kitRuns, assets, studioImages, sources, request, onRequestDone, cache, onCache, action, busy, imagesReady, googleReady, askAdmin = 'an admin', onDraft, onAsk, onSettings, onOpenReport, onOpenTrends, onViewChange, workspace = null, promptChanges = [], embedded = null, onOpenTrendPage }) {
  // `onOpenTrendPage(assetId, runId)`: a trend's folder is the Channel assets tab of that trend's page. When the page
  // can open it (it returns true), Assets hands the trend over and stays on its own list.
  // `embedded` ({ reportAssetId }): a trend's channel assets inside its page (trend-page.jsx): this opens on that trend's
  // folder and stays there, without the page title, Back, folder path or the documents list (the trend page has those).
  const can = useCan();
  const viewer = useViewer();
  const focus = list(viewer.prefs?.focusChannels);
  const brand = useMemo(() => brandFrom(workspace || { editionId }), [workspace?.id, workspace?.knowledge?.forbiddenClaims, workspace?.knowledge?.voice, workspace?.knowledge?.editorialRules, editionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [toast, showToast] = useToast();
  const canMake = can('createAssetKit');
  const canPicture = can('createHelpImage') && Boolean(onDraft);
  // Without Settings, the way to pictures is a person: say who.
  const picturesOff = `Pictures are off for your team. ${askAdmin} can turn them on.`;
  // node: the folder page open; key: a folder asked for by its sourceKey or node id (resolved when it exists, so a set
  // that was just started opens as soon as it arrives); runId: the set to show inside it.
  const [place, setPlace] = useState({ node: '', key: '', reportAssetId: embedded?.reportAssetId || '', runId: embedded?.runId || '' });
  const [creating, setCreating] = useState(null);
  const [reading, setReading] = useState(null); // a written asset open in the viewer
  // Ask AI's pictures, read again whenever Ask AI makes one (help-images.js), even while it draws behind this page.
  const helpImages = useHelpImages(api, null);
  const [filter, setFilter] = useState('all');
  // The toolbar: search starts empty each visit; the rest is remembered for this person on this device.
  const [query, setQuery] = useState('');
  const [filters, setFiltersState] = useState(() => ({ ...NO_FILTERS, ...readJsonChoice(viewer, 'assets.filters', {}) }));
  const setFilters = (next) => setFiltersState((current) => { const value = { ...current, ...next }; saveJsonChoice(viewer, 'assets.filters', value); return value; });
  const [open, setOpen] = useState(null); // a picture open in the lightbox
  const [saved, setSaved] = useState('');
  const ownTree = useMemo(() => (tree ? null : buildLibraryTree({ researchRuns, contentRuns: contentRuns || kitRuns, assets, themes, programs, editionId, helpImages: list(helpImages), adoptionsByTheme })), [tree, researchRuns, contentRuns, kitRuns, assets, themes, programs, editionId, helpImages, adoptionsByTheme]);
  const library = tree || ownTree;
  const runById = useMemo(() => new Map([...list(contentRuns), ...kitRuns].map((run) => [run.id, run])), [contentRuns, kitRuns]);
  const trendOf = (assetId) => list(library.byAssetId[assetId]).find((id) => library.nodes[id]?.type === 'trend') || '';
  const resolve = (key) => (library.nodes[key] ? key : list(library.bySourceKey[key])[0] || '');
  // The page a folder belongs on (a set opens its trend or source, with that set showing), or '' for Assets itself.
  function pageOf(nodeId) {
    let runId = '';
    for (let id = nodeId; id && library.nodes[id]; id = library.nodes[id].parentId) {
      const node = library.nodes[id];
      if (node.type === 'kit-run') runId = node.meta.kitRunId;
      if (PAGES.has(node.type)) return { node: id, runId };
    }
    return { node: '', runId };
  }
  // A set just made from a trends report opens under that report's trend at once (the source key alone names every
  // research run's report of a recurring trend).
  const asked = library.nodes[place.node] ? place.node : trendOf(place.reportAssetId) || resolve(place.key);
  const page = asked ? pageOf(asked) : { node: '', runId: '' };
  const current = library.nodes[page.node] || null;
  const runId = place.runId || page.runId;
  // Requests from elsewhere: the asset dialog (from a report you were reading, or Ask AI), a folder, or Assets itself.
  // "Show me" a trend's folder from Assets opens the research run it is in, so its card is on screen.
  useEffect(() => {
    if (!request) return;
    if (request.open === 'folder' || request.open === 'home') {
      setCreating(null); setReading(null); setOpen(null);
      if (request.open === 'folder') setPlace({ node: '', key: request.folderKey || '', reportAssetId: '', runId: request.runId || '' });
      else {
        const trends = Object.values(library.nodes).filter((node) => node.type === 'trend');
        const named = request.item ? trends.find((node) => same(node.title, request.item)) || trends.find((node) => node.title.toLowerCase().includes(String(request.item).trim().toLowerCase())) : null;
        const parent = named && library.nodes[named.parentId];
        setPlace({ node: parent?.type === 'research-run' ? parent.id : '', key: '', reportAssetId: '', runId: '' });
      }
    } else setCreating(request);
    onRequestDone?.();
  }, [request?.key]);
  const handedOver = !embedded && current?.type === 'trend' && typeof onOpenTrendPage === 'function';
  useEffect(() => {
    if (!handedOver) return;
    if (onOpenTrendPage(current.meta.reportAssetId || current.meta.toolkitAssetId || '', runId)) setPlace({ node: '', key: '', reportAssetId: '', runId: '' });
  }, [handedOver, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!handedOver) onViewChange?.(current ? current.title : '', current ? current.id : ''); }, [current?.id, handedOver]);
  useEffect(() => { document.querySelector('.simple-main')?.scrollTo?.({ top: 0 }); }, [current?.id]);
  const kitFolderOf = useMemo(() => new Map(kitRuns.flatMap((run) => list(run.jobs).map((job) => [`${run.id}:${job.id}`, job.folder]))), [kitRuns]);

  const items = [
    ...studioImages.map((asset) => ({ key: `studio:${asset.id}`, id: asset.id, source: 'studio', kind: asset.kind === 'video' ? 'video' : 'image', ...(asset.kind === 'video' ? { asset } : {}), title: asset.title || 'Campaign visual', createdAt: asset.createdAt, label: kitFolderOf.get(`${asset.runId}:${asset.deliverableId}`) || sentence(asset.channel) || 'Campaign visual' })),
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
          if (!cancelled && typeof url === 'string' && url.startsWith('data:image/')) { const small = await thumbnailOf(url); if (!cancelled) onCache(item.key, small); }
        } catch { /* the card keeps its placeholder and still opens the file */ }
      }
    }
    Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [items.map((item) => item.key).join('|')]);
  async function download(item) {
    setSaved('');
    if (item.source === 'help') { const result = await action(() => api.saveHelpImage({ id: item.id })); if (result && !result.cancelled) setSaved(item.key); }
    else await action(() => api.openStudioAsset({ assetId: item.id }), web ? 'Download started.' : '');
  }
  const counts = { all: items.length, studio: items.filter((item) => item.source === 'studio').length, help: items.filter((item) => item.source === 'help').length, video: items.filter((item) => item.kind === 'video').length };
  const newPicture = () => (imagesReady ? onDraft('Create a picture of ') : onSettings?.());
  const go = (next) => withViewTransition(() => setPlace({ node: '', key: '', reportAssetId: '', runId: '', ...next }));
  // Written assets open in order of the run's folders, so ← and → page through the set.
  function openFile(asset, run) { setReading({ asset, run }); }
  function moveFile(step) {
    if (!reading) return;
    const order = list(reading.run.jobs).filter((job) => job.kind !== 'image').map((job) => assets.find((asset) => asset.runId === reading.run.id && asset.deliverableId === job.id)).filter(Boolean);
    const next = order[order.findIndex((asset) => asset.id === reading.asset.id) + step];
    if (next) setReading({ asset: next, run: reading.run });
  }
  function openPicture(asset, run) { setOpen({ key: `studio:${asset.id}`, id: asset.id, source: 'studio', kind: asset.kind === 'video' ? 'video' : 'image', ...(asset.kind === 'video' ? { asset } : {}), title: asset.title, createdAt: asset.createdAt, label: kitFolderOf.get(`${run.id}:${asset.deliverableId}`) || sentence(asset.channel) }); }
  function startAgain(run) {
    const kind = run?.kit?.sourceKind;
    if (kind === 'google-doc') setCreating({ key: Date.now(), mode: 'link', link: run.kit.sourceUrl || '' });
    else if (run?.kit?.reportAssetId && ['trend', 'report'].includes(kind)) setCreating({ key: Date.now(), source: { kind: 'report', assetId: run.kit.reportAssetId } });
    else if (run) setCreating({ key: Date.now(), source: { kind: 'run', runId: run.id } });
    else setCreating({ key: Date.now() });
  }
  function created(run) { setCreating(null); if (run?.kit) go({ key: run.kit.sourceKey || '', reportAssetId: run.kit.reportAssetId || '', runId: run.id }); }
  const runsIn = (nodeId) => list(library.nodes[nodeId]?.children).map((id) => runById.get(library.nodes[id]?.meta.kitRunId)).filter(Boolean);
  const galleryOf = (nodeId) => { const byKey = new Map(items.map((item) => [item.key, item])); return list(library.nodes[nodeId]?.itemKeys).map((key) => byKey.get(key)).filter(Boolean); };

  // One file from a list (search results, Drafts, Other files): a picture opens large, a channel asset opens its set, and
  // a report or draft opens in the reader on this page.
  function openItem(item) {
    if (item.kind === 'image' || item.kind === 'video') { setOpen(items.find((row) => row.key === item.key) || { key: item.key, id: item.id, source: item.source, kind: item.kind, ...(item.kind === 'video' ? { asset: item.asset } : {}), title: item.title, createdAt: item.createdAt, label: item.label }); return; }
    if (item.kitRunId) { go({ node: pageOf(item.location).node, runId: item.kitRunId }); return; }
    if (READ_TYPES.has(item.type) && onOpenReport) onOpenReport(item.id);
  }
  const itemLine = (item) => { const trend = library.nodes[item.trendNodeId]; return [TYPE_LABEL[item.type] || item.label, item.channelName, trend && trend.title !== cleanTitle(item.title) ? trend.title : '', item.programName, formatDate(item.createdAt)].filter(Boolean).join(' · '); };
  const fileList = (rows) => <div className="simple-report-list">{rows.map((item) => <button type="button" key={item.key} data-spot="assets.result" data-spot-item={item.title} onClick={() => openItem(item)}>
    <span className="simple-doc-icon">{item.kind === 'image' ? <ImageIcon size={18} aria-hidden="true" /> : item.kind === 'video' ? <Clapperboard size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}</span>
    <span><strong>{item.title}</strong><small>{itemLine(item)}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>;
  // Rows under This week, Last week, then each month.
  const byPeriod = (rows, dateOf) => rows.reduce((all, row) => { const label = periodLabel(dateOf(row)); const last = all[all.length - 1]; if (last?.label === label) last.rows.push(row); else all.push({ label, rows: [row] }); return all; }, []);
  const overlays = <>
    {creating && canMake && <KitCreator key={creating.key} api={api} sources={sources} preset={creating} imagesReady={imagesReady} action={action} busy={busy} picturesOff={picturesOff} focus={focus} onClose={() => setCreating(null)} onCreated={created} onSettings={onSettings} />}
    {reading && <KitFileViewer api={api} web={web} busy={busy} action={action} file={reading} folder={kitFolderOf.get(`${reading.run.id}:${reading.asset.deliverableId}`)} label={list(reading.run.jobs).find((job) => job.id === reading.asset.deliverableId)?.label} brand={brand} onAsk={can('askHelp') ? onAsk : undefined} onNotice={showToast} onClose={() => setReading(null)} onMove={moveFile} />}
    {toast}
    {open && <PictureLightbox api={api} picture={open} cache={cache} busy={busy} web={web} saved={saved === open.key} viewer={viewer} onClose={() => setOpen(null)} onDownload={() => download(open)} onVariation={open.kind === 'image' && imagesReady && can('askHelp') && onAsk ? () => { setOpen(null); onAsk(`Make a variation of the picture “${open.title}”.`, open.prompt ? `EARLIER PICTURE PROMPT (data): ${open.prompt}` : ''); } : undefined} />}
  </>;
  const gallery = (rows) => <div className="simple-asset-grid">{rows.map((item) => <button type="button" className="simple-asset" key={item.key} onClick={() => setOpen(item)} aria-label={`Open ${item.title}`}>
    <span className="simple-asset-frame">{item.kind === 'video' ? (item.asset ? <VideoTile asset={item.asset} api={api} title={item.title} /> : <span className="simple-asset-placeholder"><Clapperboard size={26} aria-hidden="true" /></span>) : cache[item.key] ? <img src={cache[item.key]} alt="" loading="lazy" /> : <span className="simple-asset-placeholder shimmer" />}</span>
    <span className="simple-asset-copy"><strong>{item.title}</strong><small>{[item.label, formatDate(item.createdAt)].filter(Boolean).join(' · ')}</small></span>
  </button>)}</div>;
  // A folder card: research runs, trends and sources look alike, with a kicker that says which one it is.
  const folderCard = (id, { spot = true } = {}) => {
    const node = library.nodes[id]; if (!node) return null;
    const quick = node.meta.origin === 'quick-scan';
    const kind = node.type === 'research-run' ? (quick ? 'Quick scan' : 'Research run') : node.type === 'trend' ? 'Trend' : node.type === 'source' ? SOURCE_LABEL[node.meta.sourceKind] || 'Other source' : node.id === 'other-sources' ? 'Outside research' : node.type === 'draft-run' || node.id === 'loose-drafts' ? 'Drafts' : 'Folder';
    const used = list(node.meta.usedBy);
    // Where research found a trend: "Found in the Oct 20 run · AI search pulse".
    const found = node.type === 'trend' ? [node.meta.runDate ? `Found in the ${dayLabel(node.meta.runDate)} run` : '', node.meta.programName].filter(Boolean).join(' · ') : '';
    // A trend's folder (or a run's) can be dragged into Ask AI to ask about it (ask-slash.js).
    const dragRef = node.type === 'trend' ? { kind: 'asset-folder', ref: node.title, id } : node.type === 'research-run' ? { kind: 'run', ref: node.title, id } : null;
    return <button type="button" className={`simple-folder${node.live ? ' is-live' : ''}`} key={id} {...(spot ? { 'data-spot': 'assets.folder', 'data-spot-item': node.title } : {})} {...(dragRef ? studioRefDragProps(dragRef) : {})} onClick={() => go({ node: id })} aria-label={`Open the ${node.title} folder`}>
      <span className="simple-folder-cover" aria-hidden="true">{node.cover.length ? node.cover.map((assetId) => cache[`studio:${assetId}`] ? <img key={assetId} src={cache[`studio:${assetId}`]} alt="" /> : <span key={assetId} className="shimmer" />) : <span className="simple-folder-glyph">{node.type === 'research-run' ? (quick ? <Zap size={30} /> : <Radar size={30} />) : <Folder size={34} />}</span>}</span>
      <span className="simple-folder-copy">
        <span className="simple-folder-kind">{kind}</span>
        <strong>{node.title}</strong>
        <small>{node.live ? <><LoaderCircle className="spin" size={13} aria-hidden="true" />{node.liveText || 'Working…'}</> : folderSummary(node)}</small>
        {found && <small className="simple-folder-found">{found}</small>}
        {used.length > 0 && <small className="simple-folder-used"><Megaphone size={12} aria-hidden="true" />Used by {used.map((row) => row.name).join(', ')}</small>}
      </span>
    </button>;
  };
  const runs = library.roots.filter((id) => library.nodes[id].type === 'research-run');
  const earlier = list(library.nodes.earlier?.children);
  // With no research folders at all, the sources are the folders: Assets lists them itself instead of one more click.
  const flatSources = !runs.length && !earlier.length;
  // The way back: the page above this one (an earlier trend's research run is gone, so it goes back to Assets).
  const parentPage = current ? pageOf(current.parentId).node : '';
  const viaOthers = current?.parentId === 'other-sources' && !flatSources;
  const crumbs = current ? pathTo(library, current.id).filter((node) => PAGES.has(node.type) || (node.id === 'other-sources' && viaOthers)) : [];
  const head = (title, detail, actions) => <>
    <button type="button" className="simple-back" onClick={() => go({ node: parentPage || (viaOthers ? 'other-sources' : '') })}><ArrowLeft size={15} aria-hidden="true" />{library.nodes[parentPage]?.title || (viaOthers ? 'Other sources' : 'All assets')}</button>
    <div className="simple-page-head"><div><h1>{title}</h1>
      <nav className="simple-crumbs" aria-label="Folder path"><ol><li><button type="button" onClick={() => go({})}>Assets</button></li>{crumbs.slice(0, -1).map((node) => <li key={node.id}><button type="button" onClick={() => go({ node: node.id })}>{node.title}</button></li>)}<li><span aria-current="page">{title}</span></li></ol></nav>
      {detail && <p>{detail}</p>}</div>
      {actions && <div className="simple-head-actions">{actions}</div>}</div>
  </>;
  const sets = (runs, { onAgain } = {}) => (runs.length
    ? <KitSets runs={runs} runId={runId} assets={assets} cache={cache} web={web} busy={busy} action={action} api={api} googleReady={googleReady} editionId={editionId} focus={focus} promptChanges={promptChanges} onNotice={showToast} onRun={(id) => setPlace((current) => ({ ...current, runId: id }))} onOpenFile={openFile} onOpenPicture={openPicture} />
    : <div className="simple-kit-intro">
      <span className="simple-kit-intro-art" aria-hidden="true"><Folder size={26} /><Folder size={26} /><Folder size={26} /></span>
      <div><strong>No channel assets yet</strong><p>One set makes the blog posts, the newsletter pack, ads and a landing page, PR research, social captions and hero graphics, and the partner, sales and editorial pieces, each in its channel team’s folder.</p></div>
      {canMake && onAgain && <button type="button" className="simple-primary" disabled={busy} onClick={onAgain}>Make channel assets<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>);

  if (embedded && current?.type !== 'trend') return <><div className="simple-kit-intro"><div><strong>No channel assets yet</strong><p>Once this trend’s report is written, the assets made from it are filed here by channel team.</p></div></div>{overlays}</>;
  // A research run: a folder per trend it reported.
  if (current?.type === 'research-run') return <>
    <div className="simple-page">
      {head(current.title, [current.subtitle, folderSummary(current)].filter(Boolean).join(' · '))}
      <section className="simple-section" aria-label="Trends in this research run">
        {current.children.some((id) => ['trend', 'drafts'].includes(library.nodes[id]?.type)) ? <div className="simple-folder-grid">{current.children.filter((id) => ['trend', 'drafts'].includes(library.nodes[id]?.type)).map((id) => folderCard(id))}</div>
          : current.itemKeys.length ? null : <div className="simple-empty"><p>{current.live ? 'Reports are being written. Each trend gets its folder here when its report is ready.' : 'Nothing was reported from this run.'}</p></div>}
      </section>
      {current.itemKeys.length > 0 && <section className="simple-section" aria-labelledby="simple-run-files">
        <div className="simple-section-head"><h2 id="simple-run-files">{current.meta.origin === 'quick-scan' ? 'Quick scan report and drafts' : 'Other files from this run'}</h2></div>
        {fileList(current.itemKeys.map((key) => library.itemsByKey[key]).filter(Boolean))}
      </section>}
    </div>
    {overlays}
  </>;
  // A trend: its Trends report and toolkit, its channel assets by set and channel team, and its pictures.
  if (current?.type === 'trend') {
    const runs = runsIn(`kits:${current.id}`);
    const docs = current.itemKeys.map((key) => library.itemsByKey[key]).filter((item) => item && ['trend-report', 'toolkit'].includes(item.type));
    const reportId = current.meta.reportAssetId || current.meta.toolkitAssetId;
    const again = reportId ? () => setCreating({ key: Date.now(), source: { kind: 'report', assetId: reportId } }) : null;
    const pictures = galleryOf(`pictures:${current.id}`);
    return <>
      <div className="simple-page simple-kit-page">
        {embedded ? (canMake && again && <button type="button" data-spot="kit.again" className="simple-primary" disabled={busy} onClick={again}><Sparkles size={15} aria-hidden="true" />{runs.length ? 'Make another set' : 'Make channel assets'}</button>) && <div className="simple-head-actions simple-embed-actions">{canMake && again && <button type="button" data-spot="kit.again" className="simple-primary" disabled={busy} onClick={again}><Sparkles size={15} aria-hidden="true" />{runs.length ? 'Make another set' : 'Make channel assets'}</button>}</div>
          : head(current.title, folderSummary(current), canMake && again && <button type="button" data-spot="kit.again" className="simple-primary" disabled={busy} onClick={again}><Sparkles size={15} aria-hidden="true" />{runs.length ? 'Make another set' : 'Make channel assets'}</button>)}
        {!embedded && <section className="simple-section" aria-labelledby="simple-trend-docs">
          <div className="simple-section-head"><h2 id="simple-trend-docs">Trends report &amp; toolkit</h2>{list(current.meta.usedBy).length > 0 && <small className="simple-section-note">Used by {current.meta.usedBy.map((row) => row.name).join(', ')}</small>}</div>
          {docs.length ? <div className="simple-report-list">{docs.map((item) => { const stage = statusOf(assets.find((asset) => asset.id === item.id) || item.asset); return <button type="button" key={item.key} {...(item.id === reportId ? { 'data-spot': 'kit.report' } : {})} onClick={() => onOpenReport(item.id)}><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><span><strong>{TYPE_LABEL[item.type]}</strong><small>{[cleanTitle(item.title) !== current.title ? item.title : '', item.createdAt ? formatDate(item.createdAt) : '', item.edited ? 'Edited' : '', stage !== 'draft' ? statusLabel(stage) : ''].filter(Boolean).join(' · ')}</small></span><ArrowRight size={16} aria-hidden="true" /></button>; })}</div>
            : <div className="simple-empty"><p>{current.live ? 'The report is being written. It opens here when it’s ready.' : 'This trend’s report wasn’t written.'}</p></div>}
        </section>}
        <section className="simple-section" aria-labelledby="simple-trend-kits">
          <div className="simple-section-head"><h2 id="simple-trend-kits">Channel assets</h2>{runs.length > 0 && <small className="simple-section-note">A folder per set, split by channel team</small>}</div>
          {sets(runs, { onAgain: again })}
        </section>
        {pictures.length > 0 && <section className="simple-section" aria-labelledby="simple-trend-pictures">
          <div className="simple-section-head"><h2 id="simple-trend-pictures">Pictures</h2></div>
          {gallery(pictures)}
        </section>}
      </div>
      {overlays}
    </>;
  }
  // One source outside research (a Google Doc, a file, pasted text, or a report with no trend): its sets.
  if (current?.type === 'source') {
    const runs = runsIn(current.id);
    const reportId = ['report', 'trend'].includes(current.meta.sourceKind) ? current.meta.reportAssetId : '';
    return <>
      <div className="simple-page simple-kit-page">
        {head(current.title, [SOURCE_LABEL[current.meta.sourceKind] || 'From a report', plural(runs.length, 'run'), plural(current.counts.files, 'file')].join(' · '), <>{reportId && <button type="button" data-spot="kit.report" className="simple-quiet" onClick={() => onOpenReport(reportId)}><FileText size={15} aria-hidden="true" />Read the report</button>}{canMake && <button type="button" data-spot="kit.again" className="simple-primary" disabled={busy} onClick={() => startAgain(runs[0])}><Sparkles size={15} aria-hidden="true" />Make another set</button>}</>)}
        {sets(runs)}
      </div>
      {overlays}
    </>;
  }
  // Other sources: a folder per source.
  if (place.node === 'other-sources' && library.nodes['other-sources']) {
    const others = library.nodes['other-sources'];
    return <>
      <div className="simple-page">
        <button type="button" className="simple-back" onClick={() => go({})}><ArrowLeft size={15} aria-hidden="true" />All assets</button>
        <div className="simple-page-head"><div><h1>Other sources</h1><p>Channel assets made from a Google Doc, a document, pasted text or a report outside research.</p></div></div>
        <div className="simple-folder-grid">{others.children.map((id) => folderCard(id))}</div>
      </div>
      {overlays}
    </>;
  }

  // Drafts without a trend, one draft campaign, or Other files: their folders, then their files.
  if (current && (current.type === 'draft-run' || (current.type === 'orphans' && current.id !== 'other-sources'))) {
    const folders = current.children.filter((id) => library.nodes[id]);
    const files = current.itemKeys.map((key) => library.itemsByKey[key]).filter(Boolean);
    return <>
      <div className="simple-page">
        {head(current.title, current.subtitle || folderSummary(current))}
        {folders.length > 0 && <div className="simple-folder-grid">{folders.map((id) => folderCard(id))}</div>}
        {files.length > 0 && <section className="simple-section" aria-label="Files">{fileList(files)}</section>}
        {!folders.length && !files.length && <div className="simple-empty"><p>Nothing here yet.</p></div>}
      </div>
      {overlays}
    </>;
  }

  const pending = list(library.pending);
  // The toolbar's choices, applied: the date window and program narrow the folders and pictures; a search, a channel or
  // a type lists the matching files themselves.
  const span = rangeWindow(filters.range, filters);
  const programIds = filters.program && programs.some((row) => row.id === filters.program) ? [filters.program] : [];
  const searching = Boolean(query.trim() || filters.kind || filters.channel);
  // "All files": every file in one table, whatever trend or run it came from, narrowed by the same search and filters.
  const filesView = filters.group === 'files';
  const results = searching || filesView ? filterLibrary(library, { query, types: KIND_TYPES[filters.kind] || [], channels: filters.channel ? [filters.channel] : [], programs: programIds, ...span }).items.filter((item) => item.source !== 'legacy') : [];
  const trends = trendFolders(library, { ...span, programs: programIds });
  const scans = scanFolders(library, { ...span, programs: programIds });
  const inWindow = (value) => { const at = Date.parse(value || ''); return (!span.from || at >= new Date(`${span.from}T00:00:00`).getTime()) && (!span.to || at <= new Date(`${span.to}T23:59:59.999`).getTime()); };
  const runFolders = runs.filter((id) => { const node = library.nodes[id]; return inWindow(node.date) && (!programIds.length || programIds.includes(node.meta.programId)); });
  const narrowed = filters.range !== 'all' || programIds.length > 0;
  const outside = ['other-sources', 'loose-drafts', 'other-files'].filter((id) => library.nodes[id]);
  const pictures = shown.filter((item) => !narrowed || inWindow(item.createdAt));
  const clear = () => { setQuery(''); setFilters({ ...NO_FILTERS, group: filters.group }); };
  const channelChoices = libraryChannels(editionId || 'general');
  const toolbar = <div className="simple-asset-tools" data-spot="assets.filters">
    <label className="simple-search" data-spot="assets.search"><Search size={16} aria-hidden="true" /><input aria-label="Search assets" placeholder="Search reports, assets and pictures" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
    <select aria-label="When" value={filters.range} onChange={(event) => setFilters({ range: event.target.value })}>{RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    {filters.range === 'custom' && <span className="simple-asset-dates"><input type="date" aria-label="From" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters({ from: event.target.value })} /><span aria-hidden="true">–</span><input type="date" aria-label="To" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters({ to: event.target.value })} /></span>}
    {programs.length > 1 && <select aria-label="Research program" value={programIds[0] || ''} onChange={(event) => setFilters({ program: event.target.value })}><option value="">All programs</option>{programs.map((row) => <option key={row.id} value={row.id}>{row.name || 'Untitled program'}</option>)}</select>}
    <select aria-label="Channel" value={filters.channel} onChange={(event) => setFilters({ channel: event.target.value })}><option value="">All channels</option>{channelChoices.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
    <select aria-label="Type" value={filters.kind} onChange={(event) => setFilters({ kind: event.target.value })}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    {(!searching || filesView) && <div className="simple-segment" role="group" aria-label="Group folders by">{[['trend', 'By trend'], ['run', 'By research run'], ['files', 'All files']].map(([value, label]) => <button type="button" key={value} aria-pressed={filters.group === value} onClick={() => setFilters({ group: value })}>{label}</button>)}</div>}
    {(searching || narrowed) && <button type="button" className="simple-link" onClick={clear}>Clear filters</button>}
  </div>;
  return <>
    <div className="simple-page">
      <div className="simple-page-head"><div><h1>Assets</h1><p>Every trend’s reports and channel assets, quick scans, drafts and pictures, newest first.</p></div>
        <div className="simple-head-actions">{(imagesReady ? canPicture : Boolean(onSettings)) && <button type="button" data-spot="assets.make-picture" className="simple-quiet" onClick={newPicture}><Wand2 size={15} aria-hidden="true" />{imagesReady ? 'Make a picture' : 'Turn on pictures'}</button>}{canMake && <button type="button" data-spot="assets.make-kit" className="simple-primary" disabled={busy} onClick={() => setCreating({ key: Date.now() })}><Sparkles size={15} aria-hidden="true" />Make channel assets</button>}</div></div>

      {toolbar}
      {pending.length > 0 && <p className="simple-pending" role="status">{pending.some((run) => ACTIVE.has(run.status)) ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Radar size={15} aria-hidden="true" />}<span>{plural(pending.length, 'research run')} in progress or waiting for review. {pending.length === 1 ? 'Its trends appear' : 'Their trends appear'} once reports are written.</span>{onOpenTrends && <button type="button" className="simple-link" onClick={onOpenTrends}>Go to Trends<ArrowRight size={14} aria-hidden="true" /></button>}</p>}

      {filesView ? <section className="simple-section" aria-labelledby="simple-asset-files" data-spot="assets.files">
        <div className="simple-section-head"><h2 id="simple-asset-files">{results.length ? plural(results.length, 'file') : 'No files'}</h2>{results.length > FILE_ROWS && <small className="simple-section-note">Showing the newest {number(FILE_ROWS)}. Search or filter to find older ones.</small>}</div>
        {results.length ? <div className="simple-file-table-wrap"><table className="simple-file-table">
          <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Trend</th><th scope="col">Made</th></tr></thead>
          <tbody>{[...results].sort(newest).slice(0, FILE_ROWS).map((item) => { const trend = library.nodes[item.trendNodeId]; const live = assets.find((asset) => asset.id === item.id) || item.asset; return <tr key={item.key}>
            <th scope="row"><button type="button" className="simple-file-open" onClick={() => openItem(item)}>{cleanTitle(item.title) || 'Untitled'}</button></th>
            <td>{TYPE_LABEL[item.type] || item.label || ''}</td>
            <td>{item.channelName || ''}</td>
            <td>{live && item.source === 'studio' && item.kind !== 'image' && item.kind !== 'video' ? <span className={`studio-status status-${statusOf(live)}`}><span className="studio-status-dot" aria-hidden="true" />{statusLabel(statusOf(live))}</span> : ''}</td>
            <td>{trend ? <button type="button" className="simple-file-open is-quiet" onClick={() => go({ node: trend.id })}>{trend.title}</button> : ''}</td>
            <td className="simple-file-date">{item.createdAt ? formatDate(item.createdAt) : ''}</td>
          </tr>; })}</tbody>
        </table></div>
          : <div className="simple-empty"><p>{searching || narrowed ? `Nothing matches${query.trim() ? ` “${query.trim()}”` : ''} with these filters.` : 'No files yet. A trend’s reports and channel assets are listed here as they’re made.'}</p>{(searching || narrowed) && <button type="button" className="simple-quiet" onClick={clear}>Clear filters</button>}</div>}
      </section>
        : searching ? <section className="simple-section" aria-labelledby="simple-asset-results" data-spot="assets.results">
        <div className="simple-section-head"><h2 id="simple-asset-results">{results.length ? `${number(results.length)} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'}</h2></div>
        {results.length ? byPeriod(results, (item) => item.createdAt).map((group) => <div className="simple-group-bucket" key={group.label}><h3 className="simple-group-sublabel">{group.label}</h3>{fileList(group.rows)}</div>)
          : <div className="simple-empty"><p>Nothing matches{query.trim() ? ` “${query.trim()}”` : ''} with these filters.</p><button type="button" className="simple-quiet" onClick={clear}>Clear filters</button></div>}
      </section>
        : <section className="simple-section" aria-labelledby="simple-kit-folders" data-spot="assets.folders">
          <div className="simple-section-head"><h2 id="simple-kit-folders">{filters.group === 'run' ? (runs.length ? 'Research runs' : 'Asset folders') : 'Trends'}</h2><small className="simple-section-note">{filters.group === 'run' ? 'A folder per trend inside each run' : 'Each trend’s reports, channel assets and pictures'}</small></div>
          {!runs.length && !earlier.length && !outside.length ? <div className="simple-kit-intro">
            <span className="simple-kit-intro-art" aria-hidden="true"><Folder size={26} /><Folder size={26} /><Folder size={26} /></span>
            <div><strong>Turn one report into every channel asset</strong><p>Blog posts, the newsletter pack, search ads and a landing page, PR research, social captions and hero graphics, the affiliate pack, the enterprise brief, and the Backlinko, Exploding Topics and Search Engine Land pieces. Each run gets its own folder, split by channel team.</p></div>
            {canMake && <button type="button" className="simple-primary" disabled={busy} onClick={() => setCreating({ key: Date.now() })}>Choose a report<ArrowRight size={15} aria-hidden="true" /></button>}
          </div>
            : filters.group === 'run' ? (runFolders.length || earlier.length ? <div className="simple-folder-grid">{runFolders.map((id) => folderCard(id))}{!narrowed && earlier.map((id) => folderCard(id))}</div> : <div className="simple-empty"><p>No research runs in this window.</p></div>)
            : trends.length ? byPeriod(trends, (node) => node.date).map((group) => <div className="simple-group-bucket" key={group.label}><h3 className="simple-group-sublabel">{group.label}</h3><div className="simple-folder-grid">{group.rows.map((node) => folderCard(node.id))}</div></div>)
            : <div className="simple-empty"><p>{narrowed ? 'No trends in this window.' : 'No trends have reports yet.'}</p>{narrowed && <button type="button" className="simple-quiet" onClick={() => setFilters({ range: 'all', program: '' })}>Show all trends</button>}</div>}
        </section>}

      {!searching && ((filters.group === 'trend' && scans.length > 0) || outside.length > 0) && <section className="simple-section" aria-labelledby="simple-asset-outside">
        <div className="simple-section-head"><h2 id="simple-asset-outside">{filters.group === 'trend' && scans.length ? 'Quick scans and other work' : 'Outside research'}</h2><small className="simple-section-note">Quick scans, sets from Google Docs, files and pasted text, and drafts without a trend</small></div>
        <div className="simple-folder-grid">{filters.group === 'trend' && scans.map((node) => folderCard(node.id))}{outside.map((id) => (id === 'other-sources' && flatSources ? library.nodes[id].children.map((child) => folderCard(child)) : folderCard(id, { spot: id !== 'other-sources' })))}</div>
      </section>}

      {/* While searching, pictures are among the matches above, so the gallery steps aside. */}
      {!searching && <section className="simple-section" aria-labelledby="simple-pictures" data-spot="assets.pictures">
        <div className="simple-section-head"><h2 id="simple-pictures">Pictures</h2></div>
        {helpImages !== null && items.length > 0 && <div className="simple-filters is-tight" role="group" aria-label="Asset type" data-spot="assets.picture-types">{[['all', 'All'], ['studio', 'Campaign visuals'], ['help', 'Made in Ask AI'], ...(hasVideo ? [['video', 'Videos']] : [])].filter(([value]) => value === 'all' || counts[value]).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{number(counts[value])}</span></button>)}</div>}
        {helpImages === null ? <div className="simple-asset-grid" aria-busy="true">{[0, 1, 2].map((n) => <div className="simple-asset skeleton" key={n}><span className="simple-asset-frame" /></div>)}</div>
          : !items.length ? <div className="simple-empty"><ImageIcon size={22} aria-hidden="true" /><p>{imagesReady ? 'No pictures yet. Ask AI can make one for any trend or report, and channel asset runs draw hero graphics too.' : onSettings ? 'Add an OpenAI key in Settings and pictures can be made for your trends, reports and channel assets.' : picturesOff}</p>{(imagesReady ? canPicture : Boolean(onSettings)) && <button type="button" className="simple-quiet" onClick={newPicture}>{imagesReady ? 'Make your first picture' : 'Open Settings'}</button>}</div>
          : pictures.length ? gallery(pictures) : <div className="simple-empty"><p>No pictures in this window.</p></div>}
      </section>}
    </div>
    {overlays}
  </>;
}

// One picture, large: Download (or Open file on the Mac) and Make a variation. A modal: focus moves in, Tab stays in,
// Esc closes it and focus goes back to the card that opened it.
function PictureLightbox({ api, picture, cache, busy, web, saved, viewer, onClose, onDownload, onVariation }) {
  const panel = useRef(null);
  // The grid holds small copies; the open picture is read at full size (and let go when the lightbox closes).
  const [full, setFull] = useState({ key: '', url: '' });
  useEffect(() => {
    if (picture.kind === 'video') return undefined;
    let live = true;
    Promise.resolve().then(() => (picture.source === 'help' ? api.readHelpImage({ id: picture.id }) : api.readStudioAsset({ assetId: picture.id })))
      .then((result) => { const url = picture.source === 'help' ? result?.dataUrl : result?.imageDataUrl; if (live && typeof url === 'string' && url.startsWith('data:image/')) setFull({ key: picture.key, url }); }, () => {});
    return () => { live = false; };
  }, [picture.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownUrl = full.key === picture.key ? full.url : cache[picture.key];
  useModalFocus(panel);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="simple-lightbox" role="dialog" aria-modal="true" aria-label={picture.title} ref={panel} tabIndex={-1} onKeyDown={(event) => trapTab(event, panel.current)} onClick={onClose}>
    <div className="simple-lightbox-card" onClick={(event) => event.stopPropagation()}>
      <div className="simple-lightbox-media">{picture.kind === 'video' ? (picture.asset ? <VideoPlayer asset={picture.asset} api={api} /> : <span className="simple-asset-placeholder"><Clapperboard size={34} aria-hidden="true" /><small>Open the file to play this video.</small></span>) : shownUrl ? <img src={shownUrl} alt={picture.title} /> : <span className="simple-asset-placeholder shimmer" />}</div>
      <aside className="simple-lightbox-side">
        <button type="button" className="simple-lightbox-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <small className="simple-doc-meta">{[picture.label, formatDate(picture.createdAt)].filter(Boolean).join(' · ')}</small>
        <h2>{picture.title}</h2>
        {picture.prompt && <p className="simple-prompt">{picture.prompt}</p>}
        <div className="simple-lightbox-actions">
          <button type="button" className="simple-primary" disabled={busy} onClick={onDownload}>{saved ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{saved ? 'Saved' : picture.source === 'help' || web ? 'Download' : 'Open file'}</button>
          {onVariation && <button type="button" className="simple-quiet" {...writeProps(viewer)} onClick={onVariation}><Wand2 size={15} aria-hidden="true" />Make a variation</button>}
        </div>
      </aside>
    </div>
  </div>;
}

// A folder's sets: a sub-folder per set on the left, the open set's channel folders on the right.
function KitSets({ runs, runId, assets, cache, web, busy, action, api, googleReady, editionId, focus = [], promptChanges = [], onNotice, onRun, onOpenFile, onOpenPicture }) {
  const run = runs.find((entry) => entry.id === runId) || runs[0];
  return <div className="simple-kit-layout">
    <div className="simple-kit-runs" role="group" aria-label="Runs in this folder" data-spot="kit.runs">{runs.map((entry) => <button type="button" key={entry.id} aria-current={entry.id === run.id ? 'true' : undefined} onClick={() => onRun(entry.id)}>
      <span className="simple-kit-run-glyph">{ACTIVE.has(entry.status) ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : entry.id === run.id ? <FolderOpen size={17} aria-hidden="true" /> : <Folder size={17} aria-hidden="true" />}</span>
      <span><strong>{formatDate(entry.createdAt)}</strong><small>{runSummary(entry)}</small></span>
    </button>)}</div>
    <KitRun key={run.id} run={run} assets={assets.filter((asset) => asset.runId === run.id)} cache={cache} web={web} busy={busy} action={action} api={api} googleReady={googleReady} editionId={editionId} focus={focus} promptChanges={promptChanges} onNotice={onNotice} onOpenFile={onOpenFile} onOpenPicture={onOpenPicture} />
  </div>;
}

// One run's folder, laid out as n8n left it in Drive: a folder per channel team with that team's files. Teams come
// from each file's deliverable id (channelOf), never from the folder name saved on the job; the name shown is the
// edition's, or the saved one when the edition isn't known.
function KitRun({ run, assets, cache, web, busy, action, api, googleReady, editionId = '', focus = [], promptChanges = [], onNotice, onOpenFile, onOpenPicture }) {
  const can = useCan();
  const viewer = useViewer();
  const confirm = useConfirm();
  const jobs = list(run.jobs); const total = jobs.length; const done = jobs.filter((job) => job.status === 'succeeded').length; const unfinished = total - done;
  const live = ACTIVE.has(run.status);
  // The person's own channels first (My channels), the rest after; "Your channels" shows only theirs.
  const allChannels = [...jobs.reduce((all, job) => { const id = channelOf(job.id, editionId || 'semrush'); if (!all.has(id)) all.set(id, []); all.get(id).push(job); return all; }, new Map())].map(([id, rows]) => ({ id, name: (editionId && channelName(id, editionId)) || rows.find((job) => job.folder)?.folder || channelName(id), rows, mine: focus.includes(id) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine));
  const hasMine = allChannels.some((channel) => channel.mine) && allChannels.some((channel) => !channel.mine);
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('any');
  const statusOfJob = (job) => assets.filter((asset) => asset.deliverableId === job.id).map(statusOf);
  const used = new Set(assets.map(statusOf));
  const channels = allChannels.filter((channel) => !hasMine || scope === 'all' || channel.mine).map((channel) => ({ ...channel, rows: status === 'any' ? channel.rows : channel.rows.filter((job) => statusOfJob(job).includes(status)) })).filter((channel) => channel.rows.length);
  const delivered = run.googleDelivery?.folderUrl || '';
  async function stop() { if (await confirm({ title: 'Stop making these assets?', lines: ['Finished ones are kept, and you can finish the rest later.'], confirmLabel: 'Stop', tone: 'danger' })) await action(() => api.cancelStudioRun({ runId: run.id }), 'Stopped. Finished assets are kept.'); }
  async function finish() {
    // A retry needs room for what's left; finished assets are never paid for twice. The prompt question (only when a
    // prompt this set used changed since it started) comes first, so the last question is the money one and its Cancel
    // always stops the retry.
    const cap = retryCap(run, unfinished);
    const newer = newerPromptsFor(run, promptChanges);
    const refreshPrompts = newer.length > 0 && await confirm(newestPromptsQuestion(newer, 'set'));
    if (!(await confirm({ title: `Finish the ${plural(unfinished, 'asset')} that didn’t make it?`, lines: [`This can spend up to ${money(Math.max(0, cap - (Number(run.reservedUsd) || 0)))} more. Finished assets aren’t made again.`, refreshPrompts ? 'The unfinished assets use the newest prompts.' : '', run.ai?.route === 'codex' ? CODEX_UNCAPPED : ''], confirmLabel: 'Finish them' }))) return;
    await action(() => api.retryStudioRun({ runId: run.id, maxBudgetUsd: cap, ...(refreshPrompts ? { refreshPrompts: true } : {}) }), 'Finishing the rest. Assets appear here as they’re ready.');
  }
  return <section className="simple-kit-run" aria-label={run.kit.folderName}>
    <header className="simple-kit-run-head" data-spot="kit.run">
      <span className="simple-kit-run-icon"><FolderOpen size={22} aria-hidden="true" /></span>
      <div><h2>{run.kit.folderName}</h2><p>{[runSummary(run), run.costUsd > 0 ? `${money(run.costUsd)}${live ? ' so far' : ''}` : '', run.ai?.route === 'codex' ? 'Codex' : run.ai?.model ? modelName(run.ai.model) : ''].filter(Boolean).join(' · ')}</p></div>
    </header>
    {live && <div className="simple-kit-progress" role="progressbar" aria-label="Assets ready" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${Math.max(4, Math.round((done / Math.max(1, total)) * 100))}%` }} /></div>}
    <div className="simple-kit-run-actions">
      {can('saveAssetKitFolder') && <button type="button" data-spot="kit.save" className="simple-primary" disabled={busy || !assets.length} onClick={() => action(() => api.saveAssetKitFolder({ runId: run.id }), web ? 'Download started.' : 'Saved to your Downloads folder.')}><Download size={15} aria-hidden="true" />{web ? 'Download folder' : 'Save folder'}</button>}
      {googleReady && can('publishStudioRun') && <button type="button" data-spot="kit.drive" className="simple-quiet" title={live ? 'Available when the run finishes' : undefined} {...writeProps(viewer, busy || !assets.length || live)} onClick={() => action(() => api.publishStudioRun({ runId: run.id }), 'Saved to Google Drive.')}><CloudUpload size={15} aria-hidden="true" />Save to Google Drive</button>}
      {delivered && <a className="simple-quiet" href={delivered} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Open in Drive</a>}
      {live && can('cancelStudioRun') && <button type="button" data-spot="kit.stop" className="simple-quiet" {...writeProps(viewer, busy)} onClick={stop}><CircleStop size={15} aria-hidden="true" />Stop</button>}
      {!live && unfinished > 0 && can('retryStudioRun') && <button type="button" data-spot="kit.finish" className="simple-quiet" {...writeProps(viewer, busy)} onClick={finish}><RefreshCw size={15} aria-hidden="true" />Finish the rest</button>}
    </div>
    {list(run.warnings).length > 0 && <p className="simple-kit-note">{run.warnings[0]}</p>}
    {(hasMine || used.size > 1) && <div className="simple-kit-filters">
      {hasMine && <div className="simple-segment" role="group" aria-label="Channels shown">{[['mine', 'Your channels'], ['all', 'All channels']].map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}</div>}
      {used.size > 1 && <label className="simple-status-filter"><span className="sr-only">Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="any">Any status</option>{['draft', 'in-review', 'approved', 'scheduled', 'published'].filter((value) => used.has(value)).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>}
    </div>}
    <div className="simple-kit-channels" data-spot="kit.channels">{channels.map(({ id, name, rows, mine }) => <section className={`simple-kit-channel${mine ? ' is-mine' : ''}`} key={id} aria-label={name}>
      <h3><Folder size={16} aria-hidden="true" /><span>{name}</span>{mine && <em className="simple-kit-mine">Yours</em>}<small>{rows.filter((job) => job.status === 'succeeded').length}/{rows.length}</small></h3>
      <ul>{rows.map((job) => <KitFile key={job.id} job={job} run={run} live={live} api={api} onNotice={onNotice} assets={assets.filter((asset) => asset.deliverableId === job.id)} cache={cache} onOpenFile={onOpenFile} onOpenPicture={onOpenPicture} />)}</ul>
    </section>)}{!channels.length && <p className="simple-kit-note">{status !== 'any' ? `Nothing here is marked ${statusLabel(status)}.` : 'Nothing for your channels in this set.'} <button type="button" className="simple-link" onClick={() => { setStatus('any'); setScope('all'); }}>Show everything</button></p>}</div>
  </section>;
}

function JobState({ job }) {
  if (job.status === 'succeeded') return <span className="simple-kit-state done" title="Ready"><Check size={13} aria-hidden="true" /></span>;
  if (job.status === 'running') return <span className="simple-kit-state" title="Working"><LoaderCircle className="spin" size={14} aria-hidden="true" /></span>;
  if (job.status === 'queued' || job.status === 'cancelled') return <span className="simple-kit-state waiting" title={job.status === 'cancelled' ? 'Stopped' : 'Waiting'} />;
  return <span className="simple-kit-state problem" title={job.error || 'Needs another try'}><TriangleAlert size={13} aria-hidden="true" /></span>;
}
function KitFile({ job, run, live, assets, cache, api, onNotice, onOpenFile, onOpenPicture }) {
  // The short video: its clip opens in the player, with the on-screen lines saved beside it.
  if (job.kind === 'video') {
    const clip = assets[0];
    return <li className="simple-kit-file is-pictures">
      <span className="simple-kit-file-icon"><Clapperboard size={17} aria-hidden="true" /></span>
      <span className="simple-kit-file-copy"><strong>{job.label}</strong><small>{clip ? `Short video · ${clip.durationSeconds || ''} s` : jobLine(job, null, live)}</small></span>
      <JobState job={job} />
      <span className="simple-kit-thumbs">{clip ? <button type="button" aria-label={`Play ${clip.title}`} onClick={() => onOpenPicture(clip, run)}><VideoTile asset={clip} api={api} title={clip.title} /></button> : <span className={`simple-kit-thumb-empty${job.status === 'running' ? ' shimmer' : ''}`} />}</span>
    </li>;
  }
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
  return <li className={asset ? 'has-status' : undefined}><button type="button" className="simple-kit-file" disabled={!asset} onClick={() => onOpenFile(asset, run)} aria-label={asset ? `Open ${job.label}` : undefined}>
    <span className="simple-kit-file-icon">{job.id === 'landingpage' ? <LayoutTemplate size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span>
    <span className="simple-kit-file-copy"><strong>{job.label}</strong><small title={job.error || undefined}>{jobLine(job, asset, live)}</small></span>
    <JobState job={job} />
  </button>{asset && <AssetStatusMenu api={api} asset={asset} align="end" onNotice={onNotice} />}</li>;
}

// A written asset, read in place: copy it, open the file, page through the run with ← and →, or (admins and editors)
// edit it. An edit is saved beside the original, so the folder, its download and later sets use the new text.
function KitFileViewer({ api, web, busy, action, file, folder, label, brand = null, onAsk, onNotice, onClose, onMove }) {
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
  const panel = useRef(null);
  useModalFocus(panel);
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
  // copyText falls back to a hidden selection where the clipboard API is refused (plain HTTP, a denied permission).
  async function copy() { if (await copyText(markdown)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } else onNotice?.('The text couldn’t be copied. Select it and copy it instead.', { tone: 'error' }); }
  function saved(result) {
    setEditing(false);
    if (result?.restored) { setReloadKey((value) => value + 1); return; }
    const row = result?.asset?.edited;
    setPayload((current) => ({ ...(current || {}), markdown: result?.markdown ?? markdown, edited: row?.at ? { at: row.at, byName: row.byName || row.by?.name || '' } : current?.edited || null }));
  }
  return <div className="simple-lightbox" role="dialog" aria-modal="true" aria-label={label || asset.title} ref={panel} tabIndex={-1} onKeyDown={(event) => trapTab(event, panel.current)} onClick={close}>
    <div className={`simple-kit-viewer${editing ? ' is-editing' : ''}`} onClick={(event) => event.stopPropagation()}>
      <header className="simple-kit-viewer-bar">
        <span><small>{[folder, label, edited ? `Edited by ${edited.byName || 'someone'}${edited.at ? ` · ${formatDay(edited.at)}` : ''}` : ''].filter(Boolean).join(' · ')}</small><strong>{asset.title}</strong></span>
        <AssetStatusMenu api={api} asset={asset} onNotice={onNotice} />
        {!editing && <div className="simple-reader-tools">
          {canEdit && <button type="button" {...writeProps(viewer, !markdown)} onClick={() => setEditing(true)}><PenLine size={15} aria-hidden="true" />Edit</button>}
          <button type="button" disabled={!markdown} onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy text'}</button>
          <button type="button" disabled={busy} onClick={() => action(() => api.openStudioAsset({ assetId: asset.id }), web ? 'Download started.' : '')}>{web ? <Download size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}{web ? 'Download' : asset.deliverableId === 'landingpage' ? 'Open the page' : 'Open file'}</button>
        </div>}
        <button type="button" className="simple-lightbox-close" aria-label="Close" onClick={close}><X size={18} /></button>
      </header>
      <div className="simple-kit-viewer-body" ref={body}>
        {editing ? <AssetEditor api={api} asset={asset} markdown={markdown} edited={loadedEdit} action={action} web={web} onSaved={saved} onCancel={() => setEditing(false)} brand={brand} onAsk={onAsk ? (text, context) => { onClose(); onAsk(text, context); } : undefined} />
          : <article className="simple-doc">{error ? <p className="simple-error" role="alert">{error}</p> : !payload ? <div className="simple-doc-skeleton" role="status" aria-label="Opening the file"><span /><span /><span /><span /><span /></div> : markdown ? <MarkdownContent>{markdown}</MarkdownContent> : <p className="simple-error">This file has no readable text. Try Open file.</p>}</article>}
      </div>
    </div>
  </div>;
}
