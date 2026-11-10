import React, { useEffect, useId, useState } from 'react';
import { ProgramsPanel } from './home-programs.jsx';
import { Dialog, DialogClose } from './role-screens.jsx';
import { useViewer } from './viewer.js';

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
    <div className="simple-page-head"><div><h1>Research programs</h1><p>What research follows, when it runs and what it may spend. Run one now, or edit its sources, schedule and AI instructions.</p></div></div>
    <ProgramsPanel state={state} api={api} busy={busy} needsSetup={needsSetup} onStartResearch={onStartResearch} onOpenTarget={onOpenTarget} onNotice={onNotice}
      onEditProgram={onEditProgram} onAddProgram={onAddProgram} onOpenProgramPage={onOpenTarget ? (id) => onOpenTarget({ kind: 'program', id }) : undefined} onPeople={canPeople ? setPeople : undefined} limit={Infinity} page />
    {people && <ProgramPeople program={people} programs={list(state.contentStudio?.programs)} api={api} onNotice={onNotice} onClose={() => setPeople(null)} />}
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
