import React, { useEffect, useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ShareOfVoice } from './share-of-voice.jsx';
import { ProgramsPanel } from './home-programs.jsx';
import { Dialog, DialogClose, copyText } from './role-screens.jsx';
import { useViewer } from './viewer.js';
import './programs-page.css';

// The Research programs page (the first pipeline stage, for admins with Manage research programs): every program at a
// glance, with Run now (its cost confirmation first), Edit (Workbench → Edit research program, where every setting and
// the research and report prompts live), Pause or Resume schedule, and People (who sees the program's work). It reuses
// Home's program cards, so both say the same (and Home's .wb-page wrapper, which those cards' buttons are styled under). `onEditProgram(programId)` is the shell's way to the editor; without it
// Edit opens the quick-edit drawer.
const list = (value) => (Array.isArray(value) ? value : []);
export function ProgramsPage({ state = {}, api = {}, busy = false, needsSetup = false, onStartResearch, onOpenTarget, onNotice, onEditProgram, onAddProgram }) {
  const [people, setPeople] = useState(null); // the program whose People dialog is open
  const canPeople = typeof api.getTeam === 'function' && typeof api.saveMember === 'function';
  return <div className="wb-page simple-page simple-programs" data-spot="programs.page">
    <div className="simple-page-head"><div><h1>Research programs</h1><p>Research starts here. Each program defines what to monitor and generates trends for your team to review. Create separate programs for different topics or brands.</p></div></div>
    <ProgramsPanel state={state} api={api} busy={busy} needsSetup={needsSetup} onStartResearch={onStartResearch} onOpenTarget={onOpenTarget} onNotice={onNotice}
      onEditProgram={onEditProgram} onAddProgram={onAddProgram} onOpenProgramPage={onOpenTarget ? (id) => onOpenTarget({ kind: 'program', id }) : undefined} onPeople={canPeople ? setPeople : undefined} limit={Infinity} page />
    {people && <ProgramPeople program={people} programs={list(state.contentStudio?.programs)} api={api} onNotice={onNotice} onClose={() => setPeople(null)} />}
  </div>;
}

// The server supplies only programs this person can see. Render known descriptive fields, rather than passing a
// program into the admin editor: that editor also contains models, budgets and controls this role cannot use.
export function ChannelPrograms({ programs = [], api = {}, viewer = {}, workspaceName = '', initialProgramId = '', initialTab = '', onProgramChange }) {
  const detailTitle = useId(); const requestTitle = useId(); const messageId = useId();
  const [selected, setSelected] = useState(initialProgramId);
  const [tab, setTab] = useState(initialTab);
  const [request, setRequest] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => { setSelected(initialProgramId); setTab(initialTab); }, [initialProgramId, initialTab]);
  const rows = list(programs); const program = rows.find((row) => row.id === selected);
  const select = (id, next = '') => { setSelected(id); setTab(next); onProgramChange?.(id, next); };
  const hasVoice = (row) => row?.shareOfVoiceEnabled && typeof api.readShareOfVoice === 'function';
  function contact(name = '') {
    setMessage(`Hi ${viewer.askAdmin || 'team'}, I’d like to request a research program ${name ? `change for “${name}”` : 'addition or update'} in ${workspaceName || 'our workspace'}.\n\nWhat I need:\n`);
    setCopied(''); select(''); setRequest(true);
  }
  const schedule = (value = {}) => value.frequency && value.frequency !== 'manual' ? `${value.enabled ? 'Runs' : 'Paused'} ${value.frequency}${value.time ? ` at ${value.time}` : ''}${value.timeZone ? ` (${value.timeZone})` : ''}` : 'On demand';
  if (tab === 'share-of-voice' && hasVoice(program)) return <div className="simple-page program-page channel-voice">
    <header className="trend-page-head"><button type="button" className="simple-back" onClick={() => select('')}><ArrowLeft size={15} aria-hidden="true" />Research programs</button><div className="trend-page-title"><h1>{program.name}</h1></div></header>
    <ShareOfVoice key={program.id} api={api} program={program} viewer={viewer} />
  </div>;
  return <div className="wb-page simple-page simple-programs channel-programs" data-spot="programs.page">
    <div className="simple-page-head"><div><h1>Research programs</h1><p>Research starts here. Each program defines what to monitor and generates trends for your team to review.</p></div></div>
    <div className="program-readonly-note"><p>You can view the programs available to you. To add or edit a research program, contact {viewer.askAdmin || 'a workspace admin'}.</p><button type="button" className="studio-quiet" onClick={() => contact()}>Contact admin</button></div>
    <section className="wb-card hp-card" aria-label="Available research programs"><header className="wb-card-head"><h2>{rows.length} research {rows.length === 1 ? 'program' : 'programs'}</h2></header>
      {rows.length ? <ul className="hp-list">{rows.map((row) => <li className="hp-row" key={row.id}><div className="hp-head"><div className="hp-title"><h3>{row.name}</h3><p className="program-focus">{row.query || 'An admin defines what this program follows.'}</p><p className="hp-meta">{schedule(row.schedule)}</p></div><button type="button" className="studio-quiet" aria-label={`View ${row.name}`} onClick={() => select(row.id)}>View program</button>{hasVoice(row) && <button type="button" className="studio-primary" onClick={() => select(row.id, 'share-of-voice')}>Share of voice</button>}</div></li>)}</ul> : <p className="wb-empty">No research programs are available to you yet. Contact an admin to request access.</p>}
    </section>
    {program && <Dialog labelledBy={detailTitle} onClose={() => select('')} className="program-readonly-detail">
      <header className="studio-dialog-head"><div><h2 id={detailTitle}>{program.name}</h2><p className="studio-dialog-meta">Research program · Read only</p></div><DialogClose onClose={() => select('')} /></header>
      <div className="studio-dialog-body"><h3>Research focus</h3><p>{program.query || 'No research focus has been added yet.'}</p><h3>Sources</h3>
        {list(program.sourceGroups).length ? <ul className="program-source-list">{list(program.sourceGroups).map((group, index) => <li key={group.id || index}><strong>{group.name || group.platform || 'Sources'}{group.enabled === false ? ' · Paused' : ''}</strong><ul>{list(group.targets).length ? list(group.targets).map((target, i) => <li key={i}>{typeof target === 'string' ? target : target.label || target.url || target.handle || 'Source'}</li>) : <li>No sources added</li>}</ul></li>)}</ul> : <p>No sources have been added yet.</p>}
        <h3>Schedule</h3><p>{schedule(program.schedule)}</p>
        {(program.window?.startDate || program.window?.endDate) && <p>Research dates: {program.window.startDate || 'Start not set'} to {program.window.endDate || 'End not set'}</p>}
        {program.schedule?.lookbackDays > 0 && <p>Each scheduled run looks back {program.schedule.lookbackDays} days.</p>}
        {program.brand?.mode === 'own' && <><h3>Brand context</h3><p><strong>{program.brand.name}</strong></p>{program.brand.audience && <p>Audience: {program.brand.audience}</p>}{program.brand.positioning && <p>{program.brand.positioning}</p>}{program.brand.voice && <p>Voice: {program.brand.voice}</p>}</>}
      </div><footer className="workspace-tour-actions"><button type="button" className="studio-quiet" onClick={() => contact(program.name)}>Request a change</button>{hasVoice(program) && <button type="button" className="studio-quiet" onClick={() => select(program.id, 'share-of-voice')}>Share of voice</button>}<button type="button" className="studio-primary" onClick={() => select('')}>Done</button></footer>
    </Dialog>}
    {request && <Dialog labelledBy={requestTitle} onClose={() => setRequest(false)} className="program-admin-request"><header className="studio-dialog-head"><div><h2 id={requestTitle}>Request a research program change</h2><p className="studio-dialog-meta">Send this to {viewer.askAdmin || 'a workspace admin'} in your usual work chat or email.</p></div><DialogClose onClose={() => setRequest(false)} /></header>
      <div className="studio-dialog-body"><label htmlFor={messageId}>Message to your workspace admin</label><textarea id={messageId} rows={7} value={message} onChange={(event) => { setMessage(event.target.value); setCopied(''); }} />{copied && <p role="status">{copied}</p>}</div>
      <footer className="workspace-tour-actions"><button type="button" className="studio-quiet" onClick={() => setRequest(false)}>Close</button><button type="button" className="studio-primary" disabled={!message.trim()} onClick={async () => setCopied(await copyText(message) ? 'Request copied. Paste it into your work chat or email to send it.' : 'The request could not be copied. Select the message and copy it manually.')}>Copy request</button></footer>
    </Dialog>}
  </div>;
}

// Who sees one program: admins always; everyone else when they have every program or this one. A switch per person
// adds or removes this program from their list (taking it from someone with every program leaves them all the others).
// Saved at once, one person at a time, through People & access's own saveMember; the server enforces it.
export function ProgramPeople({ program, programs = [], api, onNotice, onClose }) {
  const viewer = useViewer();
  const titleId = useId();
  const [team, setTeam] = useState(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState('');
  useEffect(() => { let live = true; Promise.resolve(api.getTeam()).then((result) => { if (live) setTeam(result || { members: [] }); }, (failure) => { if (live) setProblem(failure?.message || 'People couldn’t be loaded.'); }); return () => { live = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const members = list(team?.members).filter((member) => !member.disabled);
  const sees = (member) => member.base === 'admin' || !Array.isArray(member.programIds) || member.programIds.includes(program.id);
  async function toggle(member, on) {
    const all = list(programs).map((row) => row.id);
    const current = Array.isArray(member.programIds) ? member.programIds : all;
    const next = on ? [...new Set([...current, program.id])] : current.filter((id) => id !== program.id);
    setSaving(member.id); setProblem('');
    try {
      const result = await api.saveMember({ id: member.id, programIds: next.length === all.length && all.every((id) => next.includes(id)) ? null : next });
      const saved = result?.member || { ...member, programIds: next };
      setTeam((value) => ({ ...value, members: list(value?.members).map((row) => (row.id === member.id ? { ...row, programIds: saved.programIds ?? null } : row)) }));
      onNotice?.(on ? `${member.name} now sees “${program.name}”.` : `${member.name} no longer sees “${program.name}”.`);
    } catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally { setSaving(''); }
  }
  return <Dialog labelledBy={titleId} onClose={onClose} className="people-sheet program-people">
    <header className="studio-dialog-head"><div><small>Research program</small><h2 id={titleId}>Who sees “{program.name}”</h2><p className="studio-dialog-meta">Admins see every program. Choose who else sees this one’s trends, reports and assets.</p></div><DialogClose onClose={onClose} /></header>
    <div className="studio-dialog-body">
      {problem && <p className="studio-error" role="alert">{problem}</p>}
      {!team ? <p className="studio-hint" role="status">Loading people…</p>
        : <ul className="program-people-list">{members.map((member) => {
          const admin = member.base === 'admin';
          return <li key={member.id}><label className={admin ? 'is-locked' : ''}>
            <input type="checkbox" role="switch" checked={sees(member)} disabled={admin || Boolean(saving) || viewer.preview} onChange={(event) => toggle(member, event.target.checked)} />
            <span><strong>{member.name}</strong><small>{[member.roleLabel, admin ? 'Sees every program' : !Array.isArray(member.programIds) ? 'All programs' : `${member.programIds.length} ${member.programIds.length === 1 ? 'program' : 'programs'}`].filter(Boolean).join(' · ')}</small></span>
          </label></li>;
        })}</ul>}
    </div>
  </Dialog>;
}
