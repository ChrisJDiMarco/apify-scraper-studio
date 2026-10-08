import React, { useEffect, useRef, useState } from 'react';
import { Bot, CircleAlert, Gauge } from 'lucide-react';
import { number } from './ui.jsx';

// Program form sections for n8n parity: the date window (n8n defaults to the last 7 days),
// per-stage models and effort (n8n ran Opus for discovery/synthesis/matching and Fable for
// tagging and reports), unattended approval, Drive publishing and a live cost estimate.
export const RESEARCH_MODELS = [['claude-fable-5-1', 'Claude Fable 5.1'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-haiku-4-5', 'Claude Haiku 4.5']];
export const DEFAULT_PROGRAM_AI = { models: { discovery: 'claude-opus-5-5', synthesis: 'claude-opus-5-5', matching: 'claude-opus-5-5', tagging: 'claude-fable-5-1', reports: 'claude-fable-5-1' }, effort: { discovery: 'medium', synthesis: 'high', matching: 'medium', tagging: 'low', reports: 'high' }, concurrency: 3 };
export const DEFAULT_COLLECTION = { xMaxItemsPerHandle: 50, xHandlesPerJob: 5, linkedinPostsPerProfile: 15, linkedinProfilesPerJob: 100, redditPostsPerSub: 300, redditScrollTimeoutSecs: 90, laneConcurrency: 4 };
const STAGES = [['discovery', 'Trend discovery', 'Reads 200-post batches per platform'], ['synthesis', 'Theme synthesis', 'Distills the top six themes'], ['matching', 'Theme matching', 'Compares with tracked themes'], ['tagging', 'Post tagging', 'Classifies every post'], ['reports', 'Reports & toolkits', 'Writes the paired documents']];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const money = (value) => (Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—');
function Field({ id, label, hint, children }) { return <div className="cs-field"><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }

export function ProgramWindowFields({ draft, setDraft }) {
  const custom = Boolean(draft.window?.startDate);
  const setWindow = (patch) => setDraft((current) => ({ ...current, window: { ...current.window, ...patch } }));
  return <>
    <div className="cs-choice-row" role="radiogroup" aria-label="Date window">
      <label><input type="radio" name="cs-window-mode" checked={!custom} onChange={() => setWindow({ startDate: '', endDate: '' })} />Last few days (n8n default)</label>
      <label><input type="radio" name="cs-window-mode" checked={custom} onChange={() => setWindow({ startDate: new Date(Date.now() - (draft.lookbackDays || 7) * 86400000).toISOString().slice(0, 10) })} />Custom dates</label>
    </div>
    {custom ? <div className="cs-two-fields"><Field id="cs-window-start" label="Start date"><input id="cs-window-start" type="date" value={draft.window.startDate || ''} onChange={(event) => setWindow({ startDate: event.target.value })} /></Field><Field id="cs-window-end" label="End date" hint="Optional. Inclusive UTC dates; leave empty to search up to now."><input id="cs-window-end" type="date" value={draft.window.endDate || ''} min={draft.window.startDate || undefined} onChange={(event) => setWindow({ endDate: event.target.value })} /></Field></div>
      : <div className="cs-lookback-field"><Field id="cs-program-lookback" label="Search the last (days)" hint="Each run searches from this many days before it starts, up to now."><input id="cs-program-lookback" type="number" min="1" max="365" step="1" value={draft.lookbackDays ?? 7} onChange={(event) => setDraft((current) => ({ ...current, lookbackDays: Number(event.target.value) }))} /></Field></div>}
  </>;
}

export function ProgramAiFields({ draft, setDraft }) {
  const ai = { ...DEFAULT_PROGRAM_AI, ...(draft.ai || {}), models: { ...DEFAULT_PROGRAM_AI.models, ...(draft.ai?.models || {}) }, effort: { ...DEFAULT_PROGRAM_AI.effort, ...(draft.ai?.effort || {}) } };
  const set = (group, stage, value) => setDraft((current) => ({ ...current, ai: { ...ai, [group]: { ...ai[group], [stage]: value } } }));
  return <details className="cs-details cs-ai-stages"><summary><Bot size={14} aria-hidden="true" />AI models and effort per stage</summary><div>
    <p>Defaults follow the n8n workflow: Opus for discovery, synthesis and matching; Fable for tagging, reports and toolkits. Lower effort is cheaper; tagging works well at low.</p>
    <div className="cs-stage-grid" role="table" aria-label="Models per stage">{STAGES.map(([stage, label, hint]) => <div className="cs-stage-row" role="row" key={stage}><div role="cell"><strong>{label}</strong><small>{hint}</small></div><div role="cell"><label className="cs-sr-only" htmlFor={`cs-model-${stage}`}>{label} model</label><select id={`cs-model-${stage}`} value={ai.models[stage]} onChange={(event) => set('models', stage, event.target.value)}>{RESEARCH_MODELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div role="cell"><label className="cs-sr-only" htmlFor={`cs-effort-${stage}`}>{label} effort</label><select id={`cs-effort-${stage}`} value={ai.effort[stage]} onChange={(event) => set('effort', stage, event.target.value)}>{EFFORTS.map((level) => <option key={level} value={level}>{level}</option>)}</select></div></div>)}</div>
    <Field id="cs-ai-concurrency" label="Batches at once" hint="How many discovery or tagging batches run in parallel (1–6)."><input id="cs-ai-concurrency" type="number" min="1" max="6" step="1" value={ai.concurrency} onChange={(event) => setDraft((current) => ({ ...current, ai: { ...ai, concurrency: Number(event.target.value) } }))} /></Field>
  </div></details>;
}

export function ProgramAutomationFields({ draft, setDraft, capabilities = {} }) {
  return <div className="cs-automation-fields">
    <label className="cs-check"><input type="checkbox" checked={Boolean(draft.autoApproveThemes)} onChange={(event) => setDraft((current) => ({ ...current, autoApproveThemes: event.target.checked }))} /><span><strong>Approve themes automatically</strong><small>Runs end to end without stopping for review, like the n8n workflow. Leave off to choose themes on the Trend board first.</small></span></label>
    <label className="cs-check"><input type="checkbox" checked={Boolean(draft.delivery?.publishToDrive)} onChange={(event) => setDraft((current) => ({ ...current, delivery: { ...(current.delivery || {}), publishToDrive: event.target.checked } }))} /><span><strong>Publish reports to Google Drive when they are ready</strong><small>{capabilities.googlePublishConfigured ? 'Creates the trends report and toolkit as Google Docs in your configured folders.' : 'Set up the Google Sheets bridge or Drive access in Settings first.'}</small></span></label>
  </div>;
}

export function ProgramEstimate({ draft, api }) {
  const [estimate, setEstimate] = useState(null); const [error, setError] = useState('');
  const timer = useRef(); const version = JSON.stringify({ sourceGroups: draft.sourceGroups, ai: draft.ai, targetPerPlatform: draft.targetPerPlatform, perAuthorCap: draft.perAuthorCap, maxThemes: draft.maxThemes, collection: draft.collection, taggingBatchSizes: draft.taggingBatchSizes, discoveryBatchSize: draft.discoveryBatchSize, budgets: draft.budgets, window: draft.window, lookbackDays: draft.lookbackDays, query: draft.query, topicFiltersTargets: draft.topicFiltersTargets });
  useEffect(() => {
    if (!api.estimateResearchProgram) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const split = (value) => (Array.isArray(value) ? value : String(value || '').split(/[,\r\n]+/).map((entry) => entry.trim()).filter(Boolean));
      const payload = { ...draft, name: draft.name || 'Draft program', sourceGroups: draft.sourceGroups.map((group) => ({ ...group, targets: split(group.targets) })) };
      Promise.resolve(api.estimateResearchProgram(payload)).then((result) => { setEstimate(result); setError(''); }).catch((failure) => { setEstimate(null); setError(String(failure?.message || failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); });
    }, 450);
    return () => clearTimeout(timer.current);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!api.estimateResearchProgram) return null;
  const ai = estimate?.ai; const collection = estimate?.collection;
  const aiShort = ai && Number(draft.budgets?.aiUsd) < ai.totalUsd; const collectionShort = collection?.worstCaseUsd && Number(draft.budgets?.collectionUsd) < collection.worstCaseUsd;
  // Mirrors the start check in content-workspace.js: a collecting run is refused below half of what it needs before review (or of the whole run when themes are auto-approved).
  const required = ai ? (draft.autoApproveThemes ? ai.totalUsd : Number(ai.stages?.discovery || 0) + Number(ai.stages?.synthesis || 0) + Number(ai.stages?.matching || 0)) : 0;
  const aiBlocked = required > 0 && Number(draft.budgets?.aiUsd) < required * 0.5;
  return <div className="cs-estimate" aria-live="polite"><div className="cs-estimate-head"><Gauge size={16} aria-hidden="true" /><strong>Estimated cost per run</strong></div>
    {error ? <p className="cs-estimate-note">{error}</p> : !estimate ? <p className="cs-estimate-note">Add sources to see an estimate.</p> : <>
      <dl className="cs-estimate-grid">
        <div><dt>Apify collection</dt><dd>up to {money(collection?.worstCaseUsd)}</dd><small>{collection?.jobCount ? `${number(collection.jobCount)} Actor jobs, all platforms at once` : collection?.error || ''}</small></div>
        <div><dt>AI (all stages)</dt><dd>about {money(ai?.totalUsd)}</dd><small>{number(ai?.posts?.total || 0)} posts · {number(ai?.batches?.discovery || 0)} discovery and {number(ai?.batches?.tagging || 0)} tagging batches</small></div>
      </dl>
      {ai && <p className="cs-estimate-stages">{Object.entries(ai.stages).map(([stage, value]) => `${stage} ${money(value)}`).join(' · ')}</p>}
      {aiBlocked && <p className="cs-estimate-warning cs-estimate-blocked"><CircleAlert size={14} aria-hidden="true" />{`A run that collects new posts will not start with this AI budget (${money(draft.budgets?.aiUsd)}). It needs at least ${money(Math.ceil(required * 50) / 100)}, half of the ${money(required)} ${draft.autoApproveThemes ? 'for a full unattended run' : 'to discover themes'}; about ${money(ai.totalUsd)} covers every stage.`}</p>}
      {((aiShort && !aiBlocked) || collectionShort) && <p className="cs-estimate-warning"><CircleAlert size={14} aria-hidden="true" />{aiShort && !aiBlocked ? `The AI budget (${money(draft.budgets.aiUsd)}) is below the estimate; a run stops when it runs out and resumes with a higher budget.` : ''}{aiShort && !aiBlocked && collectionShort ? ' ' : ''}{collectionShort ? `The collection budget (${money(draft.budgets.collectionUsd)}) is below the worst case; busy sources may stop early.` : ''}</p>}
      <p className="cs-estimate-note">Estimates use list prices; actual Apify and Claude costs are recorded on each run.</p>
    </>}
  </div>;
}

export function ProgramCollectionFields({ draft, setDraft }) {
  const values = { ...DEFAULT_COLLECTION, ...(draft.collection || {}) };
  const sizes = { x: 50, linkedin: 40, reddit: 50, ...(draft.taggingBatchSizes || {}) };
  const set = (key, value) => setDraft((current) => ({ ...current, collection: { ...values, [key]: value } }));
  const fields = [['xHandlesPerJob', 'X handles per Apify run', 1, 500, 'Fewer handles per run is cheaper per tweet.'], ['xMaxItemsPerHandle', 'X tweet ceiling per handle', 10, 1000, 'A cost ceiling; the per-author cap applies after.'], ['linkedinPostsPerProfile', 'LinkedIn posts per profile', 1, 100, 'n8n uses 15.'], ['linkedinProfilesPerJob', 'LinkedIn profiles per Apify run', 1, 1000], ['redditPostsPerSub', 'Reddit posts per subreddit', 10, 1000, 'n8n uses 300.'], ['redditScrollTimeoutSecs', 'Reddit scroll time (seconds)', 10, 600, 'n8n uses 90.'], ['laneConcurrency', 'Apify runs at once per platform', 1, 10]];
  return <>
    <div className="cs-advanced-grid">{fields.map(([key, label, min, max, hint]) => <Field key={key} id={`cs-collection-${key}`} label={label} hint={hint}><input id={`cs-collection-${key}`} type="number" min={min} max={max} step="1" value={values[key]} onChange={(event) => set(key, Number(event.target.value))} /></Field>)}</div>
    <div className="cs-thresholds"><div><h4>Tagging batch size per platform</h4><div className="cs-three-fields">{[['x', 'X'], ['linkedin', 'LinkedIn'], ['reddit', 'Reddit']].map(([platform, label]) => <Field key={platform} id={`cs-tagging-size-${platform}`} label={label}><input id={`cs-tagging-size-${platform}`} type="number" min="10" max="200" step="1" value={sizes[platform]} onChange={(event) => setDraft((current) => ({ ...current, taggingBatchSizes: { ...sizes, [platform]: Number(event.target.value) } }))} /></Field>)}</div></div></div>
  </>;
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
