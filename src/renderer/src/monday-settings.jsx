import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert, ExternalLink, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Badge, Button } from './ui.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { buildTrendBoard } from '../../shared/trend-board.js';
import catalog from '../../shared/monday.json';
import { MondaySyncLog, timeAgo } from './monday-ui.jsx';
import './monday.css';

// Settings → Monday.com (wave 3B; HANDOFF.md → Monday.com). Rendered by settings-view.jsx in the section the left nav
// lists as `monday` (settings-sections.js), with the common section props: { state, api, busy, web, role }. Four steps
// (connect, board, match columns, sync rules) collapse into a summary once syncing. The studio acts on Monday as the
// token's owner; nothing here costs money, and Monday's own API call allowance is shown as an estimate.
const FIELDS = catalog.fields.filter((field) => !field.fixed);
const STAGES = Object.keys(catalog.stageLabels);
const STAGE_WORDS = { potential: 'Needs your OK', approved: 'Approved', production: 'Being written', ready: 'Ready', passed: 'Skipped' };
const TYPE_WORDS = { status: 'Status', dropdown: 'Dropdown', text: 'Text', long_text: 'Long text', numbers: 'Numbers', date: 'Date', link: 'Link', people: 'People' };
const fmt = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const list = (value) => (Array.isArray(value) ? value : []);
const clockAt = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''; };

// About how many Monday API calls a day these settings use: polling (a check, sometimes a read), the 6-hourly full check
// (a read per 100 items), pushes (an aliased call per 10 changes) and the daily webhook check. Rate-limited calls count too.
export function estimateMondayCalls({ push = {}, pull = {}, trends = 0, instant = false } = {}) {
  const polling = pull.mode === 'poll' || (pull.mode === 'instant' && !instant) ? Math.ceil(1440 / (Number(pull.pollMinutes) || 5)) * 1.2 : pull.mode === 'instant' ? 24 + 40 : 0;
  const reconcile = push.mode !== 'manual' || pull.mode !== 'manual' ? 4 * (2 * Math.ceil((Number(trends) || 0) / 100) + 1) : 0;
  const changes = Math.max(10, Math.round((Number(trends) || 0) * 0.1));
  const pushes = push.mode === 'manual' ? 0 : Math.ceil(changes / 10) * 2 + ({ live: 12, hourly: 6, daily: 1 }[push.mode] || 0);
  return Math.round(polling + reconcile + pushes + 2);
}

function statusOf(monday) {
  const link = monday?.link;
  if (!monday?.connected) return ['neutral', 'Not connected'];
  if (link?.paused?.reason === 'user') return ['warning', 'Paused'];
  if (link?.paused || list(link?.problems).length || link?.counts?.failed) return ['danger', 'Needs attention'];
  if (link?.active) return ['ready', 'Syncing'];
  return ['neutral', link?.boardId ? 'Not syncing' : 'Choose a board'];
}

// A fresh draft: the saved setup for the linked board, else the board's suggested mapping and the defaults.
function draftFor(board, link, web) {
  const same = link?.boardId && link.boardId === board?.board?.id;
  const saved = same ? Object.fromEntries(Object.entries(link.columns || {}).map(([field, column]) => [field, column.id])) : null;
  return {
    columns: saved || { ...(board?.suggested?.columns || {}) },
    statusLabels: { ...catalog.stageLabels, ...(board?.suggested?.statusLabels || {}), ...(same ? link.statusLabels : {}) },
    fieldOptions: { plannedDate: { direction: 'toMonday' }, owner: { direction: 'fromMonday' }, ...(same ? link.fieldOptions : {}) },
    groups: { by: same ? link.groups?.by || 'stage' : 'stage', defaultGroupId: same ? link.groups?.defaultGroupId || '' : board?.groups?.[0]?.id || '' },
    push: { mode: 'live', dailyAt: '09:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', from: board?.board && !same && board.board.itemsCount ? 'now' : 'all', includeSkipped: true, postUpdates: true, ...(same ? link.push : {}) },
    pull: { mode: web ? 'instant' : 'poll', pollMinutes: 5, decisions: web ? 'members' : 'anyone', comments: true, owner: true, dates: true, ...(same ? link.pull : {}) },
    onDeleted: same ? link.onDeleted || 'leave' : 'leave',
  };
}

export function MondaySettings({ state, api, busy = false, web = false }) {
  const monday = state?.monday || {};
  const link = monday.link;
  const confirm = useConfirm();
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'problem', text, url? }
  const [editing, setEditing] = useState(!link?.active);
  const [board, setBoard] = useState(null);
  const [draft, setDraft] = useState(null);
  const [rev, setRev] = useState(link?.rev);
  const [disconnecting, setDisconnecting] = useState(false);
  const [tone, badge] = statusOf(monday);
  const disabled = busy || Boolean(working);
  const run = async (label, work, after) => {
    setWorking(label); setMessage(null);
    try { const result = await work(); after?.(result); return result; }
    catch (error) { setMessage({ tone: 'problem', text: error?.message || 'Monday.com didn’t answer. Try again.' }); return null; }
    finally { setWorking(''); }
  };
  // Editing an existing setup reads its board again, so the mapping shows what is on Monday now.
  useEffect(() => {
    if (!editing || !link?.boardId || board || !monday.connected || typeof api?.readMondayBoard !== 'function') return;
    run('board', () => api.readMondayBoard({ boardId: link.boardId }), (result) => { setBoard(result); setDraft(draftFor(result, link, web)); setRev(link.rev); });
  }, [editing, link?.boardId, monday.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseBoard = (result) => { setBoard(result); setDraft(draftFor(result, link, web)); if (result?.link) setRev(result.link.rev); else if (result?.rev !== undefined) setRev(result.rev); };
  const trends = useMemo(() => buildTrendBoard(state?.contentStudio || {}).cards, [state?.contentStudio]);
  const save = () => run('save', () => api.saveMondayLink({ rev: rev ?? link?.rev, boardId: board.board.id, columns: draft.columns, fieldOptions: draft.fieldOptions, statusLabels: draft.statusLabels, groups: draft.groups, push: draft.push, pull: draft.pull, onDeleted: draft.onDeleted, active: true }), (result) => {
    const saved = result?.monday?.link; setRev(saved?.rev); setEditing(false); setBoard(null);
    setMessage({ tone: 'ok', text: link?.active ? 'Saved. Syncing with the new setup.' : `Syncing with “${saved?.boardName || board.board.name}”. The first trends are on their way.` });
  });
  const togglePause = () => run('pause', () => api.saveMondayLink({ rev: link.rev, paused: !link.paused }), (result) => setRev(result?.monday?.link?.rev));

  return <section className="settings-block md-settings" aria-labelledby="md-settings-title" data-spot="settings.monday">
    <div className="panel-head"><div><h3 id="md-settings-title">Monday.com</h3><p>Keep a Monday.com board in step with your trends. New trends, decisions, reports and channel plans go to Monday, and Yes or Skip on Monday comes back here.</p></div><Badge tone={tone}>{badge}</Badge></div>
    {message && <p className={`md-message ${message.tone === 'ok' ? 'is-ok' : 'is-problem'}`} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}{message.url && <> <a href={message.url} target="_blank" rel="noreferrer noopener">Open in Monday<ExternalLink size={11} aria-hidden="true" /></a></>}</p>}
    {link?.active && !editing
      ? <MondaySummary monday={monday} api={api} disabled={disabled} working={working} onEdit={() => { setEditing(true); setBoard(null); }} onPause={togglePause} onMessage={setMessage} />
      : <>
        <ConnectStep monday={monday} api={api} disabled={disabled} working={working} run={run} onMessage={setMessage} onDisconnect={() => setDisconnecting(true)} />
        {monday.connected && <BoardStep monday={monday} api={api} web={web} disabled={disabled} working={working} run={run} board={board} onBoard={chooseBoard} onMessage={setMessage} state={state} />}
        {monday.connected && board && draft && <MatchStep board={board} draft={draft} setDraft={setDraft} api={api} web={web} webAddress={Boolean(monday.webAddress)} disabled={disabled} working={working} run={run} onBoard={chooseBoard} example={trends[0] || null} />}
        {monday.connected && board && draft && <RulesStep draft={draft} setDraft={setDraft} web={web} monday={monday} trends={trends.length} existing={Boolean(board.board?.itemsCount)} />}
        {monday.connected && board && draft && <div className="md-actions">
          <Button disabled={disabled || !draft.columns.stage || !draft.columns.studioKey} onClick={save}>{working === 'save' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{link?.active ? 'Save changes' : 'Start syncing'}</Button>
          {link?.active && <Button className="ghost" disabled={disabled} onClick={() => { setEditing(false); setBoard(null); }}>Cancel</Button>}
          {(!draft.columns.stage || !draft.columns.studioKey) && <small className="md-muted">Choose columns for Stage and Studio key first.</small>}
        </div>}
      </>}
    {link?.active && !editing && <details className="md-details"><summary>Connection</summary><ConnectStep monday={monday} api={api} disabled={disabled} working={working} run={run} onMessage={setMessage} onDisconnect={() => setDisconnecting(true)} /></details>}
    {disconnecting && <DisconnectPanel api={api} confirm={confirm} disabled={disabled} run={run} hasLink={Boolean(link)} onDone={(text) => { setDisconnecting(false); setEditing(true); setBoard(null); if (text) setMessage({ tone: 'ok', text }); }} onCancel={() => setDisconnecting(false)} />}
    {link && <details className="md-details"><summary>Sync log</summary><MondaySyncLog api={api} /></details>}
    <details className="md-details"><summary>How sync decides</summary><ul className="md-rules">
      <li><strong>Stage, while a trend waits for an OK:</strong> shared. The newest change wins, and a change on Monday counts only from someone allowed (see Yes and Skip on Monday).</li>
      <li><strong>Stage after review:</strong> the studio’s. Changes on Monday are changed back, with the reason in the log.</li>
      <li><strong>Name:</strong> written when the item is made and when the studio’s name changes; a rename on Monday stays otherwise.</li>
      <li><strong>Priority, category, momentum, sources, program, dates found, who decided, links, channels and notes:</strong> the studio’s, overwritten only when the studio’s value changes.</li>
      <li><strong>Owner and planned date:</strong> whichever side you chose. The other side only shows the value.</li>
      <li><strong>Comments:</strong> Monday’s. The studio adds updates, and never edits anyone’s.</li>
      <li>Group moves made on Monday aren’t read, and items added by hand on Monday are never brought in. Connect one studio per board.</li>
    </ul></details>
  </section>;
}

function ConnectStep({ monday, api, disabled, working, run, onMessage, onDisconnect }) {
  const [token, setToken] = useState('');
  const account = monday.account;
  const connect = () => run('connect', () => api.connectMonday({ token: token.trim() }), (result) => {
    if (result?.ok) { setToken(''); onMessage({ tone: 'ok', text: `Connected as ${[result.account?.name, result.account?.accountName, result.account?.plan && `${result.account.plan} plan`].filter(Boolean).join(' · ')}${result.dailyLimit ? ` · up to ${fmt(result.dailyLimit)} API calls a day` : ''}.` }); }
    else onMessage({ tone: 'problem', text: result?.error || 'Monday.com didn’t accept this token. Copy it again from Developers → My access tokens.' });
  });
  const check = () => run('test', () => api.testMondayConnection({}), (result) => {
    const problems = [...list(result?.board?.problems), ...(result?.hooks?.note ? [result.hooks.note] : [])];
    onMessage(result?.ok ? { tone: 'ok', text: `Monday.com is working${result.board?.name ? ` and “${result.board.name}” looks right` : ''}. ${fmt(result.callsToday)} API calls used today.` } : { tone: 'problem', text: result?.error || problems.join(' ') || 'Monday.com didn’t answer. Try again.' });
  });
  return <div className="md-step" aria-labelledby="md-step-connect">
    <h4 id="md-step-connect"><span className="md-step-number">1</span>Connect</h4>
    {monday.connected ? <>
      <p className="md-connected">{account ? `Connected as ${[account.name, account.accountName, account.plan && `${account.plan} plan`].filter(Boolean).join(' · ')}${monday.dailyLimit ? ` · up to ${fmt(monday.dailyLimit)} API calls a day` : ''}` : 'A Monday.com token is saved.'}</p>
      <div className="md-row"><Button className="ghost" disabled={disabled} onClick={check}>{working === 'test' ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Check again</Button><Button className="ghost" disabled={disabled} onClick={onDisconnect}>Disconnect…</Button></div>
    </> : <>
      <p className="md-help">Get a token: in Monday.com, click your profile picture → Developers → My access tokens → Show → Copy. Account admins can also use Administration → Connections → API. The studio acts as that person on Monday, so use an account that can edit the board. A shared “Studio” account keeps working when people leave.</p>
      <label className="md-field">Monday.com API token<span className="md-row"><input type="password" autoComplete="off" value={token} placeholder="Paste the token" onChange={(event) => setToken(event.target.value)} /><Button disabled={disabled || token.trim().length < 20} onClick={connect}>{working === 'connect' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Connect</Button></span></label>
      <small className="md-muted">The studio checks the token with Monday before saving it{monday.web ? ' on the studio server' : ' on this computer'}.</small>
    </>}
  </div>;
}

function BoardStep({ monday, api, web, disabled, working, run, board, onBoard, onMessage, state }) {
  const link = monday.link;
  const [mode, setMode] = useState('have');
  const [listing, setListing] = useState(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const activeName = list(state?.contentStudio?.workspaces).find((row) => row.id === state?.contentStudio?.activeWorkspaceId)?.name || 'Main';
  const [create, setCreate] = useState({ name: `Trends · ${activeName}`, workspaceId: '', kind: 'public', groupBy: 'stage', fields: FIELDS.filter((field) => field.required || field.default).map((field) => field.id) });
  const load = (options = {}) => run('boards', () => api.listMondayBoards({ workspaceId: options.workspaceId ?? workspaceId, search: options.search ?? search }), setListing);
  useEffect(() => { if (typeof api?.listMondayBoards === 'function' && !listing) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (payload) => run('board', () => api.readMondayBoard(payload), onBoard);
  const make = () => run('create', () => api.createMondayBoard(create), (result) => { onBoard(result); onMessage({ tone: 'ok', text: `Made “${result.board.name}” with ${result.columns.filter((column) => column.type !== 'name').length} columns.`, url: result.board.url }); });
  const toggleField = (id) => setCreate((current) => ({ ...current, fields: current.fields.includes(id) ? current.fields.filter((value) => value !== id) : [...current.fields, id] }));
  return <div className="md-step" aria-labelledby="md-step-board">
    <h4 id="md-step-board"><span className="md-step-number">2</span>Board{board?.board && <small className="md-muted"> · {board.board.name} · {board.board.workspaceName}</small>}</h4>
    <div className="md-segment" role="tablist" aria-label="Which board">{[['have', 'Use a board I have'], ['new', 'Make a new board for me']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
    {mode === 'have' ? <>
      <div className="md-row md-wrap">
        <select aria-label="Monday workspace" value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); load({ workspaceId: event.target.value }); }}><option value="">All workspaces</option>{list(listing?.workspaces).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <input type="search" aria-label="Search boards" placeholder="Search boards" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load(); }} />
        <Button className="ghost" disabled={disabled} onClick={() => load()}>{working === 'boards' ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}Search</Button>
      </div>
      {listing && <div className="md-board-list" role="radiogroup" aria-label="Monday boards">
        {!listing.boards.length && <p className="md-muted">No boards found. Try another workspace, or make a new board.</p>}
        {listing.boards.map((row) => <label key={row.id} className={`md-board-row${board?.board?.id === row.id ? ' is-chosen' : ''}`}><input type="radio" name="md-board" checked={board?.board?.id === row.id} disabled={disabled} onChange={() => pick({ boardId: row.id })} /><span><strong>{row.name}</strong><small className="md-muted">{row.workspaceName} · {fmt(row.itemsCount)} items{link?.boardId === row.id ? ' · linked now' : ''}</small></span></label>)}
      </div>}
      <label className="md-field">Paste a board link<span className="md-row"><input type="url" placeholder="https://yourteam.monday.com/boards/1234567890" value={url} onChange={(event) => setUrl(event.target.value)} /><Button className="ghost" disabled={disabled || !url.trim()} onClick={() => pick({ url: url.trim() })}>Use this board</Button></span></label>
    </> : <div className="md-create">
      <label className="md-field">Board name<input value={create.name} maxLength={160} onChange={(event) => setCreate({ ...create, name: event.target.value })} /></label>
      <label className="md-field">Monday workspace<select value={create.workspaceId} onChange={(event) => setCreate({ ...create, workspaceId: event.target.value })}><option value="">Main workspace</option>{list(listing?.workspaces).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="md-field">Who can see it<select value={create.kind} onChange={(event) => setCreate({ ...create, kind: event.target.value })}><option value="public">Everyone in your account</option><option value="private">Only people you invite</option></select></label>
      <fieldset className="md-fieldset"><legend>Groups</legend>{[['stage', 'One group per stage'], ['run', 'One group per research run'], ['none', 'One group']].map(([id, label]) => <label key={id} className="md-check"><input type="radio" name="md-create-groups" checked={create.groupBy === id} onChange={() => setCreate({ ...create, groupBy: id })} />{label}</label>)}</fieldset>
      <fieldset className="md-fieldset"><legend>Columns</legend><div className="md-columns-pick">{FIELDS.map((field) => { const off = field.needsWebAddress && !monday.webAddress; return <label key={field.id} className="md-check"><input type="checkbox" checked={field.required || (!off && create.fields.includes(field.id))} disabled={field.required || off} onChange={() => toggleField(field.id)} />{field.label}{field.required && <small className="md-muted"> (needed)</small>}{off && <small className="md-muted"> ({web ? 'needs the studio’s web address' : 'add a Studio web address in Settings first'})</small>}</label>; })}</div></fieldset>
      <Button disabled={disabled || !create.name.trim()} onClick={make}>{working === 'create' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Make board</Button>
    </div>}
  </div>;
}

// What the newest trend would put in each column.
function exampleOf(field, card, draft) {
  if (!card) return '';
  switch (field.id) {
    case 'stage': return draft.statusLabels[card.stage] || '';
    case 'studioKey': return card.key;
    case 'priority': return catalog.priorityLabels[card.priorityTier] || '';
    case 'category': return card.category || '';
    case 'momentum': return 'From the trend tracker';
    case 'sources': return fmt(card.evidenceCount);
    case 'program': return card.programName || '';
    case 'foundOn': return card.discoveredAt ? new Date(card.discoveredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    case 'decidedBy': return 'Who said Yes or Skip, and when';
    case 'reportLink': case 'toolkitLink': return 'A link, once written';
    case 'studioLink': return 'A link to this trend';
    case 'channels': return 'Each channel’s answer';
    case 'plannedDate': return draft.fieldOptions.plannedDate?.direction === 'fromMonday' ? 'Set on Monday' : 'From channel answers';
    case 'owner': return draft.fieldOptions.owner?.direction === 'toMonday' ? 'The person who said Yes' : 'Set on Monday';
    case 'notes': return (card.description || '').slice(0, 60);
    default: return '';
  }
}

function MatchStep({ board, draft, setDraft, api, web, webAddress, disabled, working, run, onBoard, example }) {
  const columns = list(board.columns).filter((column) => column.type !== 'name');
  const used = new Map(Object.entries(draft.columns).filter(([, id]) => id).map(([field, id]) => [id, field]));
  const missing = FIELDS.filter((field) => field.required && !draft.columns[field.id]).map((field) => field.id);
  const setColumn = (fieldId, value) => {
    if (value === '__add') { run('fix', () => api.fixMondayBoard({ boardId: board.board.id, add: [fieldId] }), (result) => { onBoard(result); setDraft((current) => ({ ...current, columns: { ...current.columns, [fieldId]: result?.suggested?.columns?.[fieldId] || current.columns[fieldId] || '' } })); }); return; }
    setDraft((current) => ({ ...current, columns: { ...current.columns, [fieldId]: value } }));
  };
  const addMissing = () => run('fix', () => api.fixMondayBoard({ boardId: board.board.id, add: missing }), (result) => { onBoard(result); setDraft((current) => ({ ...current, columns: { ...current.columns, ...Object.fromEntries(missing.map((id) => [id, result?.suggested?.columns?.[id] || ''])) } })); });
  const stageColumn = columns.find((column) => column.id === draft.columns.stage);
  const labels = list(stageColumn?.labels);
  return <div className="md-step" aria-labelledby="md-step-match">
    <h4 id="md-step-match"><span className="md-step-number">3</span>Match columns</h4>
    {missing.length > 0 && <p className="md-problem"><CircleAlert size={14} aria-hidden="true" />{missing.includes('studioKey') ? 'This board has no Studio key column yet.' : 'This board has no Stage column yet.'}<Button className="ghost" disabled={disabled} onClick={addMissing}>{working === 'fix' ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}Add the missing columns</Button></p>}
    <div className="md-table-wrap"><table className="md-table">
      <thead><tr><th scope="col">Studio field</th><th scope="col">Monday column</th><th scope="col">Direction</th><th scope="col">Example</th></tr></thead>
      <tbody>{FIELDS.map((field) => {
        const off = field.needsWebAddress && !webAddress;
        const options = columns.filter((column) => field.types.includes(column.type) && (!used.has(column.id) || used.get(column.id) === field.id));
        const directionChoice = field.directions;
        return <tr key={field.id}>
          <th scope="row">{field.label}{field.required && <small className="md-required"> Required</small>}{field.id === 'studioKey' && <small className="md-muted md-block">Lets the studio recognise its own items, so nothing is ever added twice. You can hide it in the board’s view.</small>}{off && <small className="md-muted md-block">{web ? 'Needs the studio’s public web address.' : 'Add a Studio web address in Settings first.'}</small>}</th>
          <td><select aria-label={`Monday column for ${field.label}`} value={draft.columns[field.id] || ''} disabled={disabled || off} onChange={(event) => setColumn(field.id, event.target.value)}>
            <option value="">{field.required ? 'Choose a column' : 'Don’t sync'}</option>
            {options.map((column) => <option key={column.id} value={column.id}>{column.title} ({TYPE_WORDS[column.type] || column.type})</option>)}
            <option value="__add">Add a new column</option>
          </select></td>
          <td>{directionChoice ? <select aria-label={`Who sets ${field.label}`} value={draft.fieldOptions[field.id]?.direction || field.direction} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, fieldOptions: { ...current.fieldOptions, [field.id]: { direction: event.target.value } } }))}>
            {field.id === 'plannedDate' ? <><option value="toMonday">From channel answers</option><option value="fromMonday">Set on Monday</option></> : <><option value="fromMonday">Set on Monday</option><option value="toMonday">The person who said Yes</option></>}
          </select> : <span className="md-muted">{field.direction === 'both' ? 'Both ways' : 'To Monday'}</span>}</td>
          <td className="md-example">{exampleOf(field, example, draft)}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {draft.columns.stage && <div className="md-subtable">
      <h5>Stage labels</h5>
      <table className="md-table"><thead><tr><th scope="col">Stage</th><th scope="col">Monday label</th></tr></thead>
        <tbody>{STAGES.map((stage) => { const fallback = catalog.stageLabels[stage]; const value = draft.statusLabels[stage] || fallback; const choices = [...new Set([...labels, value, fallback])]; return <tr key={stage}><th scope="row">{STAGE_WORDS[stage]}</th><td><select aria-label={`Monday label for ${STAGE_WORDS[stage]}`} value={value} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, statusLabels: { ...current.statusLabels, [stage]: event.target.value } }))}>{choices.map((label) => <option key={label} value={label}>{labels.includes(label) ? label : `Add “${label}”`}</option>)}</select></td></tr>; })}</tbody></table>
      <small className="md-muted">Labels not listed here are left alone.</small>
    </div>}
    <fieldset className="md-fieldset"><legend>Groups</legend>
      <label className="md-check"><input type="radio" name="md-groups" checked={draft.groups.by === 'stage'} onChange={() => setDraft((current) => ({ ...current, groups: { ...current.groups, by: 'stage' } }))} />One group per stage (items move when their stage changes)</label>
      <label className="md-check"><input type="radio" name="md-groups" checked={draft.groups.by === 'run'} onChange={() => setDraft((current) => ({ ...current, groups: { ...current.groups, by: 'run' } }))} />One group per research run</label>
      <label className="md-check"><input type="radio" name="md-groups" checked={draft.groups.by === 'none'} onChange={() => setDraft((current) => ({ ...current, groups: { ...current.groups, by: 'none' } }))} />Keep items in one group
        {draft.groups.by === 'none' && <select aria-label="The group" value={draft.groups.defaultGroupId} onChange={(event) => setDraft((current) => ({ ...current, groups: { ...current.groups, defaultGroupId: event.target.value } }))}>{list(board.groups).map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select>}</label>
    </fieldset>
  </div>;
}

function RulesStep({ draft, setDraft, web, monday, trends, existing }) {
  const set = (part, patch) => setDraft((current) => ({ ...current, [part]: { ...current[part], ...patch } }));
  const instantOn = monday.link?.pull?.instant === 'on';
  const calls = estimateMondayCalls({ push: draft.push, pull: draft.pull, trends, instant: draft.pull.mode === 'instant' && (instantOn || web) });
  const limit = Number(monday.dailyLimit) || 0;
  const heavy = limit && calls > 0.6 * limit;
  return <div className="md-step" aria-labelledby="md-step-rules">
    <h4 id="md-step-rules"><span className="md-step-number">4</span>Sync rules</h4>
    <fieldset className="md-fieldset"><legend>Send to Monday</legend>
      {[['live', 'As changes happen'], ['hourly', 'Every hour'], ['daily', 'Every day at'], ['manual', 'Only when someone presses Sync now']].map(([id, label]) => <label key={id} className="md-check"><input type="radio" name="md-push" checked={draft.push.mode === id} onChange={() => set('push', { mode: id })} />{label}{id === 'daily' && <input type="time" aria-label="Time of day" value={draft.push.dailyAt} disabled={draft.push.mode !== 'daily'} onChange={(event) => set('push', { dailyAt: event.target.value })} />}</label>)}
    </fieldset>
    <fieldset className="md-fieldset"><legend>Send trends from</legend>
      <label className="md-check"><input type="radio" name="md-from" checked={draft.push.from === 'all'} onChange={() => set('push', { from: 'all' })} />All research runs</label>
      <label className="md-check"><input type="radio" name="md-from" checked={draft.push.from === 'now'} onChange={() => set('push', { from: 'now' })} />New research runs from now on{existing ? ' (suggested for a board already in use)' : ''}</label>
      <label className="md-check"><input type="checkbox" checked={draft.push.includeSkipped} onChange={(event) => set('push', { includeSkipped: event.target.checked })} />Include skipped trends</label>
      <label className="md-check"><input type="checkbox" checked={draft.push.postUpdates} onChange={(event) => set('push', { postUpdates: event.target.checked })} />Post an update on the item when reports are ready and when a channel plans to use the trend</label>
    </fieldset>
    <fieldset className="md-fieldset"><legend>Yes and Skip on Monday</legend>
      {web && <label className="md-check"><input type="radio" name="md-decisions" checked={draft.pull.decisions === 'members'} onChange={() => set('pull', { decisions: 'members' })} />From studio editors and admins, matched by email</label>}
      <label className="md-check"><input type="radio" name="md-decisions" checked={draft.pull.decisions === 'anyone' || (!web && draft.pull.decisions === 'members')} onChange={() => set('pull', { decisions: 'anyone' })} />From anyone who can edit the board</label>
      <label className="md-check"><input type="radio" name="md-decisions" checked={draft.pull.decisions === 'off'} onChange={() => set('pull', { decisions: 'off' })} />Don’t accept</label>
      <small className="md-muted">Only trends still waiting for an OK can be decided on Monday. Writing reports always starts in the studio, after you see the cost.</small>
    </fieldset>
    <fieldset className="md-fieldset"><legend>From Monday</legend>
      <label className="md-check"><input type="checkbox" checked={draft.pull.comments} onChange={(event) => set('pull', { comments: event.target.checked })} />Show Monday comments on the trend</label>
      <label className="md-check"><input type="checkbox" checked={draft.pull.owner && draft.pull.dates} onChange={(event) => set('pull', { owner: event.target.checked, dates: event.target.checked })} />Show owner and dates set on Monday</label>
    </fieldset>
    <fieldset className="md-fieldset"><legend>Check Monday for changes</legend>
      {web && <label className="md-check"><input type="radio" name="md-pull" checked={draft.pull.mode === 'instant'} onChange={() => set('pull', { mode: 'instant' })} />Instantly (needs the studio’s public https address)</label>}
      <label className="md-check"><input type="radio" name="md-pull" checked={draft.pull.mode === 'poll'} onChange={() => set('pull', { mode: 'poll' })} />Every<select aria-label="Minutes between checks" value={draft.pull.pollMinutes} disabled={draft.pull.mode !== 'poll'} onChange={(event) => set('pull', { pollMinutes: Number(event.target.value) })}>{catalog.pollMinutes.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
      <label className="md-check"><input type="radio" name="md-pull" checked={draft.pull.mode === 'manual'} onChange={() => set('pull', { mode: 'manual' })} />Only when someone presses Sync now</label>
      {!web && <small className="md-muted">The Mac app checks only while it is open.</small>}
      {monday.link?.pull?.instantNote && <small className="md-muted md-block">{monday.link.pull.instantNote}</small>}
    </fieldset>
    <fieldset className="md-fieldset"><legend>If someone deletes an item on Monday</legend>
      <label className="md-check"><input type="radio" name="md-deleted" checked={draft.onDeleted === 'leave'} onChange={() => setDraft((current) => ({ ...current, onDeleted: 'leave' }))} />Leave it deleted</label>
      <label className="md-check"><input type="radio" name="md-deleted" checked={draft.onDeleted === 'recreate'} onChange={() => setDraft((current) => ({ ...current, onDeleted: 'recreate' }))} />Add it again</label>
    </fieldset>
    <p className={`md-budget${heavy ? ' is-warning' : ''}`} data-testid="md-budget">About {fmt(calls)} Monday API calls a day at these settings{limit ? `; your plan allows ${fmt(limit)}` : ''}. {fmt(monday.callsToday)} used today.{heavy ? ' Check less often, or send changes every hour, to stay well inside the limit.' : ''}</p>
  </div>;
}

function MondaySummary({ monday, api, disabled, working, onEdit, onPause, onMessage }) {
  const link = monday.link; const counts = link.counts || {};
  const sync = (payload, label) => async () => { try { const result = await api.syncTrendBoardToMonday(payload); onMessage({ tone: 'ok', text: result?.joined ? 'A sync is already running.' : label }); } catch (error) { onMessage({ tone: 'problem', text: error?.message || 'Monday.com sync didn’t start.' }); } };
  const failedKeys = Object.entries(monday.items || {}).filter(([, item]) => item.state === 'failed').map(([key]) => key);
  return <div className="md-summary">
    <div className="md-summary-head"><strong>Syncing with {link.boardName || 'your board'}</strong>{link.boardUrl && <a href={link.boardUrl} target="_blank" rel="noreferrer noopener">Open board<ExternalLink size={12} aria-hidden="true" /></a>}</div>
    <p className="md-muted">{[link.lastSentAt ? `Last sent ${timeAgo(link.lastSentAt)}` : 'Nothing sent yet', `${fmt(counts.onMonday)} trends on Monday`, counts.failed ? `${fmt(counts.failed)} couldn’t sync` : '', counts.removed ? `${fmt(counts.removed)} removed on Monday` : ''].filter(Boolean).join(' · ')}</p>
    {link.paused && <p className="md-problem"><CircleAlert size={14} aria-hidden="true" />{link.paused.message}{link.paused.until ? ` Back at ${clockAt(link.paused.until)}.` : ''}</p>}
    {list(link.problems).map((problem) => <p key={problem} className="md-problem"><CircleAlert size={14} aria-hidden="true" />{problem}</p>)}
    <p className="md-muted">{link.pull?.mode === 'instant' && link.pull.instant === 'on' ? `Instant updates are on${link.lastPullAt ? ` · Monday last checked ${timeAgo(link.lastPullAt)}` : ''}` : link.pull?.mode === 'manual' ? 'Changes on Monday are read when someone presses Sync now.' : `Checking Monday every ${link.pull?.pollMinutes || 5} minutes${link.lastPullAt ? ` · last checked ${timeAgo(link.lastPullAt)}` : ''}`}{link.pull?.instantNote ? ` · ${link.pull.instantNote}` : ''}</p>
    <div className="md-row md-wrap">
      <Button disabled={disabled} onClick={sync({}, 'Syncing with Monday.com. It runs in the background.')}><RefreshCw size={14} aria-hidden="true" />Sync now</Button>
      {failedKeys.length > 0 && <Button className="ghost" disabled={disabled} onClick={sync({ keys: failedKeys, force: true }, `Trying ${fmt(failedKeys.length)} again.`)}>Retry failed</Button>}
      <Button className="ghost" disabled={disabled} onClick={onEdit}>Edit setup</Button>
      <Button className="ghost" disabled={disabled} onClick={onPause}>{working === 'pause' && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{link.paused?.reason === 'user' ? 'Resume syncing' : 'Pause syncing'}</Button>
    </div>
  </div>;
}

function DisconnectPanel({ api, confirm, disabled, run, hasLink, onDone, onCancel }) {
  const [scope, setScope] = useState(hasLink ? 'board' : 'all');
  const [forget, setForget] = useState(false);
  const go = async () => {
    const ok = await confirm({ title: scope === 'all' ? 'Disconnect Monday.com?' : 'Stop syncing this board?', lines: ['Items on Monday stay as they are. The studio stops sending and reading changes and removes its webhooks from the board.', forget ? 'The studio will also forget which items belong to which trends.' : ''], confirmLabel: scope === 'all' ? 'Disconnect' : 'Stop syncing', tone: 'danger' });
    if (!ok) return;
    await run('disconnect', () => api.disconnectMonday({ scope, forgetItems: forget }), () => onDone(scope === 'all' ? 'Monday.com is disconnected. Items on Monday stay as they are.' : 'Stopped syncing. Items on Monday stay as they are.'));
  };
  return <div className="md-disconnect" role="group" aria-label="Disconnect Monday.com">
    {hasLink && <label className="md-check"><input type="radio" name="md-disconnect" checked={scope === 'board'} onChange={() => setScope('board')} />Stop syncing this board (keep the token)</label>}
    <label className="md-check"><input type="radio" name="md-disconnect" checked={scope === 'all'} onChange={() => setScope('all')} />Disconnect Monday.com completely</label>
    {hasLink && <label className="md-check"><input type="checkbox" checked={forget} onChange={(event) => setForget(event.target.checked)} />Forget which items belong to which trends</label>}
    {hasLink && <small className="md-muted">Keep this unless you’ll never use this board again. It stops duplicates if you reconnect.</small>}
    <div className="md-row"><Button className="danger" disabled={disabled} onClick={go}>Disconnect…</Button><Button className="ghost" disabled={disabled} onClick={onCancel}>Cancel</Button></div>
  </div>;
}
