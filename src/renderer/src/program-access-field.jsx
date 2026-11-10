import React, { useId } from 'react';

// Which research programs a person sees (People & access: the person sheet and Invite). `value` is null for every program,
// including ones added later (the default), or the chosen program ids. Admins always see every program, so the field
// isn't shown for them. The server enforces it (src/main/program-scope.js); this only chooses.
const list = (value) => (Array.isArray(value) ? value : []);
export function ProgramAccessField({ programs = [], value = null, onChange, disabled = false, first = 'They' }) {
  const id = useId();
  const chosen = Array.isArray(value) ? value : null;
  const toggle = (programId, on) => onChange([...new Set(on ? [...list(chosen), programId] : list(chosen).filter((row) => row !== programId))]);
  return <fieldset className="people-programs" data-spot="people.programs">
    <legend>Research programs</legend>
    <div className="people-program-modes" role="radiogroup" aria-label="Research programs">
      <label className={chosen === null ? 'checked' : ''}><input type="radio" name={`${id}-mode`} checked={chosen === null} disabled={disabled} onChange={() => onChange(null)} /><span><strong>All programs</strong><small>Every program’s trends, reports and assets, including programs added later.</small></span></label>
      <label className={chosen ? 'checked' : ''}><input type="radio" name={`${id}-mode`} checked={Boolean(chosen)} disabled={disabled || !programs.length} onChange={() => onChange(list(chosen))} /><span><strong>Only the programs I choose</strong><small>{programs.length ? `${first} see${first === 'They' ? '' : 's'} only these programs’ work.` : 'Add a research program first.'}</small></span></label>
    </div>
    {chosen && <ul className="people-program-list" aria-label="Programs">
      {programs.map((program) => <li key={program.id}><label><input type="checkbox" checked={chosen.includes(program.id)} disabled={disabled} onChange={(event) => toggle(program.id, event.target.checked)} />{program.name || 'Untitled program'}</label></li>)}
    </ul>}
    {chosen && !chosen.length && <p className="studio-hint" role="status">With no program chosen, {first === 'They' ? 'they see' : `${first} sees`} no research program’s trends or reports.</p>}
  </fieldset>;
}
// "All programs", "AI search pulse", "2 programs": a person's programs in a few words, for People's table.
export function programsLabel(programIds, programs = []) {
  if (!Array.isArray(programIds)) return 'All programs';
  if (!programIds.length) return 'No programs';
  if (programIds.length === 1) return list(programs).find((row) => row.id === programIds[0])?.name || '1 program';
  return `${programIds.length} programs`;
}
