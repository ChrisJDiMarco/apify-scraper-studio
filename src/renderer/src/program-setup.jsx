import React, { useId, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogClose } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { emptyProgram, programPayload } from './program-editor.jsx';
import { ProgramPeople } from './programs-page.jsx';
import { useViewer, writeProps } from './viewer.js';
import './program-setup.css';

// Guided setup: a research program from what the person knows (their company, its website, its vertical, what to follow)
// in five steps. Ask AI suggests the X accounts, LinkedIn people and pages, and subreddits to follow, and drafts the brand
// (one paid call, after its estimate; every suggestion is checked with the program form's own rules on the server). The
// program can write for the workspace's brand or its own (a program for another brand, D3). Nothing is saved until Save;
// then People who see it and Run now (which shows its own estimate first) are a click away.
// `firstRun`: the studio's first setup, which also saves the brand as the workspace's brand knowledge when it has none.
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '');
const STEPS = [['about', 'About'], ['sources', 'Sources'], ['brand', 'Brand'], ['schedule', 'Schedule'], ['review', 'Review']];
const PLATFORMS = [['x', 'X accounts', 'x', 'Handles, one per line'], ['linkedin', 'LinkedIn people and pages', 'linkedin-profile', 'Profile or company URLs, one per line'], ['reddit', 'Subreddits', 'reddit', 'Names, one per line']];
const BRAND_FIELDS = [['name', 'Brand name', 160], ['audience', 'Who it serves', 4000], ['positioning', 'How it positions itself', 6000], ['voice', 'Voice', 4000], ['forbiddenClaims', 'Claims to avoid', 6000]];
const lines = (value) => [...new Set(String(value || '').split(/[\n,]+/).map((row) => row.trim()).filter(Boolean))];

export function ProgramSetup({ api, workspace, firstRun = false, onClose, onSaved, onNotice, onStartResearch }) {
  const viewer = useViewer();
  const confirm = useConfirm();
  const titleId = useId();
  const knowledge = workspace?.knowledge || {};
  const [step, setStep] = useState(0);
  const [about, setAbout] = useState({ company: firstRun ? '' : knowledge.name || '', website: '', vertical: '', focus: '', name: '' });
  // The workspace's brand, unless the program is for another one (or this is the studio's first setup without one).
  const [brandMode, setBrandMode] = useState('workspace');
  const [brand, setBrand] = useState({ name: knowledge.name || '', audience: knowledge.audience || '', positioning: knowledge.positioning || '', voice: knowledge.voice || '', forbiddenClaims: knowledge.forbiddenClaims || '' });
  const [suggested, setSuggested] = useState(null); // { sources: { x, linkedin, reddit }, notes, dropped }
  const [picked, setPicked] = useState(new Set()); // `${platform}:${target}`
  const [own, setOwn] = useState({ x: '', linkedin: '', reddit: '' });
  const [schedule, setSchedule] = useState({ frequency: 'manual', collectionUsd: 20, aiUsd: 40 });
  const [working, setWorking] = useState('');
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState(null);
  const [people, setPeople] = useState(false);
  const workspaceBrandEmpty = !String(knowledge.name || '').trim();
  const name = about.name.trim() || [about.company.trim(), about.focus.trim()].filter(Boolean).join(' · ').slice(0, 120);
  const set = (setter) => (key) => (event) => setter((current) => ({ ...current, [key]: event.target.value }));

  async function suggest() {
    setProblem('');
    if (!about.company.trim() || !about.vertical.trim()) { setStep(0); setProblem('Add the company and its vertical first.'); return; }
    const request = { company: about.company, website: about.website, vertical: about.vertical, focus: about.focus, wantBrand: brandMode === 'own' || (firstRun && workspaceBrandEmpty), wantSources: true };
    let estimate = null; try { estimate = await api.estimateProgramSetup(request); } catch (failure) { setProblem(failure?.message || 'The estimate couldn’t be made.'); return; }
    if (estimate?.problem) { setProblem(estimate.problem); return; }
    const ok = await confirm({ title: 'Ask AI for suggestions?', lines: [estimate?.metered === false ? `Runs on ${estimate.routeLabel}, which doesn’t report what it spends.` : `About ${money(estimate?.estimateUsd) || 'a few cents'} on ${estimate?.modelLabel || 'the studio’s model'} (${estimate?.routeLabel || 'Settings › Model routing'}).`, 'It suggests sources to follow and drafts the brand. Nothing is saved until you save the program.'], confirmLabel: 'Suggest' });
    if (!ok) return;
    setWorking('suggest');
    try {
      const result = await api.suggestProgramSetup(request);
      setSuggested(result);
      setPicked(new Set(PLATFORMS.flatMap(([platform]) => list(result?.sources?.[platform]).map((row) => `${platform}:${row.target}`))));
      if (request.wantBrand && result?.brand) setBrand((current) => ({ ...current, name: current.name || about.company, ...Object.fromEntries(Object.entries(result.brand).filter(([, text]) => text)) }));
    } catch (failure) { setProblem(failure?.message || 'Ask AI couldn’t make suggestions. Add sources yourself, or try again.'); }
    finally { setWorking(''); }
  }

  function program() {
    const draft = emptyProgram(workspace?.id);
    const targets = Object.fromEntries(PLATFORMS.map(([platform]) => [platform, [...list(suggested?.sources?.[platform]).filter((row) => picked.has(`${platform}:${row.target}`)).map((row) => row.target), ...lines(own[platform])]]));
    draft.name = name; draft.query = about.focus.trim();
    draft.sourceGroups = draft.sourceGroups.map((group) => { const platform = PLATFORMS.find(([, , sourceId]) => sourceId === group.sourceId)?.[0]; const rows = platform ? [...new Set(targets[platform])] : []; return platform ? { ...group, targets: rows, enabled: rows.length > 0 } : group; });
    draft.schedule = { ...draft.schedule, frequency: schedule.frequency, enabled: schedule.frequency !== 'manual' };
    draft.budgets = { ...draft.budgets, collectionUsd: Number(schedule.collectionUsd) || 0, aiUsd: Number(schedule.aiUsd) || 0 };
    if (brandMode === 'own') draft.brand = { mode: 'own', ...Object.fromEntries(BRAND_FIELDS.map(([key]) => [key, String(brand[key] || '').trim()])) };
    return programPayload(draft, workspace?.id);
  }
  const sourceCount = (() => { const value = program(); return list(value.sourceGroups).filter((group) => group.enabled).reduce((sum, group) => sum + list(group.targets).length, 0); })();

  async function save() {
    setProblem('');
    if (!name) { setStep(0); setProblem('Name the program, or add the company and what to follow.'); return; }
    if (!sourceCount) { setStep(1); setProblem('Choose or add at least one source to follow.'); return; }
    if (brandMode === 'own' && !String(brand.name || '').trim()) { setStep(2); setProblem('Name the brand this program is for.'); return; }
    setWorking('save');
    try {
      // The studio's first setup with no brand knowledge yet: the brand becomes the workspace's (its products and other
      // fields kept as they are).
      if (firstRun && brandMode === 'workspace' && workspaceBrandEmpty && typeof api.saveContentWorkspace === 'function' && workspace?.id) {
        await api.saveContentWorkspace({ id: workspace.id, name: workspace.name, editionId: workspace.editionId, knowledge: { ...knowledge, name: brand.name.trim() || about.company.trim(), audience: brand.audience, positioning: brand.positioning, voice: brand.voice, forbiddenClaims: brand.forbiddenClaims }, products: list(workspace.products), ...(workspace.enterpriseProducts ? { enterpriseProducts: workspace.enterpriseProducts } : {}), ...(workspace.updatedAt ? { baseUpdatedAt: workspace.updatedAt } : {}) });
      }
      const result = await api.saveResearchProgram(program());
      const done = result?.program || result;
      setSaved(done); onSaved?.(done);
    } catch (failure) { setProblem(failure?.message || 'The program couldn’t be saved. Try again.'); }
    finally { setWorking(''); }
  }

  const head = <header className="studio-dialog-head"><div><small>{firstRun ? 'Set up Golden Thread' : 'New research program'}</small><h2 id={titleId}>{saved ? `“${saved.name}” is saved` : STEPS[step][1]}</h2></div><DialogClose onClose={onClose} disabled={Boolean(working)} /></header>;
  if (saved) return <Dialog labelledBy={titleId} onClose={onClose} className="program-setup" wide>
    {head}
    <div className="studio-dialog-body program-setup-done">
      <p><Check size={16} aria-hidden="true" /> {sourceCount} sources, {schedule.frequency === 'manual' ? 'run when you start it' : `runs ${schedule.frequency}`}{brandMode === 'own' ? `, written for ${brand.name}` : ''}.</p>
      <div className="program-setup-actions">
        {typeof api.getTeam === 'function' && typeof api.saveMember === 'function' && <button type="button" className="simple-quiet" onClick={() => setPeople(true)}>Choose who sees it</button>}
        {onStartResearch && <button type="button" className="simple-primary" {...writeProps(viewer, false)} onClick={() => { onClose(); onStartResearch(saved); }}>Run now<ArrowRight size={15} aria-hidden="true" /></button>}
        <button type="button" className="simple-quiet" onClick={onClose}>Done</button>
      </div>
    </div>
    {people && <ProgramPeople program={saved} programs={[saved]} api={api} onNotice={onNotice} onClose={() => setPeople(false)} />}
  </Dialog>;

  return <Dialog labelledBy={titleId} onClose={onClose} closeDisabled={Boolean(working)} className="program-setup" wide>
    {head}
    <ol className="program-setup-steps" aria-label="Steps">{STEPS.map(([id, label], index) => <li key={id} className={index === step ? 'is-current' : index < step ? 'is-done' : ''} aria-current={index === step ? 'step' : undefined}><button type="button" disabled={Boolean(working)} onClick={() => setStep(index)}>{index + 1}. {label}</button></li>)}</ol>
    <div className="studio-dialog-body">
      {STEPS[step][0] === 'about' && <>
        <p className="studio-hint">Tell Golden Thread who it’s researching for. Ask AI uses this to suggest who to follow.</p>
        <label className="studio-field"><span>Company</span><input value={about.company} maxLength={120} onChange={set(setAbout)('company')} placeholder="Acme" /></label>
        <label className="studio-field"><span>Website <em>(optional)</em></span><input value={about.website} maxLength={300} onChange={set(setAbout)('website')} placeholder="https://www.example.com" /></label>
        <label className="studio-field"><span>Vertical or industry</span><input value={about.vertical} maxLength={200} onChange={set(setAbout)('vertical')} placeholder="B2B marketing analytics" /></label>
        <label className="studio-field"><span>What should research follow?</span><textarea rows={3} value={about.focus} maxLength={600} onChange={set(setAbout)('focus')} placeholder="What marketers say about measuring their brand in AI search answers" /></label>
        <label className="studio-field"><span>Program name <em>(optional)</em></span><input value={about.name} maxLength={120} onChange={set(setAbout)('name')} placeholder={name || 'Company · focus'} /></label>
        <fieldset className="program-setup-choice"><legend>Whose brand do its reports and assets speak for?</legend>
          <label><input type="radio" name={`${titleId}-brand`} checked={brandMode === 'workspace'} onChange={() => setBrandMode('workspace')} /><span><strong>{workspaceBrandEmpty ? 'This studio’s brand' : knowledge.name}</strong><small>{workspaceBrandEmpty ? (firstRun ? 'Saved as the studio’s brand knowledge.' : 'The studio has no brand knowledge yet.') : 'Its brand knowledge, products and channels.'}</small></span></label>
          <label><input type="radio" name={`${titleId}-brand`} checked={brandMode === 'own'} onChange={() => setBrandMode('own')} /><span><strong>Another brand</strong><small>This program writes for its own brand, without the studio’s products or taxonomy.</small></span></label>
        </fieldset>
      </>}
      {STEPS[step][0] === 'sources' && <>
        <div className="program-setup-suggest"><p>Ask AI can suggest X accounts, LinkedIn people and pages, and subreddits for {about.company || 'this company'}. Each is checked before it’s shown; keep the ones you want.</p>
          <button type="button" className="simple-primary" {...writeProps(viewer, Boolean(working))} onClick={suggest}>{working === 'suggest' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}{suggested ? 'Suggest again' : 'Suggest sources'}</button></div>
        {suggested?.notes && <p className="studio-hint">{suggested.notes}</p>}
        {suggested?.dropped > 0 && <p className="studio-hint">{suggested.dropped} suggestion{suggested.dropped === 1 ? ' wasn’t' : 's weren’t'} a valid account, page or subreddit, so {suggested.dropped === 1 ? 'it was' : 'they were'} left out.</p>}
        {PLATFORMS.map(([platform, label, , hint]) => <fieldset key={platform} className="program-setup-platform"><legend>{label}</legend>
          {list(suggested?.sources?.[platform]).length > 0 && <ul>{suggested.sources[platform].map((row) => { const key = `${platform}:${row.target}`; return <li key={key}><label><input type="checkbox" checked={picked.has(key)} onChange={(event) => setPicked((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} /><span><strong>{row.name}</strong> <code>{row.target}</code><small>{row.why}</small></span></label></li>; })}</ul>}
          <label className="studio-field"><span>Add your own</span><textarea rows={2} value={own[platform]} onChange={set(setOwn)(platform)} placeholder={hint} /></label>
        </fieldset>)}
      </>}
      {STEPS[step][0] === 'brand' && <>
        {brandMode === 'workspace' && !(firstRun && workspaceBrandEmpty) ? <p className="studio-hint">This program uses {knowledge.name || 'the studio’s'} brand knowledge. Change it in Studio › Brand knowledge, or go back and choose Another brand.</p>
          : <><p className="studio-hint">{brandMode === 'own' ? 'The brand this program’s reports and assets speak for.' : 'The studio’s brand knowledge, so reports and assets come out on brand.'} Ask AI’s draft (from Sources) fills these in; check every line.</p>
            {BRAND_FIELDS.map(([key, label, max]) => <label key={key} className="studio-field"><span>{label}</span>{key === 'name' ? <input value={brand[key]} maxLength={max} onChange={set(setBrand)(key)} /> : <textarea rows={3} value={brand[key]} maxLength={max} onChange={set(setBrand)(key)} />}</label>)}</>}
      </>}
      {STEPS[step][0] === 'schedule' && <>
        <label className="studio-field"><span>When it runs</span><select value={schedule.frequency} onChange={set(setSchedule)('frequency')}><option value="manual">When I start it</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></label>
        <div className="program-setup-row">
          <label className="studio-field"><span>Collection cap per run (USD)</span><input type="number" min={1} max={1000} value={schedule.collectionUsd} onChange={set(setSchedule)('collectionUsd')} /></label>
          <label className="studio-field"><span>AI cap per run (USD)</span><input type="number" min={1} max={1000} value={schedule.aiUsd} onChange={set(setSchedule)('aiUsd')} /></label>
        </div>
        <p className="studio-hint">A run never spends past these caps, and Run now shows its estimate first. Change anything later in Workbench › Edit research program.</p>
      </>}
      {STEPS[step][0] === 'review' && <dl className="program-setup-review">
        <dt>Program</dt><dd>{name || '—'}</dd>
        <dt>Follows</dt><dd>{sourceCount ? PLATFORMS.map(([platform, label, sourceId]) => { const group = program().sourceGroups.find((row) => row.sourceId === sourceId); return list(group?.targets).length ? `${list(group.targets).length} ${label}` : ''; }).filter(Boolean).join(' · ') : 'No sources yet'}</dd>
        <dt>Brand</dt><dd>{brandMode === 'own' ? brand.name || '—' : knowledge.name || brand.name || 'The studio’s'}</dd>
        <dt>Runs</dt><dd>{schedule.frequency === 'manual' ? 'When you start it' : `Every ${schedule.frequency === 'daily' ? 'day' : 'week'}`} · up to {money(schedule.collectionUsd)} collection + {money(schedule.aiUsd)} AI</dd>
      </dl>}
      {problem && <p className="studio-error" role="alert">{problem}</p>}
    </div>
    <footer className="program-setup-foot">
      <button type="button" className="simple-quiet" disabled={step === 0 || Boolean(working)} onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={15} aria-hidden="true" />Back</button>
      {step < STEPS.length - 1 ? <button type="button" className="simple-primary" disabled={Boolean(working)} onClick={() => setStep((value) => value + 1)}>Next<ArrowRight size={15} aria-hidden="true" /></button>
        : <button type="button" className="simple-primary" {...writeProps(viewer, Boolean(working))} onClick={save}>{working === 'save' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}Save program</button>}
    </footer>
  </Dialog>;
}
