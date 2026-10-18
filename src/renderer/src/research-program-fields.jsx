import React, { useEffect, useRef, useState } from 'react';
import { Bot, CircleAlert, Gauge, LoaderCircle } from 'lucide-react';
import AI_MODELS from '../../shared/ai-models.json';
import AI_TASKS from '../../shared/ai-tasks.json';
import AI_PROVIDERS from '../../shared/ai-providers.json';
import { number } from './ui.jsx';
import { ModelPicker, modelName } from './model-picker.jsx';
import { uncappedLine } from './cost-lines.js';

// Program form sections for n8n parity: the date window (n8n defaults to the last 7 days),
// per-stage models and effort (n8n ran Opus for discovery/synthesis/matching and Fable for
// tagging and reports), unattended approval, Drive publishing and a live cost estimate.
// The Claude models from the studio's catalog (src/shared/ai-models.json), as [id, label] pairs.
export const RESEARCH_MODELS = AI_MODELS.text.filter((entry) => entry.family === 'claude').map((entry) => [entry.id, entry.label]);
export const DEFAULT_PROGRAM_AI = { models: { discovery: 'claude-opus-5-5', synthesis: 'claude-opus-5-5', matching: 'claude-opus-5-5', tagging: 'claude-fable-5-1', reports: 'claude-fable-5-1' }, effort: { discovery: 'medium', synthesis: 'high', matching: 'medium', tagging: 'low', reports: 'high' }, concurrency: 3 };
export const DEFAULT_COLLECTION = { xMaxItemsPerHandle: 50, xHandlesPerJob: 5, linkedinPostsPerProfile: 15, linkedinProfilesPerJob: 100, redditPostsPerSub: 300, redditScrollTimeoutSecs: 300, redditSubsPerJob: 6, laneConcurrency: 4 };
const STAGES = [['discovery', 'Trend discovery', 'Reads 200-post batches per platform'], ['synthesis', 'Theme synthesis', 'Distills the top six themes'], ['matching', 'Theme matching', 'Compares with tracked themes'], ['tagging', 'Post tagging', 'Classifies every post'], ['reports', 'Reports & toolkits', 'Writes the paired documents']];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const money = (value) => (Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—');
function Field({ id, label, hint, children }) { return <div className="cs-field"><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }

// `idPrefix` ('cs' on the Research programs page, 'pd' in Home's program drawer) keeps ids and radio names unique when
// both forms are on screen.
export function ProgramWindowFields({ draft, setDraft, idPrefix = 'cs' }) {
  const p = idPrefix;
  const custom = Boolean(draft.window?.startDate);
  const setWindow = (patch) => setDraft((current) => ({ ...current, window: { ...current.window, ...patch } }));
  return <>
    <div className="cs-choice-row" role="radiogroup" aria-label="Date window">
      <label><input type="radio" name={`${p}-window-mode`} checked={!custom} onChange={() => setWindow({ startDate: '', endDate: '' })} />Last few days (n8n default)</label>
      <label><input type="radio" name={`${p}-window-mode`} checked={custom} onChange={() => setWindow({ startDate: new Date(Date.now() - (draft.lookbackDays || 7) * 86400000).toISOString().slice(0, 10) })} />Custom dates</label>
    </div>
    {custom ? <div className="cs-two-fields"><Field id={`${p}-window-start`} label="Start date"><input id={`${p}-window-start`} type="date" value={draft.window.startDate || ''} onChange={(event) => setWindow({ startDate: event.target.value })} /></Field><Field id={`${p}-window-end`} label="End date" hint="Optional. Inclusive UTC dates; leave empty to search up to now."><input id={`${p}-window-end`} type="date" value={draft.window.endDate || ''} min={draft.window.startDate || undefined} onChange={(event) => setWindow({ endDate: event.target.value })} /></Field></div>
      : <div className="cs-lookback-field"><Field id={`${p}-program-lookback`} label="Search the last (days)" hint="Each run searches from this many days before it starts, up to now."><input id={`${p}-program-lookback`} type="number" min="1" max="365" step="1" value={draft.lookbackDays ?? 7} onChange={(event) => setDraft((current) => ({ ...current, lookbackDays: Number(event.target.value) }))} /></Field></div>}
  </>;
}

// A program's own AI choices per stage (ai.overrides). Every stage follows Settings → Model routing ("Studio default") unless
// the program chooses its own connection, model and effort; those win for this program's runs. A program saved before
// overrides existed shows the stages whose model or effort differ from the shipped defaults as its choices.
const STAGE_TASK = { discovery: 'research.discovery', synthesis: 'research.synthesis', matching: 'research.matching', tagging: 'research.tagging', reports: 'reports.trends-report' };
const TEXT_ROUTES = ['auto', 'claude', 'claude-api', 'codex', 'openai', 'openrouter'];
const ROUTE_LABEL = Object.fromEntries([...AI_PROVIDERS.connections, ...AI_PROVIDERS.pseudo].map((entry) => [entry.id, entry.label]));
export function programOverrides(ai = {}) {
  if (ai && typeof ai.overrides === 'object' && ai.overrides) return { ...ai.overrides };
  const out = {};
  for (const [stage] of STAGES) {
    const model = ai?.models?.[stage]; const effort = ai?.effort?.[stage];
    const entry = { ...(model && model !== DEFAULT_PROGRAM_AI.models[stage] ? { model } : {}), ...(effort && effort !== DEFAULT_PROGRAM_AI.effort[stage] ? { effort } : {}) };
    if (Object.keys(entry).length) out[stage] = entry;
  }
  return out;
}
// What the studio runs for a stage when the program doesn't choose: saved Model routing when it can be read, else the
// shipped defaults.
function studioDefault(stage, routing) {
  const task = AI_TASKS.tasks.find((row) => row.id === STAGE_TASK[stage]);
  const chosen = routing?.tasks?.[STAGE_TASK[stage]] || {};
  const route = chosen.route || routing?.defaults?.text?.route || AI_TASKS.defaults.text.route;
  const model = chosen.model ?? task?.default?.model ?? '';
  const effort = chosen.effort ?? task?.default?.effort ?? '';
  return `${modelName(route, 'text', route === 'codex' ? '' : model) || model}${effort && route !== 'codex' ? ` · ${effort}` : ''}, ${ROUTE_LABEL[route] || route}`;
}
// `open` shows the stages without the disclosure (Home's program drawer, where the group has its own heading).
export function ProgramAiFields({ draft, setDraft, api, routing: given = null, idPrefix = 'cs', open = false }) {
  const p = idPrefix;
  // The studio's saved routing names each stage's default (admins can read it; for others the shipped defaults show).
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (given || typeof api?.previewAiRouting !== 'function') return undefined;
    let live = true; Promise.resolve().then(() => api.previewAiRouting({})).then((result) => { if (live) setLoaded(result?.routing || null); }).catch(() => {});
    return () => { live = false; };
  }, [api, given]);
  const routing = given || loaded;
  const ai = { ...DEFAULT_PROGRAM_AI, ...(draft.ai || {}), models: { ...DEFAULT_PROGRAM_AI.models, ...(draft.ai?.models || {}) }, effort: { ...DEFAULT_PROGRAM_AI.effort, ...(draft.ai?.effort || {}) } };
  const overrides = programOverrides(draft.ai);
  const write = (next) => setDraft((current) => ({ ...current, ai: { ...(current.ai || {}), overrides: next, concurrency: ai.concurrency } }));
  const setStage = (stage, entry) => { const next = { ...overrides }; if (entry) next[stage] = entry; else delete next[stage]; write(next); };
  const body = <div>
    <p>Each stage uses the studio’s choice in Settings → Model routing unless this program chooses its own. A program’s own choice wins for its runs. Lower effort is cheaper; tagging works well at low.</p>
    <div className="cs-stage-grid" role="table" aria-label="AI per stage">{STAGES.map(([stage, label, hint]) => {
      const own = overrides[stage]; const route = own?.route || 'auto';
      return <div className="cs-stage-row" role="row" key={stage}>
        <div role="cell"><strong>{label}</strong><small>{hint}</small></div>
        <div role="cell"><label className="cs-sr-only" htmlFor={`${p}-ai-choice-${stage}`}>{label}: who chooses</label>
          <select id={`${p}-ai-choice-${stage}`} value={own ? 'own' : 'studio'} onChange={(event) => setStage(stage, event.target.value === 'own' ? { model: ai.models[stage], effort: ai.effort[stage] } : null)}>
            <option value="studio">Studio default ({studioDefault(stage, routing)})</option>
            <option value="own">Choose for this program…</option>
          </select></div>
        {own && <div role="cell" className="cs-stage-own">
          <label className="cs-sr-only" htmlFor={`${p}-route-${stage}`}>{label} connection</label>
          <select id={`${p}-route-${stage}`} value={route} onChange={(event) => { const next = event.target.value; setStage(stage, { ...(next === 'auto' ? {} : { route: next }), model: next === 'codex' ? '' : next === 'openrouter' ? '' : own.model || ai.models[stage], ...(own.effort && next !== 'codex' ? { effort: own.effort } : {}) }); }}>
            {TEXT_ROUTES.map((value) => <option key={value} value={value}>{ROUTE_LABEL[value]}</option>)}
          </select>
          <ModelPicker id={`${p}-model-${stage}`} label={`${label} model`} route={route} kind="text" value={own.model || ''} api={api} onChange={(model) => setStage(stage, { ...own, model })} />
          <label className="cs-sr-only" htmlFor={`${p}-effort-${stage}`}>{label} effort</label>
          <select id={`${p}-effort-${stage}`} value={own.effort || ''} onChange={(event) => setStage(stage, { ...own, effort: event.target.value })}><option value="">Model default</option>{EFFORTS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
        </div>}
      </div>;
    })}</div>
    <Field id={`${p}-ai-concurrency`} label="Batches at once" hint="How many discovery or tagging batches run in parallel (1–6)."><input id={`${p}-ai-concurrency`} type="number" min="1" max="6" step="1" value={ai.concurrency} onChange={(event) => setDraft((current) => ({ ...current, ai: { ...(current.ai || ai), concurrency: Number(event.target.value) } }))} /></Field>
  </div>;
  return open ? <div className="cs-ai-stages is-open">{body}</div> : <details className="cs-details cs-ai-stages"><summary><Bot size={14} aria-hidden="true" />AI for this program</summary>{body}</details>;
}

export function ProgramAutomationFields({ draft, setDraft, capabilities = {} }) {
  return <div className="cs-automation-fields">
    <label className="cs-check"><input type="checkbox" checked={Boolean(draft.autoApproveThemes)} onChange={(event) => setDraft((current) => ({ ...current, autoApproveThemes: event.target.checked }))} /><span><strong>Approve themes automatically</strong><small>Runs end to end without stopping for review, like the n8n workflow. Leave off to choose themes on the Trend board first.</small></span></label>
    {/* Drive is one studio-wide switch now (Settings → Google Drive); a program's saved delivery.publishToDrive is kept and
        only read until a Drive folder is connected (drive-sync.js legacyPublish). */}
    <p className="cs-drive-note"><strong>Google Drive</strong><small>{capabilities.driveAutoAdd ? `Every new report is added to “${capabilities.driveFolderName || 'the Drive folder'}” in Google Drive automatically.` : draft.delivery?.publishToDrive ? 'This program still publishes its reports to Google Drive the older way until an admin connects a folder in Settings → Google Drive.' : 'An admin can add every new report to a Google Drive folder in Settings → Google Drive.'}</small></p>
  </div>;
}

const splitTargets = (value) => (Array.isArray(value) ? value : String(value || '').split(/[,\r\n]+/).map((entry) => entry.trim()).filter(Boolean));
// Something to price: an enabled source group with targets, or LinkedIn keyword search with a research focus.
export const hasProgramSources = (draft = {}) => (Array.isArray(draft.sourceGroups) ? draft.sourceGroups : []).some((group) => group?.enabled && (splitTargets(group.targets).length > 0 || (group.sourceId === 'linkedin-search' && Boolean(String(draft.query || '').trim()))));

// Three states: no sources (nothing to price), estimating (the first answer is on its way; later ones keep the last
// numbers on screen, dimmed), and ready. Each request is tied to the draft it priced, so a slow answer for an older
// draft never replaces a newer one.
// `onEstimate(result | null)` hears each answer (the drawer lists it when a schedule is turned on).
export function ProgramEstimate({ draft, api, onEstimate }) {
  const [estimate, setEstimate] = useState(null); const [error, setError] = useState(''); const [status, setStatus] = useState('idle');
  const timer = useRef(); const version = JSON.stringify({ sourceGroups: draft.sourceGroups, ai: draft.ai, targetPerPlatform: draft.targetPerPlatform, perAuthorCap: draft.perAuthorCap, maxThemes: draft.maxThemes, collection: draft.collection, taggingBatchSizes: draft.taggingBatchSizes, discoveryBatchSize: draft.discoveryBatchSize, budgets: draft.budgets, window: draft.window, lookbackDays: draft.lookbackDays, query: draft.query, topicFiltersTargets: draft.topicFiltersTargets });
  const hasSources = hasProgramSources(draft);
  const heard = useRef(onEstimate); heard.current = onEstimate;
  useEffect(() => { heard.current?.(status === 'ready' ? estimate : null); }, [estimate, status]);
  useEffect(() => {
    if (!api.estimateResearchProgram) return undefined;
    clearTimeout(timer.current);
    if (!hasSources) { setEstimate(null); setError(''); setStatus('idle'); return undefined; }
    let stale = false;
    setStatus('loading');
    timer.current = setTimeout(() => {
      const payload = { ...draft, name: draft.name || 'Draft program', sourceGroups: draft.sourceGroups.map((group) => ({ ...group, targets: splitTargets(group.targets) })) };
      Promise.resolve().then(() => api.estimateResearchProgram(payload)).then((result) => { if (stale) return; setEstimate(result || null); setError(result ? '' : 'No estimate came back. Change a field to try again.'); setStatus('ready'); }).catch((failure) => { if (stale) return; setEstimate(null); setError(String(failure?.message || failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); setStatus('ready'); });
    }, 450);
    return () => { stale = true; clearTimeout(timer.current); };
  }, [version, hasSources]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!api.estimateResearchProgram) return null;
  const loading = status === 'loading';
  const ai = estimate?.ai; const collection = estimate?.collection;
  const aiShort = ai && Number(draft.budgets?.aiUsd) < ai.totalUsd; const collectionShort = collection?.worstCaseUsd && Number(draft.budgets?.collectionUsd) < collection.worstCaseUsd;
  // Mirrors the start check in content-workspace.js: a collecting run is refused below half of what it needs before review (or of the whole run when themes are auto-approved).
  const required = ai ? (draft.autoApproveThemes ? ai.totalUsd : Number(ai.stages?.discovery || 0) + Number(ai.stages?.synthesis || 0) + Number(ai.stages?.matching || 0)) : 0;
  const aiBlocked = required > 0 && Number(draft.budgets?.aiUsd) < required * 0.5;
  return <div className={`cs-estimate${loading && estimate ? ' is-updating' : ''}`} aria-live="polite" aria-busy={(loading && Boolean(estimate)) || undefined}><div className="cs-estimate-head"><Gauge size={16} aria-hidden="true" /><strong>Estimated cost per run</strong>{loading && estimate && <span className="cs-estimate-updating"><LoaderCircle className="spin" size={13} aria-hidden="true" />Updating…</span>}</div>
    {!hasSources ? <p className="cs-estimate-note">Add sources to see an estimate.</p> : error && !loading ? <p className="cs-estimate-note">{error}</p> : !estimate ? <p className="cs-estimate-note cs-estimate-loading"><LoaderCircle className="spin" size={14} aria-hidden="true" />Estimating…</p> : <>
      <dl className="cs-estimate-grid">
        <div><dt>Apify collection</dt><dd>up to {money(collection?.worstCaseUsd)}</dd><small>{collection?.jobCount ? `${number(collection.jobCount)} Actor jobs, all platforms at once` : collection?.error || ''}</small></div>
        <div><dt>AI (all stages)</dt><dd>about {money(ai?.totalUsd)}</dd><small>{number(ai?.posts?.total || 0)} posts · {number(ai?.batches?.discovery || 0)} discovery and {number(ai?.batches?.tagging || 0)} tagging batches</small></div>
      </dl>
      {ai && <p className="cs-estimate-stages">{Object.entries(ai.stages).map(([stage, value]) => `${stage} ${money(value)}`).join(' · ')}</p>}
      {aiBlocked && <p className="cs-estimate-warning cs-estimate-blocked"><CircleAlert size={14} aria-hidden="true" />{`A run that collects new posts will not start with this AI budget (${money(draft.budgets?.aiUsd)}). It needs at least ${money(Math.ceil(required * 50) / 100)}, half of the ${money(required)} ${draft.autoApproveThemes ? 'for a full unattended run' : 'to discover themes'}; about ${money(ai.totalUsd)} covers every stage.`}</p>}
      {((aiShort && !aiBlocked) || collectionShort) && <p className="cs-estimate-warning"><CircleAlert size={14} aria-hidden="true" />{aiShort && !aiBlocked ? `The AI budget (${money(draft.budgets.aiUsd)}) is below the estimate; a run stops when it runs out and resumes with a higher budget.` : ''}{aiShort && !aiBlocked && collectionShort ? ' ' : ''}{collectionShort ? `The collection budget (${money(draft.budgets.collectionUsd)}) is below the worst case; busy sources may stop early.` : ''}</p>}
      {uncappedLine(estimate) && <p className="cs-estimate-note">{uncappedLine(estimate)}</p>}
      <p className="cs-estimate-note">Estimates use list prices; actual Apify and AI costs are recorded on each run.</p>
    </>}
  </div>;
}

export function ProgramCollectionFields({ draft, setDraft, idPrefix = 'cs' }) {
  const p = idPrefix;
  const values = { ...DEFAULT_COLLECTION, ...(draft.collection || {}) };
  const sizes = { x: 50, linkedin: 40, reddit: 50, ...(draft.taggingBatchSizes || {}) };
  const set = (key, value) => setDraft((current) => ({ ...current, collection: { ...values, [key]: value } }));
  const fields = [['xHandlesPerJob', 'X handles per Apify run', 1, 500, 'Fewer handles per run is cheaper per tweet.'], ['xMaxItemsPerHandle', 'X tweet ceiling per handle', 10, 1000, 'A cost ceiling; the per-author cap applies after.'], ['linkedinPostsPerProfile', 'LinkedIn posts per profile', 1, 100, 'n8n uses 15.'], ['linkedinProfilesPerJob', 'LinkedIn profiles per Apify run', 1, 1000], ['redditPostsPerSub', 'Reddit posts per subreddit', 10, 1000, 'n8n uses 300.'], ['redditScrollTimeoutSecs', 'Reddit scroll time (seconds)', 10, 600, 'n8n used 90, which reached only 3–4 days back in busy subreddits.'], ['redditSubsPerJob', 'Reddit communities per Apify run', 1, 50, 'Smaller groups run in parallel and finish sooner.'], ['laneConcurrency', 'Apify runs at once per platform', 1, 10]];
  return <>
    <div className="cs-advanced-grid">{fields.map(([key, label, min, max, hint]) => <Field key={key} id={`${p}-collection-${key}`} label={label} hint={hint}><input id={`${p}-collection-${key}`} type="number" min={min} max={max} step="1" value={values[key]} onChange={(event) => set(key, Number(event.target.value))} /></Field>)}</div>
    <div className="cs-thresholds"><div><h4>Tagging batch size per platform</h4><div className="cs-three-fields">{[['x', 'X'], ['linkedin', 'LinkedIn'], ['reddit', 'Reddit']].map(([platform, label]) => <Field key={platform} id={`${p}-tagging-size-${platform}`} label={label}><input id={`${p}-tagging-size-${platform}`} type="number" min="10" max="200" step="1" value={sizes[platform]} onChange={(event) => setDraft((current) => ({ ...current, taggingBatchSizes: { ...sizes, [platform]: Number(event.target.value) } }))} /></Field>)}</div></div></div>
  </>;
}

// How sure post tagging must be before a post joins a theme, and when a match is accepted without review
// (research-program.js validates 0.55–1, with the automatic threshold at or above the first).
export function ProgramMatchFields({ draft, setDraft, idPrefix = 'cs' }) {
  const p = idPrefix;
  const confidence = Number.isFinite(Number(draft.confidenceThreshold)) ? Number(draft.confidenceThreshold) : 0.55;
  const auto = Number.isFinite(Number(draft.autoAcceptThreshold)) ? Number(draft.autoAcceptThreshold) : Math.max(0.7, confidence);
  return <div className="cs-thresholds cs-match-fields"><div><h4>Theme matching</h4><div className="cs-two-fields">
    <Field id={`${p}-confidence-threshold`} label="Theme match confidence" hint="A tagged post joins a theme at this confidence or higher (0.55–1)."><input id={`${p}-confidence-threshold`} type="number" min="0.55" max="1" step="0.01" value={confidence} onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, confidenceThreshold: value, autoAcceptThreshold: Math.max(value, Number(current.autoAcceptThreshold ?? 0.7)) })); }} /></Field>
    <Field id={`${p}-auto-accept-threshold`} label="Accept matches automatically at" hint="Matches below this wait for review. At least the confidence above."><input id={`${p}-auto-accept-threshold`} type="number" min={confidence} max="1" step="0.01" value={auto} onChange={(event) => setDraft((current) => ({ ...current, autoAcceptThreshold: Number(event.target.value) }))} /></Field>
  </div></div></div>;
}

// Priority and repository context on a discovered theme (n8n Trend Velocity columns).
export function ThemeScore({ theme }) {
  const scoring = theme.scoring; const match = theme.match;
  if (!scoring && !match) return null;
  const tier = scoring?.priorityTier || ''; const tax = scoring?.taxonomy || {};
  return <div className="cs-theme-score">
    {tier && <span className={`cs-tier tier-${tier.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={scoring.autoRationale || ''}>{tier}{Number.isFinite(scoring.priorityScore) ? ` · ${scoring.priorityScore}` : ''}</span>}
    {scoring?.velocity && <span className="cs-theme-chip">{scoring.velocity}{scoring.count > 1 ? ` · seen in ${scoring.count} runs` : ''}</span>}
    {scoring?.gapSignal && <span className="cs-theme-chip">{scoring.gapSignal.replaceAll('_', ' ').toLowerCase()}</span>}
    {tax.category && tax.category !== 'UNMAPPED' && <span className="cs-theme-chip">{tax.category}{tax.zone && tax.zone !== 'UNKNOWN' ? ` · ${tax.zone.toLowerCase()}` : ''}</span>}
    {match?.matched && <span className="cs-theme-chip matched">Matches tracked theme{match.existingName && match.existingName !== theme.name ? ` “${match.existingName}”` : ''}</span>}
    {Array.isArray(theme.nameIssues) && theme.nameIssues.length > 0 && <span className="cs-theme-chip warning">Name: {theme.nameIssues.join(', ').replaceAll('_', ' ')}</span>}
  </div>;
}
