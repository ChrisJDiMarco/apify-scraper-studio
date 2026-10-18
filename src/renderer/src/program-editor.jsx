import React from 'react';
import { Settings2 } from 'lucide-react';
import { ProgramWindowFields, ProgramAiFields, ProgramAutomationFields, ProgramEstimate, ProgramCollectionFields, ProgramMatchFields, DEFAULT_PROGRAM_AI, DEFAULT_COLLECTION } from './research-program-fields.jsx';
import { WEEKDAYS, emptySchedule, scheduleSummary, timeZones } from './program-summary.js';

// The research program form, shared by the Research programs page (idPrefix 'cs', the fields in one column, ids exactly
// as before) and Home's program drawer (idPrefix 'pd', `grouped`: one titled section per PROGRAM_GROUPS entry, so the
// drawer's jump chips can reach each). Nothing here saves or spends; the caller's Save sends programPayload(...).
export const SOURCE_TYPES = [
  { sourceId: 'reddit', platform: 'reddit', name: 'Reddit communities', label: 'Subreddits', placeholder: 'r/marketing\nr/SaaS' },
  { sourceId: 'x', platform: 'x', name: 'X accounts', label: 'X accounts', placeholder: '@apify\nhttps://x.com/account' },
  { sourceId: 'linkedin-profile', platform: 'linkedin', name: 'LinkedIn accounts', label: 'LinkedIn profile or company URLs', placeholder: 'https://www.linkedin.com/company/company-name' },
  { sourceId: 'linkedin-search', platform: 'linkedin', name: 'LinkedIn keyword search', label: 'Search topic', placeholder: '' },
];
export const PROGRAM_GROUPS = Object.freeze([['basics', 'Name & focus'], ['sources', 'Sources'], ['when', 'Schedule & dates'], ['budgets', 'Budgets & estimate'], ['ai', 'AI models'], ['automation', 'Automation'], ['advanced', 'Advanced']]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const split = (value) => [...new Set(String(value || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
const readable = (value) => String(value || 'draft').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const money = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '—';
const targetsOf = (group) => (Array.isArray(group?.targets) ? group.targets : split(group?.targets));
const emptyGroup = (source) => ({ id: `source-${source.sourceId}`, sourceId: source.sourceId, platform: source.platform, name: source.name, targets: [], enabled: false, options: {} });
function Field({ label, id, hint, children, className = '' }) { return <div className={`cs-field ${className}`}><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }

export const emptyProgram = (workspaceId) => ({ name: '', workspaceId, schedule: emptySchedule(), query: '', sourceGroups: SOURCE_TYPES.map(emptyGroup), window: { startDate: '', endDate: '' }, lookbackDays: 7, targetPerPlatform: 3000, maxEvidenceItems: 10000, perAuthorCap: 10, budgets: { collectionUsd: 10, aiUsd: 25 }, thresholds: { discovery: { x: 40, linkedin: 25, reddit: 15 }, tagging: { x: 20, linkedin: 1, reddit: 1 } }, discoveryBatchSize: 200, taggingBatchSize: 40, taggingBatchSizes: { x: 50, linkedin: 40, reddit: 50 }, maxThemes: 6, includeUndated: false, topicFiltersTargets: false, autoApproveThemes: false, ai: clone(DEFAULT_PROGRAM_AI), collection: { ...DEFAULT_COLLECTION }, delivery: { publishToDrive: false } });
// A saved program as the form's draft: every source type present (in the form's order) and a full schedule.
export const programDraft = (program, workspaceId) => (program ? { ...emptyProgram(workspaceId), ...clone(program), schedule: { ...emptySchedule(), ...clone(program.schedule || {}) }, sourceGroups: SOURCE_TYPES.map((source) => clone(program.sourceGroups?.find((group) => group.sourceId === source.sourceId) || emptyGroup(source))) } : emptyProgram(workspaceId));
// What Save sends: the draft with pasted target lists split into arrays. `baseUpdatedAt` (the program's updatedAt when the
// form opened) makes the server refuse a save over someone else's newer one; it is left out for a new program.
export function programPayload(draft, workspaceId, { baseUpdatedAt } = {}) {
  return { ...draft, workspaceId, sourceGroups: draft.sourceGroups.map((group) => ({ ...group, targets: targetsOf(group) })), ...(baseUpdatedAt ? { baseUpdatedAt } : {}) };
}
// Two drafts that would save the same program have the same key (unsaved-change checks).
export const draftKey = (draft) => (draft ? JSON.stringify(programPayload(draft, draft.workspaceId)) : '');
// The first thing Save would be refused for, as { message, group } (the group whose section holds it), else null. Mirrors
// research-program.js so the drawer can point at the field before anything is sent.
export function checkDraft(draft = {}) {
  if (!String(draft.name || '').trim()) return { message: 'Name this research program.', group: 'basics' };
  if (draft.window?.startDate && draft.window?.endDate && draft.window.startDate > draft.window.endDate) return { message: 'Choose an end date on or after the start date.', group: 'when' };
  const groups = Array.isArray(draft.sourceGroups) ? draft.sourceGroups : [];
  for (const group of groups) {
    if (!group.enabled) continue;
    if (group.sourceId === 'linkedin-search') { if (!String(draft.query || '').trim()) return { message: 'Add a research focus for LinkedIn keyword search, or turn it off.', group: 'basics' }; continue; }
    if (!targetsOf(group).length) return { message: `Add accounts to ${group.name || 'this source'}, or turn it off.`, group: 'sources' };
  }
  if (draft.schedule?.enabled && draft.schedule.frequency !== 'manual' && !groups.some((group) => group.enabled)) return { message: 'Turn on a source before scheduling runs.', group: 'sources' };
  return null;
}

export function ProgramSourceOptions({ sourceId, options = {}, keywordSearch = false, onChange, idPrefix = 'cs' }) {
  const p = idPrefix;
  const set = (key, value) => onChange({ ...options, [key]: value });
  const checkbox = (key, label, fallback = false) => <label className="cs-check"><input id={`${p}-source-${sourceId}-${key}`} type="checkbox" checked={options[key] ?? fallback} onChange={(event) => set(key, event.target.checked)} /><span>{label}</span></label>;
  const count = (key, label) => <Field id={`${p}-source-${sourceId}-${key}`} label={label}><input id={`${p}-source-${sourceId}-${key}`} type="number" min="1" max="100" step="1" value={options[key] ?? 5} onChange={(event) => set(key, Number(event.target.value))} /></Field>;
  const select = (key, label, values, fallback) => <Field id={`${p}-source-${sourceId}-${key}`} label={label}><select id={`${p}-source-${sourceId}-${key}`} value={options[key] ?? fallback} onChange={(event) => set(key, event.target.value)}>{values.map(([value, copy]) => <option key={value} value={value}>{copy}</option>)}</select></Field>;
  return <details className="cs-details cs-program-source-options" id={`${p}-source-options-${sourceId}`}><summary><Settings2 size={13} />Collection options</summary><div>
    {sourceId === 'x' ? <><div className="cs-two-fields">{select('replies', 'Replies', [['all', 'Posts and replies'], ['exclude', 'Exclude replies'], ['only', 'Replies only']], 'all')}{select('sort', 'Sort order', [['Latest', 'Latest'], ['Top', 'Top'], ['Latest + Top', 'Latest and top']], 'Latest')}</div>{select('media', 'Media filter', [['all', 'Any content'], ['media', 'Any media'], ['images', 'Images'], ['videos', 'Videos'], ['links', 'Links']], 'all')}{checkbox('includeRetweets', 'Include native reposts', true)}<p>X replies are search results; full conversation threads are not expanded automatically.</p></> : <>
      {checkbox('includeComments', 'Include thread comments')}
      {options.includeComments && count('maxComments', 'Comments per post')}
      {sourceId === 'reddit' ? <>{keywordSearch && checkbox('searchComments', 'Search matching comments')}<p>{keywordSearch ? 'Searches the research focus inside these communities, newest first, back to the program’s start date.' : 'Reads each community’s newest posts back to the program’s start date, like the n8n workflow.'} Posts and comments share Reddit’s collection limit.</p></> : <>{checkbox('includeReactions', sourceId === 'linkedin-search' ? 'Include liked-user details' : 'Include reactions')}{options.includeReactions && count('maxReactions', sourceId === 'linkedin-search' ? 'Liked users per post' : 'Reactions per post')}{sourceId === 'linkedin-profile' ? <>{checkbox('includeQuotePosts', 'Include quote posts', true)}{checkbox('includeReposts', 'Include reposts')}<p>Comments and reactions add separate provider rows and can increase collection costs. The saved spending caps still apply.</p></> : <>{checkbox('fetchDocumentDetails', 'Include document details')}<p>Additional post details can increase collection time and cost.</p></>}</>}
    </>}
  </div></details>;
}

// `onEdit()` hears typed changes to the plain fields (the page clears its error); `canEstimate` false shows a note in place
// of the estimate (estimates belong to Start research); `onEstimate` hears each estimate; `nameRef` is the name input.
// `errorGroup` marks the group holding the current error (grouped only).
export function ProgramEditorFields({ draft, setDraft, capabilities = {}, api = {}, canEstimate = true, idPrefix = 'cs', grouped = false, onEdit, onEstimate, nameRef, errorGroup = '' }) {
  const p = idPrefix;
  function change(key, value) { setDraft((current) => ({ ...current, [key]: value })); onEdit?.(); }
  function nested(key, field, value) { setDraft((current) => ({ ...current, [key]: { ...current[key], [field]: value } })); }
  function changeSource(id, key, value) { setDraft((current) => ({ ...current, sourceGroups: current.sourceGroups.map((group) => group.sourceId === id ? { ...group, [key]: value } : group) })); }
  const recurring = draft.schedule.frequency !== 'manual';

  const basics = <>
    <div className="cs-two-fields"><Field id={`${p}-program-name`} label="Program name"><input id={`${p}-program-name`} ref={nameRef} value={draft.name} maxLength={160} onChange={(event) => change('name', event.target.value)} placeholder="e.g. AI search market pulse" required /></Field><Field id={`${p}-program-query`} label="Research focus (optional)" hint="Guides the AI’s discovery. Accounts and communities are collected in full, like the n8n workflow; LinkedIn keyword search uses it as the search term."><input id={`${p}-program-query`} value={draft.query} maxLength={500} onChange={(event) => change('query', event.target.value)} placeholder="e.g. AI search visibility and measurement" /></Field></div>{draft.query.trim() && <label className="cs-check cs-topic-filter"><input type="checkbox" checked={Boolean(draft.topicFiltersTargets)} onChange={(event) => change('topicFiltersTargets', event.target.checked)} /><span><strong>Also filter account and community collection by this focus</strong><small>Narrows X searches and switches Reddit from newest posts to a keyword search. Leave off for n8n parity.</small></span></label>}
  </>;
  const sourcesIntro = <p className="cs-group-intro">Paste whole lists. Supported targets are normalized and deduplicated when saved.</p>;
  const sourceGroups = <div className="cs-source-groups">{SOURCE_TYPES.map((source) => { const group = draft.sourceGroups.find((item) => item.sourceId === source.sourceId); return <div className={`cs-source-group ${group.enabled ? 'selected' : ''}`} key={source.sourceId}><label className="cs-check"><input type="checkbox" checked={group.enabled} onChange={(event) => changeSource(source.sourceId, 'enabled', event.target.checked)} /><span><strong>{source.name}</strong><small>{group.enabled && source.sourceId !== 'linkedin-search' ? `${split(Array.isArray(group.targets) ? group.targets.join('\n') : group.targets).length} targets` : source.sourceId === 'linkedin-search' ? 'Uses the research topic' : 'Add a saved source list'}</small></span></label>{group.enabled && source.sourceId !== 'linkedin-search' && <Field id={`${p}-targets-${source.sourceId}`} label={source.label}><textarea id={`${p}-targets-${source.sourceId}`} rows={4} value={Array.isArray(group.targets) ? group.targets.join('\n') : group.targets} onChange={(event) => changeSource(source.sourceId, 'targets', event.target.value)} placeholder={source.placeholder} maxLength={100000} /></Field>}{group.enabled && <ProgramSourceOptions idPrefix={p} sourceId={source.sourceId} options={group.options} keywordSearch={Boolean(draft.topicFiltersTargets && draft.query.trim())} onChange={(value) => changeSource(source.sourceId, 'options', value)} />}</div>; })}</div>;
  const scheduleFields = <div className="cs-schedule-fields">
    <Field id={`${p}-schedule-frequency`} label="Repeat"><select id={`${p}-schedule-frequency`} value={draft.schedule.frequency} onChange={(event) => setDraft((current) => ({ ...current, schedule: { ...current.schedule, frequency: event.target.value, enabled: false, lookbackDays: ({ daily: 1, weekly: 7, monthly: 30 })[event.target.value] || current.schedule.lookbackDays } }))}><option value="manual">Only when I start it</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
    {recurring && <>
      {draft.schedule.frequency === 'weekly' && <Field id={`${p}-schedule-weekday`} label="Day of the week"><select id={`${p}-schedule-weekday`} value={draft.schedule.weekday} onChange={(event) => nested('schedule', 'weekday', Number(event.target.value))}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field>}
      {draft.schedule.frequency === 'monthly' && <Field id={`${p}-schedule-monthday`} label="Day of the month" hint="Shorter months use their last day."><select id={`${p}-schedule-monthday`} value={draft.schedule.dayOfMonth} onChange={(event) => nested('schedule', 'dayOfMonth', Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></Field>}
      <Field id={`${p}-schedule-time`} label="Run time"><input id={`${p}-schedule-time`} type="time" required value={draft.schedule.time} onChange={(event) => nested('schedule', 'time', event.target.value)} /></Field>
      <Field id={`${p}-schedule-zone`} label="Time zone" hint="Run time follows daylight saving changes in this zone."><select id={`${p}-schedule-zone`} value={draft.schedule.timeZone} onChange={(event) => nested('schedule', 'timeZone', event.target.value)}>{[...new Set([draft.schedule.timeZone, ...timeZones()])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></Field>
    </>}
  </div>;
  const datesHeading = <div className="cs-field-heading"><h4>What dates to search</h4><p>{recurring ? 'Each run searches a fresh rolling window, including runs you start yourself. Provider coverage can be narrower.' : 'Dates filter normalized evidence across every platform. Provider coverage can be narrower.'}</p></div>;
  const dates = recurring ? <div className="cs-lookback-field"><Field id={`${p}-schedule-lookback`} label="Look back (days)" hint="Searches the last complete UTC days before the run. Today is excluded."><input id={`${p}-schedule-lookback`} type="number" min="1" max="365" step="1" required value={draft.schedule.lookbackDays} onChange={(event) => nested('schedule', 'lookbackDays', Number(event.target.value))} /></Field></div> : <ProgramWindowFields idPrefix={p} draft={draft} setDraft={setDraft} />;
  const budgets = <div className="cs-two-fields"><Field id={`${p}-collection-budget`} label="Collection budget (USD)"><input id={`${p}-collection-budget`} type="number" min="0.01" max="1000" step="0.01" value={draft.budgets.collectionUsd} onChange={(event) => nested('budgets', 'collectionUsd', Number(event.target.value))} /></Field><Field id={`${p}-ai-budget`} label="AI budget (USD)"><input id={`${p}-ai-budget`} type="number" min="0.01" max="1000" step="0.01" value={draft.budgets.aiUsd} onChange={(event) => nested('budgets', 'aiUsd', Number(event.target.value))} /></Field></div>;
  const estimate = canEstimate ? <ProgramEstimate draft={draft} api={api} onEstimate={onEstimate} /> : <p className="cs-estimate-note">Estimates need Start research access.</p>;
  const automation = <ProgramAutomationFields draft={draft} setDraft={setDraft} capabilities={capabilities} />;
  // Notes for the AI (research-program.js `notes`): added to the research prompts and to the report prompts after their
  // instructions. The key is left out when both are empty, so an untouched program saves exactly as before.
  const setNote = (key, value) => setDraft((current) => { const next = { research: current.notes?.research || '', reports: current.notes?.reports || '', [key]: value }; const { notes: _drop, ...rest } = current; return next.research || next.reports ? { ...rest, notes: next } : rest; });
  const notes = <div className="cs-two-fields cs-program-notes">
    <Field id={`${p}-notes-research`} label="Notes for finding trends (optional)" hint="Added to the research prompts. Up to 600 characters; never paste keys or passwords."><textarea id={`${p}-notes-research`} rows={3} maxLength={600} value={draft.notes?.research || ''} onChange={(event) => setNote('research', event.target.value)} placeholder="e.g. Ignore posts about job openings." /></Field>
    <Field id={`${p}-notes-reports`} label="Notes for reports (optional)" hint="Added to the trends report and editorial toolkit prompts. Up to 600 characters."><textarea id={`${p}-notes-reports`} rows={3} maxLength={600} value={draft.notes?.reports || ''} onChange={(event) => setNote('reports', event.target.value)} placeholder="e.g. Lead with what changed for agencies." /></Field>
  </div>;
  const consent = recurring && <div className="cs-schedule-consent"><label className="cs-check"><input type="checkbox" checked={draft.schedule.enabled} onChange={(event) => nested('schedule', 'enabled', event.target.checked)} /><span><strong>Enable scheduled runs</strong><small>{scheduleSummary(draft.schedule)}. Each run can use up to {money(draft.budgets.collectionUsd)} for collection and {money(draft.budgets.aiUsd)} for AI. Saving starts the schedule at its next run time.</small></span></label><p>Keep the app or server running. Missed times do not create a backlog. {draft.autoApproveThemes ? 'Themes are approved automatically, so each run finishes with reports.' : 'Each run pauses for your theme review before reports.'} New scheduled runs are skipped while a run is active or waiting for review.</p></div>;
  const advanced = <><div className="cs-advanced-grid">{[['targetPerPlatform', 'Target items per platform', 1, 10000], ['maxEvidenceItems', 'Maximum evidence items', 1, 10000], ['perAuthorCap', 'Maximum items per author', 1, 1000], ['maxThemes', 'Maximum themes', 1, 6], ['discoveryBatchSize', 'Discovery batch size (per platform)', 40, 200]].map(([key, label, min, max]) => <Field id={`${p}-program-${key}`} label={label} key={key}><input id={`${p}-program-${key}`} type="number" min={min} max={max} step="1" value={draft[key]} onChange={(event) => change(key, Number(event.target.value))} /></Field>)}</div><div className="cs-thresholds">{['discovery', 'tagging'].map((stage) => <div key={stage}><h4>{stage === 'discovery' ? 'Discovery' : 'Classification'} engagement thresholds</h4><div className="cs-three-fields">{['x', 'linkedin', 'reddit'].map((platform) => <Field key={platform} id={`${p}-${stage}-${platform}`} label={platform === 'x' ? 'X' : readable(platform)}><input id={`${p}-${stage}-${platform}`} type="number" min="0" max="1000" value={draft.thresholds[stage][platform]} onChange={(event) => setDraft((current) => ({ ...current, thresholds: { ...current.thresholds, [stage]: { ...current.thresholds[stage], [platform]: Number(event.target.value) } } }))} /></Field>)}</div></div>)}</div><ProgramMatchFields idPrefix={p} draft={draft} setDraft={setDraft} /><ProgramCollectionFields idPrefix={p} draft={draft} setDraft={setDraft} /><label className="cs-check"><input type="checkbox" checked={draft.includeUndated} onChange={(event) => change('includeUndated', event.target.checked)} /><span>Include undated evidence in a dated search<small>Undated items otherwise stay outside the selected time frame.</small></span></label></>;

  if (grouped) {
    const body = { basics, sources: <>{sourcesIntro}{sourceGroups}</>, when: <>{scheduleFields}{consent}{datesHeading}{dates}</>, budgets: <><p className="cs-group-intro">These collection and AI limits apply separately to every run.</p>{budgets}{estimate}</>, ai: <><ProgramAiFields idPrefix={p} open draft={draft} setDraft={setDraft} api={api} />{notes}</>, automation, advanced };
    return <>{PROGRAM_GROUPS.map(([id, label]) => <section key={id} className={`pe-group${errorGroup === id ? ' has-error' : ''}`} id={`${p}-group-${id}`} aria-labelledby={`${p}-group-${id}-title`}><h3 id={`${p}-group-${id}-title`}>{label}</h3>{body[id]}</section>)}</>;
  }
  // The Research programs page: one column, in the order it has always had.
  return <>
    {basics}
    <div className="cs-field-heading"><h4>Choose your sources</h4><p>Paste whole lists. Supported targets are normalized and deduplicated when saved.</p></div>{sourceGroups}
    <div className="cs-form-divider" />
    <div className="cs-field-heading"><h4>When to run</h4><p>Run this program yourself, or collect fresh research on a repeating schedule.</p></div>
    {scheduleFields}
    {datesHeading}
    {dates}
    <div className="cs-field-heading"><h4>Spending limits per run</h4><p>These collection and AI limits apply separately to every run.</p></div>
    {budgets}
    {estimate}
    {automation}
    <ProgramAiFields idPrefix={p} draft={draft} setDraft={setDraft} api={api} />
    {notes}
    {consent}

    <details className="cs-details"><summary><Settings2 size={14} />Advanced research controls</summary>{advanced}</details>
  </>;
}
