import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, FlaskConical, LoaderCircle, RotateCcw } from 'lucide-react';
import TASKS from '../../shared/ai-tasks.json';
import PROVIDERS from '../../shared/ai-providers.json';
import { ModelPicker, catalogModels } from './model-picker.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { Badge, Button } from './ui.jsx';
import './ai-settings.css';

// Settings → Model routing (admins): which connection, model and effort each AI job uses. The page edits a draft of the
// studio's routing; previewAiRouting resolves every row (inheritance, readiness, typical cost and warnings) so the page
// never re-implements the rules, and saveAiRouting writes it. Runs that already started keep what they started with.
const ROUTES = { text: ['auto', 'claude', 'claude-api', 'codex', 'openai', 'openrouter'], image: ['openai', 'fal'], video: ['fal'] };
const LABEL = Object.fromEntries([...PROVIDERS.connections, ...PROVIDERS.pseudo].map((entry) => [entry.id, entry.label]));
const KEYED = { 'claude-api': 'claude-api', openai: 'openai', openrouter: 'openrouter', fal: 'fal', claude: 'claude', codex: 'codex' };
const EFFORTS = PROVIDERS.efforts;
const SHAPES = [['9:16', 'Vertical 9:16'], ['1:1', 'Square 1:1'], ['16:9', 'Wide 16:9']];
const TASK_BY_ID = Object.fromEntries(TASKS.tasks.map((task) => [task.id, task]));
const ASSET_CHANNELS = TASKS.tasks.filter((task) => task.group === 'assets' && task.id !== 'assets.default').map((task) => task.id);
const money = (value) => (!Number.isFinite(value) ? '' : value >= 1 ? `$${value.toFixed(2)}` : value >= 0.1 ? `$${value.toFixed(2)}` : `$${Number(value.toPrecision(2))}`);
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
const timeOf = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : 'earlier'; };
const requestId = () => `task-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

function costLine(row) {
  if (!row.metered && row.kind === 'text') return 'Not metered';
  if (!Number.isFinite(row.typicalUsd)) return '—';
  return `about ${money(row.typicalUsd)} a ${row.unit}`;
}
// Changes between the saved routing and the draft, in rows a person can count.
function changeCount(saved, draft) {
  if (!saved || !draft) return 0;
  const ids = new Set([...Object.keys(saved.tasks || {}), ...Object.keys(draft.tasks || {})]);
  let count = [...ids].filter((id) => !same(saved.tasks?.[id], draft.tasks?.[id])).length;
  for (const kind of ['text', 'image', 'video']) if (!same(saved.defaults?.[kind], draft.defaults?.[kind])) count++;
  if (saved.maxBudgetUsd !== draft.maxBudgetUsd) count++;
  if (!same(saved.openrouter, draft.openrouter)) count++;
  return count;
}

function RouteSelect({ id, kind, value, onChange, readiness, label = 'Connection', disabled }) {
  return <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    {ROUTES[kind].map((route) => { const state = readiness[KEYED[route] || route]; const off = route !== value && state === false; return <option key={route} value={route} disabled={off}>{LABEL[route]}{off ? ` · ${route === 'claude' || route === 'codex' ? 'sign in first' : 'add a key first'}` : ''}</option>; })}
  </select>;
}

function TaskRow({ row, draftChoice, onChoose, onReset, onTest, readiness, api, open, onOpen }) {
  const task = TASK_BY_ID[row.taskId] || {}; const kind = row.kind;
  const explicit = draftChoice && Object.keys(draftChoice).length > 0;
  const parent = task.inherit ? TASK_BY_ID[task.inherit] : null;
  const showInherited = parent && !explicit && !open;
  const set = (patch) => onChoose(row.taskId, { ...(draftChoice || {}), ...patch });
  const efforts = Array.isArray(row.efforts) ? row.efforts : row.route === 'codex' ? ['low', 'medium', 'high', 'xhigh'] : EFFORTS;
  const status = row.problem ? row.problem : row.ready ? 'Ready' : 'Not ready';
  const Cell = 'td';
  return <tr className={`ai-route-row${explicit ? ' is-explicit' : ''}${row.problem ? ' has-problem' : ''}`} data-task={row.taskId}>
    <Cell className="ai-route-job" data-label="Job"><strong>{row.label}</strong>{row.powers?.[0] && <small>{row.powers[0]}</small>}</Cell>
    {showInherited ? <Cell className="ai-route-inherited" colSpan={3} data-label="Uses"><span>Same as {parent.label}: {row.modelLabel || row.model || 'its model'}{row.effort ? ` · ${row.effort}` : ''}</span> <button type="button" className="ai-link" onClick={onOpen}>Change</button></Cell> : <>
      <Cell data-label="Connection"><RouteSelect id={`route-${row.taskId}`} kind={kind} value={row.route} readiness={readiness} label={`${row.label} connection`} onChange={(route) => set({ route, model: route === 'codex' ? '' : catalogModels(route, kind)[0]?.id ?? '' })} /></Cell>
      <Cell data-label="Model"><ModelPicker id={`model-${row.taskId}`} label={`${row.label} model`} route={row.route} kind={kind} value={row.model} api={api} needs={task.needs || {}} onChange={(model) => set({ model })} /></Cell>
      <Cell data-label={kind === 'image' ? 'Quality' : kind === 'video' ? 'Video' : 'Effort'}>
        {kind === 'text' && <select aria-label={`${row.label} effort`} value={draftChoice?.effort ?? row.effort ?? ''} onChange={(event) => set({ effort: event.target.value })}><option value="">Model default</option>{efforts.map((level) => <option key={level} value={level}>{level}</option>)}</select>}
        {kind === 'image' && row.route === 'openai' && <select aria-label={`${row.label} picture quality`} value={draftChoice?.quality ?? row.quality ?? 'medium'} onChange={(event) => set({ quality: event.target.value })}>{['low', 'medium', 'high'].map((level) => <option key={level} value={level}>{level}</option>)}</select>}
        {kind === 'image' && row.route !== 'openai' && <small>{row.referenceImages ? 'Takes brand reference images' : 'No reference images'}</small>}
        {kind === 'video' && <span className="ai-video-options">
          <select aria-label="Video length" value={row.video?.durationSeconds ?? 8} onChange={(event) => set({ durationSeconds: Number(event.target.value) })}>{[4, 5, 6, 8, 10, 12, 15].map((seconds) => <option key={seconds} value={seconds}>{seconds} s</option>)}</select>
          <select aria-label="Video shape" value={row.video?.aspectRatio || '9:16'} onChange={(event) => set({ aspectRatio: event.target.value })}>{SHAPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
          <label className="ai-check"><input type="checkbox" checked={Boolean(row.video?.sound)} onChange={(event) => set({ sound: event.target.checked })} />Sound</label>
        </span>}
      </Cell>
    </>}
    <Cell data-label="Typical cost" className="ai-route-cost">{costLine(row)}</Cell>
    <Cell data-label="Status" className="ai-route-status">{row.problem ? <span className="ai-problem"><CircleAlert size={13} aria-hidden="true" />{status}</span> : <Badge tone={row.ready ? 'ready' : 'warning'}>{status}</Badge>}{row.note && <small>{row.note}</small>}</Cell>
    <Cell data-label="" className="ai-route-menu">
      {kind === 'video' ? <small>Try video models by making a video from a report; the estimate shows before anything is paid.</small> : <Button type="button" className="ghost" onClick={() => onTest(row)} disabled={Boolean(row.problem)}><FlaskConical size={13} aria-hidden="true" />Test…</Button>}
      {explicit && <Button type="button" className="ghost" onClick={() => onReset(row.taskId)}><RotateCcw size={13} aria-hidden="true" />Reset to default</Button>}
    </Cell>
  </tr>;
}

export function ModelRouting({ state = {}, api, busy, role = 'admin', layout }) {
  const confirm = useConfirm();
  const simple = (layout || state.settings?.uiMode || 'simple') === 'simple';
  const [saved, setSaved] = useState(null); const [draft, setDraft] = useState(null); const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState(''); const [conflict, setConflict] = useState(null); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState('');
  const [presetInfo, setPresetInfo] = useState(null); const [readiness, setReadiness] = useState({}); const [opened, setOpened] = useState({}); const [perChannel, setPerChannel] = useState(false);
  const [testResults, setTestResults] = useState({}); const [testing, setTesting] = useState('');
  const timer = useRef(null); const asked = useRef(0); const previewed = useRef('');
  const load = useCallback(async () => {
    if (typeof api?.previewAiRouting !== 'function') return;
    setProblem('');
    try { const result = await api.previewAiRouting({}); previewed.current = JSON.stringify(result.routing); setSaved(result.routing); setDraft(copy(result.routing)); setPreview(result); setConflict(null); }
    catch (error) { setProblem(error?.message || 'Model routing couldn’t be read.'); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (typeof api?.getAiConnections !== 'function') return;
    api.getAiConnections({}).then((status) => setReadiness(Object.fromEntries((status?.connections || []).map((row) => [row.id, row.status === 'ready'])))).catch(() => {});
  }, [api, state.keys]);
  // Every edit re-resolves the draft on the server (400 ms after the last change).
  useEffect(() => {
    const wanted = JSON.stringify(draft || null);
    if (!draft || !saved || wanted === previewed.current) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ask = ++asked.current; previewed.current = wanted;
      try { const result = await api.previewAiRouting({ routing: draft }); if (ask === asked.current) setPreview(result); }
      catch (error) { if (ask === asked.current) setProblem(error?.message || 'The change couldn’t be checked.'); }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [draft, saved, api]);
  const changes = changeCount(saved, draft);
  const rows = useMemo(() => preview?.tasks || [], [preview]);
  const blocking = rows.filter((row) => row.problem && draft?.tasks?.[row.taskId]);
  function choose(taskId, choice) { setNotice(''); setPresetInfo(null); setDraft((current) => ({ ...current, preset: 'custom', tasks: { ...current.tasks, [taskId]: choice } })); }
  function reset(taskId) { setDraft((current) => { const tasks = { ...current.tasks }; delete tasks[taskId]; return { ...current, preset: 'custom', tasks }; }); }
  function setDefault(kind, patch) { setPresetInfo(null); setDraft((current) => ({ ...current, preset: 'custom', defaults: { ...current.defaults, [kind]: { ...current.defaults[kind], ...patch } } })); }
  async function choosePreset(presetId) {
    setProblem('');
    try {
      const result = await api.previewAiRouting({ preset: presetId, routing: draft });
      const before = preview?.examples?.researchRunUsd; const after = result.examples?.researchRunUsd;
      setPresetInfo({ presetId, changed: changeCount(saved, result.routing), before, after });
      previewed.current = JSON.stringify(result.routing); setDraft(result.routing); setPreview(result);
    } catch (error) { setProblem(error?.message || 'That preset couldn’t be applied.'); }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setProblem(''); setNotice('');
    try {
      const result = await api.saveAiRouting({ routing: draft, baseUpdatedAt: saved?.updatedAt || '' });
      previewed.current = JSON.stringify(result.routing); setSaved(result.routing); setDraft(copy(result.routing)); setPresetInfo(null); setNotice('Routing saved. New runs use it; runs that already started keep what they started with.');
    } catch (error) {
      if (error?.code === 'routingConflict' || /saved routing after you opened it/.test(error?.message || '')) setConflict(error.message);
      else setProblem(error?.message || 'Routing couldn’t be saved.');
    } finally { setSaving(false); }
  }
  async function runTest(row) {
    if (testing) return;
    const choice = draft?.tasks?.[row.taskId] || {};
    const request = { taskId: row.taskId, route: choice.route || row.route, model: choice.model ?? row.model, ...(row.kind === 'text' ? { effort: choice.effort ?? row.effort ?? '' } : {}), ...(row.kind === 'image' ? { quality: choice.quality ?? row.quality ?? '' } : {}) };
    let estimate;
    try { estimate = await api.estimateAiTaskTest(request); }
    catch (error) { setTestResults((current) => ({ ...current, [row.taskId]: { ok: false, problems: [error?.message || 'This job can’t be tested now.'] } })); return; }
    const yes = await confirm({ title: `Test ${row.label}?`, lines: estimate.lines, confirmLabel: estimate.metered ? `Test · about ${money(estimate.estimateUsd)}` : 'Test', cancelLabel: 'Not now' });
    if (!yes) return;
    setTesting(row.taskId);
    try { const result = await api.testAiTask({ ...request, requestId: requestId(), fingerprint: estimate.fingerprint }); setTestResults((current) => ({ ...current, [row.taskId]: result })); }
    catch (error) { setTestResults((current) => ({ ...current, [row.taskId]: { ok: false, problems: [error?.message || 'The test didn’t finish.'] } })); }
    finally { setTesting(''); }
  }
  const groups = useMemo(() => TASKS.groups.map((group) => ({ ...group, rows: rows.filter((row) => row.group === group.id && (perChannel || !ASSET_CHANNELS.includes(row.taskId))) })).filter((group) => group.rows.length), [rows, perChannel]);
  if (role !== 'admin') return <section className="settings-block" id="model-routing" data-spot="settings.model-routing"><div className="panel-head"><div><h3>Model routing</h3><p>An admin chooses which connection and model does each AI job.</p></div></div></section>;
  if (!draft || !preview) return <section className="settings-block ai-routing" id="model-routing" aria-labelledby="model-routing-title" data-spot="settings.model-routing"><div className="panel-head"><div><h3 id="model-routing-title">Model routing</h3><p>{problem || <><LoaderCircle className="spin" size={14} aria-hidden="true" /> Reading the routing…</>}</p></div></div></section>;
  const preset = draft.preset || 'custom';
  const table = (group) => <table className="ai-route-table" aria-label={`${group.label} jobs`}>
    <thead><tr><th scope="col">Job</th><th scope="col">Connection</th><th scope="col">Model</th><th scope="col">Effort or options</th><th scope="col">Typical cost</th><th scope="col">Status</th><th scope="col"><span className="ai-sr-only">Actions</span></th></tr></thead>
    <tbody>{group.rows.map((row) => <React.Fragment key={row.taskId}>
      <TaskRow row={row} draftChoice={draft.tasks[row.taskId]} onChoose={choose} onReset={reset} onTest={runTest} readiness={readiness} api={api} open={Boolean(opened[row.taskId])} onOpen={() => setOpened((current) => ({ ...current, [row.taskId]: true }))} />
      {(testResults[row.taskId] || testing === row.taskId) && <tr className="ai-route-test"><td colSpan={7}>{testing === row.taskId ? <span><LoaderCircle className="spin" size={13} aria-hidden="true" /> Testing…</span> : <TaskTestResult result={testResults[row.taskId]} />}</td></tr>}
    </React.Fragment>)}</tbody>
  </table>;
  return <section className="settings-block ai-routing" id="model-routing" aria-labelledby="model-routing-title" data-spot="settings.model-routing">
    <div className="panel-head"><div><h3 id="model-routing-title">Model routing</h3><p>Choose which connection and model does each AI job. Runs that already started keep what they started with.</p></div>{saved?.updatedAt && <small className="ai-muted">Saved {timeOf(saved.updatedAt)}{saved.updatedBy?.name ? ` by ${saved.updatedBy.name}` : ''}</small>}</div>
    <fieldset className="ai-presets" data-spot="settings.model-routing.presets"><legend>Start from</legend>
      {preview.presets.map((entry) => <label key={entry.id} className={`ai-preset${preset === entry.id ? ' is-on' : ''}`}><input type="radio" name="ai-preset" value={entry.id} checked={preset === entry.id} onChange={() => choosePreset(entry.id)} /><span><strong>{entry.label}{entry.recommended ? ' (recommended)' : ''}</strong><small>{entry.description}</small></span></label>)}
      <label className={`ai-preset${preset === 'custom' ? ' is-on' : ''}`}><input type="radio" name="ai-preset" value="custom" checked={preset === 'custom'} readOnly onChange={() => {}} /><span><strong>Custom</strong><small>Your own choices, kept when you change a job.</small></span></label>
    </fieldset>
    {presetInfo && <p className="ai-callout" role="status">Changes {presetInfo.changed} {presetInfo.changed === 1 ? 'job' : 'jobs'}.{Number.isFinite(presetInfo.before) && Number.isFinite(presetInfo.after) ? ` A typical research run goes from about ${money(presetInfo.before)} to about ${money(presetInfo.after)}.` : ''} Nothing is saved until you choose Save routing.</p>}
    <div className="ai-defaults">
      <div className="ai-default-row"><span><strong>Text connection</strong><small>Ask AI, data tools and Create content, unless a job chooses its own.</small></span>
        <RouteSelect id="ai-default-text-route" kind="text" value={draft.defaults.text.route} readiness={readiness} label="Text connection" onChange={(route) => setDefault('text', { route, model: route === 'codex' ? '' : catalogModels(route, 'text')[0]?.id ?? '' })} />
        <ModelPicker id="ai-default-text-model" label="Model for chat and data tools" route={draft.defaults.text.route} kind="text" value={draft.defaults.text.model} api={api} onChange={(model) => setDefault('text', { model })} /></div>
      <div className="ai-default-row"><span><strong>Pictures</strong><small>Every picture the studio draws, with its brand reference images where the model takes them.</small></span>
        <RouteSelect id="ai-default-image-route" kind="image" value={draft.defaults.image.route} readiness={readiness} label="Picture connection" onChange={(route) => setDefault('image', { route, model: catalogModels(route, 'image')[0]?.id ?? '' })} />
        <ModelPicker id="ai-default-image-model" label="Picture model" route={draft.defaults.image.route} kind="image" value={draft.defaults.image.model} api={api} onChange={(model) => setDefault('image', { model })} /></div>
      <div className="ai-default-row"><span><strong>Video</strong><small>Short social videos (made only when someone ticks one, after an estimate).</small></span>
        <RouteSelect id="ai-default-video-route" kind="video" value={draft.defaults.video.route} readiness={readiness} label="Video connection" onChange={(route) => setDefault('video', { route })} />
        <ModelPicker id="ai-default-video-model" label="Video model" route="fal" kind="video" value={draft.defaults.video.model} api={api} onChange={(model) => setDefault('video', { model })} /></div>
    </div>
    {preview.overriddenBy?.length > 0 && <p className="ai-callout">{preview.overriddenBy.length} research {preview.overriddenBy.length === 1 ? 'program chooses its' : 'programs choose their'} own models for some stages ({preview.overriddenBy.map((entry) => entry.name).join(', ')}). Those win for their runs.</p>}
    {preview.warnings?.length > 0 && <ul className="ai-warnings">{preview.warnings.map((line) => <li key={line}><CircleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
    <div className="ai-route-groups">
      {groups.map((group) => simple
        ? <details key={group.id} className="ai-route-group" open={group.id === 'research' || undefined}><summary>{group.label} <span>{group.rows.length} {group.rows.length === 1 ? 'job' : 'jobs'}</span></summary>{table(group)}</details>
        : <div key={group.id} className="ai-route-group"><h4>{group.label}</h4>{table(group)}</div>)}
    </div>
    <button type="button" className="ai-link" aria-expanded={perChannel} onClick={() => setPerChannel((on) => !on)}>{perChannel ? 'Hide per-channel choices' : `Set per channel (${ASSET_CHANNELS.length})`}</button>
    <div className="ai-spending"><label htmlFor="ai-max-budget">Cap for single requests (Ask AI pictures, data tools), USD</label><input id="ai-max-budget" type="number" min="0.01" max="100" step="0.01" value={draft.maxBudgetUsd} onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, maxBudgetUsd: Number.isFinite(value) ? value : current.maxBudgetUsd })); }} /></div>
    {problem && <p className="error-line" role="alert">{problem}</p>}
    {notice && <p className="ai-notice" role="status">{notice}</p>}
    {(changes > 0 || conflict) && <div className="ai-save-bar" role="region" aria-label="Unsaved routing">
      {conflict ? <><span className="ai-problem"><CircleAlert size={14} aria-hidden="true" />{conflict}</span><Button type="button" onClick={load}>Reload</Button></>
        : <><span>{changes} unsaved {changes === 1 ? 'change' : 'changes'}{blocking.length ? ` · ${blocking[0].problem}` : ''}</span><Button type="button" className="ghost" disabled={saving} onClick={() => { setDraft(copy(saved)); setPresetInfo(null); setProblem(''); }}>Discard</Button><Button type="button" disabled={busy || saving || blocking.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save routing'}</Button></>}
    </div>}
  </section>;
}

function TaskTestResult({ result }) {
  if (!result) return null;
  const cost = Number.isFinite(result.receipt?.costUsd) ? ` · ${money(result.receipt.costUsd)}` : '';
  return <div className={`ai-test-result ${result.ok ? 'is-ok' : 'is-problem'}`} role="status">
    <strong>{result.ok ? `Passed the checks in ${Math.max(1, Math.round((result.durationMs || 0) / 1000))} s${cost}` : `The answer didn’t pass the checks: ${(result.problems || []).slice(0, 2).join(' ')}`}</strong>
    {result.imageDataUrl && <img className="ai-test-picture" src={result.imageDataUrl} alt="Test picture" />}
    {result.preview && <details><summary>See the answer</summary><pre>{result.preview}</pre></details>}
  </div>;
}
