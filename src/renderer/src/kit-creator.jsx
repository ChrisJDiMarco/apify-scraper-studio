import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, FileText, Folder, Image as ImageIcon, Link2, LoaderCircle, Search, Sparkles, Upload, X, Clapperboard } from 'lucide-react';
import { trapTab, useModalFocus, useToast } from './role-screens.jsx';
import { useViewer, writeProps } from './viewer.js';
import { formatDate, friendlyMessage, number } from './ui.jsx';
import { uncappedLine } from './cost-lines.js';
import { SOURCE_LABEL } from '../../shared/library-tree.js';
import './simple-mode.css';
import './library.css';

// Make channel assets, in either layout: pick the report (one in the library, a Google Doc link, or pasted text), check
// what will be made and what it can cost, then start. Nothing is spent until "Make" is pressed. Simple's Assets mounts
// KitCreator itself; every other layout (and Ask AI's Make channel assets) opens it through KitCreatorHost, over the page
// the person is on, so nobody's saved layout changes to make a set.
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const sentence = (value) => String(value || '').replace(/^./, (letter) => letter.toUpperCase());
export const MAX_SOURCE_CHARS = 250000;
// What each picture set sends the image model besides its prompt (Settings → Brand reference images).
const referenceTitle = (references) => (references?.style || references?.logo ? `Sends ${[references.style ? plural(references.style, 'style example') : '', references.logo ? 'the approved logo' : ''].filter(Boolean).join(' and ')}` : 'No brand reference images yet');
// The seconds and model of a set's short video, for the chip and the estimate.
const videoName = (item) => `Short video · ${item.video?.seconds || 8} s`;
function referenceHint(items) {
  const sets = items.filter((item) => item.kind === 'image');
  const using = sets.filter((item) => item.references?.style || item.references?.logo).length; const logos = sets.filter((item) => item.references?.logo).length;
  return using ? `Brand reference images: ${using} of ${plural(sets.length, 'picture set')}${logos ? `, ${logos} with the approved logo` : ''}.` : 'No brand reference images yet, so pictures follow the brand colors and leave the footer clean.';
}

// Reports a kit can come from, as the Reports tab lists them; a trend's report and toolkit are one choice.
export function kitSourcesFrom(reports, contentRuns) {
  const runs = new Map(list(contentRuns).map((run) => [run.id, run])); const seen = new Set(); const rows = [];
  for (const report of list(reports)) {
    const run = runs.get(report.runId);
    if (run?.themeId && ['evidence-report', 'editorial-toolkit'].includes(report.deliverableId)) {
      if (seen.has(run.id)) continue; seen.add(run.id);
      const pair = reports.filter((row) => row.runId === run.id);
      rows.push({ key: run.id, assetId: (pair.find((row) => row.deliverableId === 'evidence-report') || report).id, title: run.title || report.title || 'Trend', detail: pair.length > 1 ? 'Trends report + editorial toolkit' : 'Trends report', createdAt: report.createdAt });
    } else rows.push({ key: report.id, assetId: report.id, title: report.title || 'Report', detail: sentence(report.channel) || 'Report', createdAt: report.createdAt });
  }
  return rows;
}

// `preset` ({ key, source?, mode?, link?, channels? }): a fixed source opens on the review step; `channels` (channel ids)
// pre-ticks those channels' assets instead of the person's own (My channels, `focus`).
export function KitCreator({ api, sources = [], preset, imagesReady, action, busy, picturesOff = '', focus: focusIn = [], onClose, onCreated, onSettings }) {
  const viewer = useViewer();
  const fixed = preset?.source || null;
  const focus = list(preset?.channels).length ? list(preset.channels).map(String) : list(focusIn);
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
  const [startProblem, setStartProblem] = useState(''); // why Make was refused, shown under the plan so it can be retried
  const first = useRef(null);
  const panel = useRef(null);
  useModalFocus(panel, first);
  const source = fixed || (mode === 'report' ? (picked ? { kind: 'report', assetId: picked } : null)
    : mode === 'link' ? (doc ? { kind: 'upload', title: doc.title, text: doc.text, url: doc.url, format: 'google-doc' } : null)
    : text.trim() ? (file ? { kind: 'upload', title: title.trim() || file.title, text, fileName: file.fileName || '' } : { kind: 'text', title: title.trim(), text }) : null);
  // Each step lands focus on its first field, or on the sheet itself (the review step, an empty list), which reads its title.
  const opened = useRef(false);
  useEffect(() => { if (!opened.current) { opened.current = true; return; } (first.current || panel.current)?.focus({ preventScroll: true }); }, [step, mode]);
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
  // My channels (or the channels asked for): the first plan pre-ticks only those channels' assets (more can be ticked).
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!plan || focused || chosen || !focus.length) return;
    setFocused(true);
    const mine = list(plan.folders).filter((folder) => focus.includes(folder.id)).flatMap((folder) => folder.items).filter((item) => item.available).map((item) => item.id);
    if (mine.length) setChosen(new Set(mine));
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusNames = list(plan?.folders).filter((folder) => focus.includes(folder.id)).map((folder) => folder.name);
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
    if (current.size) { setChosen(current); setStartProblem(''); }
  }
  // A refused Make (a signed-out AI route, a budget the server won't take) is said here, in the dialog: the page's own
  // banner sits behind this sheet.
  async function start() {
    if (!plan || !source) return;
    setStarting(true); setStartProblem('');
    try {
      const run = await action(() => api.createAssetKit({ source, ...(chosen ? { deliverableIds: [...chosen] } : {}), maxBudgetUsd: plan.estimate.capUsd }), `Making ${plural(plan.estimate.calls, 'asset')}. They’ll fill this folder as they’re ready.`, true);
      setStarting(false);
      if (run) onCreated(run, plan);
    } catch (failure) {
      setStarting(false);
      setStartProblem(friendlyMessage(failure) || 'The assets couldn’t be started. Try again.');
    }
  }
  const selected = list(plan?.folders).flatMap((folder) => folder.items).filter((item) => item.selected);
  const pictures = selected.filter((item) => item.kind === 'image').reduce((sum, item) => sum + (item.pictures || 0), 0);
  const tabs = [['report', 'Your reports', FileText], ['link', 'Google Doc link', Link2], ['paste', 'Paste text', ClipboardCopy]];
  return <div className="simple-sheet" role="dialog" aria-modal="true" aria-labelledby="simple-kit-title" ref={panel} tabIndex={-1} onKeyDown={(event) => trapTab(event, panel.current)}>
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
              <span className="simple-kit-plan-items">{folder.items.map((item) => { const name = item.kind === 'video' ? videoName(item) : `${sentence(item.label.replace(/^[^—]+—\s*/, ''))}${item.kind === 'image' ? ` ×${item.pictures}` : ''}`; const off = item.kind === 'video' ? (onSettings ? item.unavailable || 'Connect fal.ai in Settings, AI connections to make videos' : 'Videos are off. Ask an admin to turn them on.') : onSettings ? 'Turn on pictures in Settings to include these' : picturesOff; return <button type="button" key={item.id} className="simple-check-chip" role="checkbox" aria-checked={item.selected} aria-label={name} disabled={!item.available || starting || planning} title={!item.available ? off : item.kind === 'image' ? referenceTitle(item.references) : undefined} onClick={() => toggle(item.id)}>
                <span className="simple-check" aria-hidden="true">{item.selected && <Check size={12} />}</span>{item.kind === 'image' ? <ImageIcon size={13} aria-hidden="true" /> : item.kind === 'video' ? <Clapperboard size={13} aria-hidden="true" /> : null}{name}
              </button>; })}</span>
            </div>)}</div>
            {focused && focusNames.length > 0 && <p className="simple-hint">{list(preset?.channels).length ? 'Ticked for' : 'Ticked for your channels'}: {focusNames.join(', ')}. Tick more if you need them.</p>}
            {!plan.imagesReady && (onSettings ? <p className="simple-hint">Pictures are off. <button type="button" className="simple-link" onClick={onSettings}>Turn them on in Settings</button> to add the hero graphics.</p> : <p className="simple-hint">{picturesOff} Only the written drafts are made until then.</p>)}
            {plan.imagesReady && pictures > 0 && <p className="simple-hint" data-spot="kit-dialog.references">{referenceHint(selected)}{onSettings && <> <button type="button" className="simple-link" disabled={starting} onClick={onSettings}>{selected.some((item) => item.references?.style || item.references?.logo) ? 'Change them in Settings' : 'Add style examples and logos in Settings'}</button></>}</p>}
            {plan.imagesReady && selected.filter((item) => item.kind === 'image' && !item.references?.style && !item.references?.logo).map((item) => <p key={`refs-${item.id}`} className="simple-hint">{sentence(item.label.replace(/^[^—]+—\s*/, ''))} has no reference images yet, so its pictures follow the brand colors only.</p>)}
            {selected.some((item) => item.kind === 'video') && <p className="simple-hint">Words in AI video often come out garbled, so the clip has none; the on-screen lines are saved beside it to add in your editor.</p>}
            {list(plan.folders).flatMap((folder) => folder.items).some((item) => item.kind === 'video' && !item.available) && !selected.some((item) => item.kind === 'video') && <p className="simple-hint">{onSettings ? <>Short videos need fal.ai. <button type="button" className="simple-link" disabled={starting} onClick={onSettings}>Connect it in Settings</button> to add one.</> : 'Videos are off. Ask an admin to turn them on.'}</p>}
            <div className="simple-kit-estimate" data-spot="kit-dialog.estimate">
              <div><strong>{plural(selected.length, 'asset')}</strong><small>{[plural(plan.folders.filter((folder) => folder.items.some((item) => item.selected)).length, 'folder'), pictures ? plural(pictures, 'picture') : ''].filter(Boolean).join(' · ')}</small></div>
              {plan.route === 'codex'
                ? <div><strong>Your Codex plan</strong><small>Codex doesn’t report costs{pictures ? '; pictures use OpenAI' : ''}</small></div>
                : <div><strong>About {money(plan.estimate.totalUsd)}</strong><small>Stops at {money(plan.estimate.capUsd)} at most</small></div>}
              <div><strong>About {number(plan.minutes)} minutes</strong><small>{plan.routes ? [`${plan.routes.writes} writes`, pictures ? `${plan.routes.draws} draws` : '', selected.some((item) => item.kind === 'video') ? `${plan.routes.films} films` : ''].filter(Boolean).join(', ') : `${plan.route === 'codex' ? 'Codex' : plan.estimate.modelLabel} writes${pictures ? ', OpenAI draws' : ''}`}</small></div>
            </div>
            {selected.filter((item) => item.kind === 'video').map((item) => <p key={`video-${item.id}`} className="simple-hint">{Number.isFinite(item.usd) ? `Video: about ${money(item.usd)} (${item.video?.seconds || 8} seconds${item.video?.modelLabel ? ` on ${item.video.modelLabel}` : ''}).` : 'Includes a short video (a few minutes).'}</p>)}
            {uncappedLine(plan) && <p className="simple-hint">{uncappedLine(plan)}</p>}
            {list(plan.warnings).length > 0 && <p className="simple-hint">{plan.warnings[0]}</p>}
            {startProblem && <p className="simple-error" role="alert">{startProblem}</p>}
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

// The asset dialog for any layout outside Simple's Assets. `request` ({ key, source?, channels?, mode?, link? }) opens it
// once per key; after Make, a toast offers Open folder (onOpenFolder(sourceKey), Simple's Assets or the Library folder).
// `edition` keeps the Simple sheet's accent in the General studio.
export function KitCreatorHost({ request, api, sources, imagesReady, action, busy, picturesOff, focus, edition = 'semrush', onSettings, onOpenFolder, onDone }) {
  const [open, setOpen] = useState(null);
  const [toast, showToast] = useToast(9000);
  const seen = useRef(null);
  useEffect(() => { if (!request?.key || seen.current === request.key) return; seen.current = request.key; setOpen(request); }, [request?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  function close() { setOpen(null); onDone?.(); }
  function created(run, plan) {
    setOpen(null); onDone?.();
    const key = run?.kit?.sourceKey || '';
    showToast(`Making ${plural(plan?.estimate?.calls || list(run?.jobs).length || 0, 'asset')}${run?.kit?.sourceTitle ? ` from “${run.kit.sourceTitle}”` : ''}. They fill the folder as they’re ready.`, key && onOpenFolder ? { actionLabel: 'Open folder', onAction: () => onOpenFolder(key) } : {});
  }
  if (!open && !toast) return null;
  // The toast below is the one note after Make (with Open folder): the shell's banner gets no success message, since no
  // folder is open here. A refusal still comes back to the dialog (throwOnError).
  const quietAction = (work, _message, throwOnError) => action(work, '', throwOnError);
  return <div className="simple-shell kit-creator-host" data-edition={edition}>
    {open && <KitCreator key={open.key} api={api} sources={sources} preset={open} imagesReady={imagesReady} action={quietAction} busy={busy} picturesOff={picturesOff} focus={focus} onClose={close} onCreated={created} onSettings={onSettings ? () => { close(); onSettings(); } : undefined} />}
    {toast}
  </div>;
}
