import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Radar, TriangleAlert } from 'lucide-react';
import { DialogClose, trapTab, useModalFocus } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { useUnsavedGuard } from './asset-editor.jsx';
import { can as canCall, formatTime, writeProps } from './viewer.js';
import { friendlyMessage } from './ui.jsx';
import { researchCostLinesFrom } from './studio-actions.js';
import { PROGRAM_GROUPS, ProgramEditorFields, checkDraft, draftKey, programDraft, programPayload } from './program-editor.jsx';
import { scheduleSummary, scheduledDate } from './program-summary.js';
import { revealSection, useSectionSpy } from './section-spy.js';
import './program-drawer.css';

// Home's quick editor for one research program: a side sheet with every program setting, grouped (Name & focus …
// Advanced) with jump chips, and Save, Discard and Open full page at the bottom. Unsaved edits are guarded (Esc, the
// backdrop, Close, the sidebar and ⌘1–9 ask first; the browser studio also asks before the tab closes). Turning a
// schedule on asks first with the per-run caps and the estimate, since it authorizes future paid runs. A save over
// someone else's newer one is refused (baseUpdatedAt) and says so, without losing the draft.
// `program` is the live saved program (null for a new one); `missing` is true once it has left the workspace.
const isElectron = () => typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent || '');
const conflictOf = (error) => error?.status === 409 || error?.code === 'saveConflict' || /after you opened it/i.test(String(error?.message || ''));
const GROUP_IDS = PROGRAM_GROUPS.map(([id]) => id);

export function ProgramDrawer({ program = null, missing = false, workspace, state = {}, api = {}, viewer = {}, busy = false, anchor, onClose, onSaved, onStartResearch, onOpenFullPage }) {
  const can = (method) => canCall(viewer, method);
  const confirm = useConfirm();
  const guard = useUnsavedGuard();
  const guardKey = useId(); const titleId = useId();
  const sheetRef = useRef(null); const nameRef = useRef(null); const bodyRef = useRef(null);
  const [draft, setDraftState] = useState(() => programDraft(program, workspace.id));
  const baseline = useRef(draftKey(draft));
  const base = useRef(program?.updatedAt || '');
  const [error, setError] = useState(null); // { message, group }
  const [conflict, setConflict] = useState(null); // { at } once someone else saved
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const estimate = useRef(null);
  const dirty = draftKey(draft) !== baseline.current;
  const setDraft = (update) => { setDraftState(update); setNote(''); };
  const preview = Boolean(viewer.preview);
  const codex = state.contentStudio?.capabilities?.aiProvider === 'codex';
  useModalFocus(sheetRef, nameRef);

  useEffect(() => { guard.set(guardKey, dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => guard.set(guardKey, false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty || isElectron() || typeof window === 'undefined') return undefined;
    const ask = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  function reset(next = program) {
    const fresh = programDraft(next, workspace.id);
    baseline.current = draftKey(fresh); base.current = next?.updatedAt || '';
    setDraftState(fresh); setConflict(null); setError(null);
  }
  // Someone saved this program while it is open: an untouched draft follows silently; edits get a banner and a choice.
  useEffect(() => {
    if (missing) { guard.set(guardKey, false); onClose?.('That program isn’t in this workspace anymore.'); return; }
    if (!program?.updatedAt || program.updatedAt === base.current || saving) return;
    if (!dirty) { reset(program); setNote('Updated with the latest saved version.'); }
    else setConflict({ at: program.updatedAt });
  }, [program?.updatedAt, missing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestClose() {
    if (saving) return;
    if (dirty && !(await confirm({ title: `Discard changes to “${draft.name || program?.name || 'this program'}”?`, lines: ['Your edits to this program aren’t saved.'], confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return;
    guard.set(guardKey, false); onClose?.();
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); requestClose(); return; }
    trapTab(event, sheetRef.current);
  }

  const spy = useSectionSpy({ ids: GROUP_IDS, getElement: (id) => document.getElementById(`pd-group-${id}`), offset: 12 });
  function jump(id, focus = false) { const el = document.getElementById(`pd-group-${id}`); if (!el) return; spy.lock(id); revealSection(el, { smooth: true, focus }); }

  async function save(event, { force = false } = {}) {
    event?.preventDefault?.();
    if (saving || preview) return;
    const problem = checkDraft(draft);
    if (problem) { setError(problem); jump(problem.group); return; }
    setError(null);
    const turningOn = draft.schedule.enabled && draft.schedule.frequency !== 'manual' && !(program?.schedule?.enabled && program?.schedule?.frequency !== 'manual');
    if (turningOn) {
      const ok = await confirm({ title: `Turn on scheduled runs for “${draft.name}”?`, lines: [`${scheduleSummary(draft.schedule)}.`, ...researchCostLinesFrom(estimate.current, draft, { codex }), 'Keep the app or server running. Missed times don’t pile up.'], confirmLabel: 'Turn on schedule' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const saved = await api.saveResearchProgram(programPayload(draft, workspace.id, { baseUpdatedAt: force ? '' : base.current }));
      guard.set(guardKey, false);
      onSaved?.(saved?.program || saved);
      onClose?.();
    } catch (failure) {
      if (conflictOf(failure)) setConflict({ at: '', message: friendlyMessage(failure?.message || failure) });
      else setError({ message: friendlyMessage(failure?.message || failure) || 'The program couldn’t be saved. Your changes are still here; try again.', group: '' });
    } finally { setSaving(false); }
  }
  // Save mine anyway: over the newer version this sheet has seen, or, when the refusal came before that version arrived,
  // without a base (the person chose to replace it).
  function saveMine() {
    const newer = program?.updatedAt && program.updatedAt !== base.current;
    if (newer) base.current = program.updatedAt;
    setConflict(null); save(null, { force: !newer });
  }

  const recurring = draft.schedule.frequency !== 'manual';
  const meta = [scheduleSummary(draft.schedule), recurring ? (program?.schedule?.enabled && program.schedule.nextRunAt ? `Next run ${scheduledDate(program.schedule.nextRunAt, program.schedule.timeZone)}` : draft.schedule.enabled ? 'Starts at its next run time' : 'Paused') : 'On demand'].join(' · ');
  const canRunNow = Boolean(program?.id) && typeof onStartResearch === 'function' && can('startResearchRun');
  const host = anchor?.current?.closest?.('.studio-frame') || (typeof document !== 'undefined' ? document.body : null);
  const status = conflict ? '' : error?.message ? '' : dirty ? 'Unsaved changes' : note || 'No changes';

  const sheet = <div className="pd-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <aside ref={sheetRef} className="pd-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="pd-head">
        <div className="pd-head-copy"><span className="pd-eyebrow">Research program</span><h2 id={titleId}>{draft.name || program?.name || 'New program'}</h2><p>{meta}</p></div>
        <div className="pd-head-actions">
          {canRunNow && <button type="button" className="studio-quiet small" title={dirty ? 'Save your changes first' : undefined} {...writeProps(viewer, busy || dirty || saving)} onClick={() => { guard.set(guardKey, false); onClose?.(); onStartResearch(program); }}><Radar size={14} aria-hidden="true" />Run now</button>}
          <DialogClose onClose={requestClose} disabled={saving} />
        </div>
      </header>
      <nav className="pd-jump" aria-label="Program settings">
        {PROGRAM_GROUPS.map(([id, label]) => <button key={id} type="button" className="pd-chip" aria-current={spy.active === id ? 'true' : undefined} onClick={(event) => jump(id, event.detail === 0)}>{label}{error?.group === id && <span className="pd-chip-dot" aria-label=", has a problem" />}</button>)}
      </nav>
      <div className="pd-body" ref={bodyRef}>
        <form id="pd-form" noValidate onSubmit={save}>
          <fieldset disabled={saving || preview}>
            <ProgramEditorFields grouped idPrefix="pd" draft={draft} setDraft={setDraft} capabilities={state.contentStudio?.capabilities || {}} api={api} canEstimate={can('estimateResearchProgram')} onEdit={() => setError(null)} onEstimate={(result) => { estimate.current = result; }} nameRef={nameRef} errorGroup={error?.group || ''} />
          </fieldset>
        </form>
      </div>
      <footer className="pd-foot">
        <div className="pd-foot-status">
          {conflict ? <div className="pd-conflict" role="alert"><TriangleAlert size={15} aria-hidden="true" /><div><p>{conflict.at ? `Someone saved this program at ${formatTime(conflict.at)}. Saving now would replace their changes.` : conflict.message || 'Someone saved this program after you opened it. Saving now would replace their changes.'}</p>
            <div className="pd-conflict-actions"><button type="button" className="studio-quiet small" onClick={() => reset(program)}>Use their version</button><button type="button" className="studio-quiet small" {...writeProps(viewer, saving)} onClick={saveMine}>Save mine anyway</button></div></div></div>
            : error?.message ? <p className="pd-error" role="alert">{error.message}</p>
              : <p className="pd-status" role="status">{status}</p>}
        </div>
        <div className="pd-foot-actions">
          {onOpenFullPage && program?.id && <button type="button" className="studio-quiet small pd-ghost" onClick={async () => { if (dirty && !(await confirm({ title: `Discard changes to “${draft.name || program.name}”?`, lines: ['Your edits to this program aren’t saved.'], confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return; guard.set(guardKey, false); onOpenFullPage(program.id); }}>Open full page</button>}
          <button type="button" className="studio-quiet small pd-ghost" disabled={!dirty || saving} onClick={() => { reset(program); setNote(''); }}>Discard</button>
          <button type="submit" form="pd-form" className="studio-primary small" {...writeProps(viewer, saving || !dirty)}>{saving ? 'Saving…' : <><Check size={14} aria-hidden="true" />Save program</>}</button>
        </div>
      </footer>
    </aside>
  </div>;
  return host ? createPortal(sheet, host) : sheet;
}
