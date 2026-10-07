import React, { useRef, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, Plus, Save, Trash2, X } from 'lucide-react';
import './brand-context.css';

const EMPTY = { name: '', offering: '', audience: '', positioning: '', competitors: [], icp: '', brandVoice: '', forbiddenClaims: '' };
const FIELDS = [
  { key: 'offering', label: 'What do you offer?', limit: 3000, placeholder: 'Your product or service, the problem it solves, and the proof you can support.', hint: 'Keep this factual. The AI treats saved context as your stated position.' },
  { key: 'audience', label: 'Who do you want to reach?', limit: 800, placeholder: 'Buyer roles, industries, company sizes, and the people influencing the decision.' },
  { key: 'positioning', label: 'How should people understand your brand?', limit: 3000, placeholder: 'Your category, distinctive promise, alternatives, and reasons to believe.' },
  { key: 'icp', label: 'Ideal customer profile (ICP)', limit: 3000, placeholder: 'Fit criteria and disqualifiers: industry, size, geography, needs, or required capabilities.', hint: 'Required for the ABM account playbook. Unsupported criteria remain unknown.' },
  { key: 'brandVoice', label: 'Brand voice', limit: 2000, placeholder: 'For example: direct, warm, specific. Use plain language and avoid hype.' },
  { key: 'forbiddenClaims', label: 'Claims to avoid', limit: 3000, placeholder: 'For example: no guaranteed revenue lift, unsupported rankings, or compliance promises.', hint: 'The AI receives these constraints. Review the draft before sharing.' },
];
function copyProfile(profile) {
  return { ...EMPTY, ...profile, competitors: (profile?.competitors || []).map((competitor) => ({ name: competitor.name || '', domain: competitor.domain || '' })) };
}

export function BrandContextView({ state = {}, busy = false, onSaveProfile, onDeleteProfile, onSelectProfile }) {
  const profiles = state.brandProfiles || [];
  const preferredId = state.settings?.selectedBrandProfileId || '';
  const [draft, setDraft] = useState(() => copyProfile(profiles.find((profile) => profile.id === preferredId)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  const nameInput = useRef(null);
  const disabled = busy || saving;
  const update = (key) => (event) => { setDraft((previous) => ({ ...previous, [key]: event.target.value })); setError(''); setNotice(''); };
  const edit = (profile) => { setDraft(copyProfile(profile)); setError(''); setNotice(''); setConfirmDelete(false); };
  const updateCompetitor = (index, key, value) => { setDraft((previous) => ({ ...previous, competitors: previous.competitors.map((competitor, i) => i === index ? { ...competitor, [key]: value } : competitor) })); setError(''); setNotice(''); };
  async function act(callback) {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try { await callback(); } catch (failure) { setError(failure?.message || 'Could not save your changes. Your draft is still here.'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setError('Add a brand or company name.'); nameInput.current?.focus(); return; }
    act(async () => {
      const payload = Object.fromEntries(['name', ...FIELDS.map(({ key }) => key)].map((key) => [key, draft[key].trim()]));
      payload.competitors = draft.competitors.map((competitor) => ({ name: competitor.name.trim(), domain: competitor.domain.trim() })).filter((competitor) => competitor.name || competitor.domain);
      if (draft.id) payload.id = draft.id;
      const saved = await onSaveProfile(payload);
      if (!saved) throw new Error('Your profile could not be saved. Your draft is still here; please try again.');
      setDraft(copyProfile(saved)); setConfirmDelete(false); setNotice('Brand profile saved and selected as your workspace context. Existing briefs keep their saved context.');
    });
  }
  function remove() {
    act(async () => {
      const result = await onDeleteProfile(draft.id);
      if (!result) throw new Error('The profile could not be deleted. Please try again.');
      setDraft(copyProfile()); setConfirmDelete(false); setNotice('Profile deleted. Previously saved briefs keep their context.');
    });
  }
  return <section className="brand-context-view" aria-labelledby="brand-context-title">
    <header className="brand-context-heading"><div><span className="brand-context-eyebrow">A SHARED STARTING POINT FOR YOUR RESEARCH</span><h2 id="brand-context-title">Your brand, understood.</h2><p>Save the context your team would put in every research brief.</p></div><button type="button" className="ghost" disabled={disabled} onClick={() => edit()}><Plus size={16} aria-hidden="true" />New profile</button></header>
    <div className="brand-context-layout">
      <aside className="brand-profile-list" aria-label="Saved brand profiles"><div className="brand-profile-list-heading"><span>YOUR PROFILES</span><small>{profiles.length}</small></div>{profiles.length ? profiles.map((profile) => <button type="button" key={profile.id} disabled={disabled} aria-label={`Edit ${profile.name}`} aria-pressed={draft.id === profile.id} className={draft.id === profile.id ? 'active' : ''} onClick={() => edit(profile)}><span className="brand-profile-monogram" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span><span><strong>{profile.name}</strong><small>{profile.id === preferredId ? 'Workspace context' : profile.icp ? 'ICP included' : 'Saved brand profile'}</small></span>{profile.id === preferredId && <Check size={13} aria-hidden="true" />}</button>) : <div className="brand-profiles-empty"><BriefcaseBusiness size={24} aria-hidden="true" /><strong>Make your first profile.</strong><p>Start with a name. Add details as your research takes shape.</p></div>}<div className="brand-profile-snapshot-note"><BriefcaseBusiness size={16} aria-hidden="true" /><p>Each collection keeps a copy of the profile you apply. Editing a profile changes future briefs.</p></div></aside>
      <form className="brand-context-form" onSubmit={save} noValidate>
        <div className="brand-form-heading"><span>{draft.id ? 'EDIT PROFILE' : 'NEW PROFILE'}</span><h3>{draft.id ? draft.name || 'Your brand profile' : 'Give your research the right context.'}</h3><p>A name is all you need to start. The rest makes the recommendations more relevant.</p></div>
        <fieldset disabled={disabled}><legend className="sr-only">Brand profile</legend>
          <div className="brand-context-field"><label htmlFor="brand-profile-name">Brand or company name <span>Required</span></label><input id="brand-profile-name" ref={nameInput} value={draft.name} onChange={update('name')} maxLength={120} autoComplete="organization" placeholder="Acme" /></div>
          {FIELDS.slice(0, 3).map(({ key, label, limit, placeholder, hint }) => <div className="brand-context-field" key={key}><label htmlFor={`brand-profile-${key}`}>{label}</label><textarea id={`brand-profile-${key}`} rows={3} value={draft[key]} onChange={update(key)} maxLength={limit} placeholder={placeholder} aria-describedby={hint ? `brand-hint-${key}` : undefined} />{hint && <small id={`brand-hint-${key}`}>{hint}</small>}</div>)}
          <section className="brand-competitors" aria-labelledby="brand-competitors-title"><div><h4 id="brand-competitors-title">Competitors and alternatives</h4><span>{draft.competitors.length} / 20</span></div><p>Names and public domains help distinguish the brands in your sources.</p>{draft.competitors.map((competitor, index) => <div className="brand-competitor-row" key={index}><div><label className="sr-only" htmlFor={`competitor-name-${index}`}>Competitor {index + 1} name</label><input id={`competitor-name-${index}`} maxLength={120} value={competitor.name} onChange={(event) => updateCompetitor(index, 'name', event.target.value)} placeholder="Company name" /></div><div><label className="sr-only" htmlFor={`competitor-domain-${index}`}>Competitor {index + 1} domain</label><input id={`competitor-domain-${index}`} value={competitor.domain} onChange={(event) => updateCompetitor(index, 'domain', event.target.value)} placeholder="example.com" autoCapitalize="none" spellCheck="false" /></div><button type="button" className="brand-competitor-remove" aria-label={`Remove competitor ${index + 1}`} onClick={() => setDraft((previous) => ({ ...previous, competitors: previous.competitors.filter((_, i) => i !== index) }))}><X size={15} aria-hidden="true" /></button></div>)}<button type="button" className="ghost brand-add-competitor" disabled={draft.competitors.length >= 20} onClick={() => setDraft((previous) => ({ ...previous, competitors: [...previous.competitors, { name: '', domain: '' }] }))}><Plus size={14} aria-hidden="true" />Add competitor</button></section>
          {FIELDS.slice(3).map(({ key, label, limit, placeholder, hint }) => <div className="brand-context-field" key={key}><label htmlFor={`brand-profile-${key}`}>{label}</label><textarea id={`brand-profile-${key}`} rows={3} value={draft[key]} onChange={update(key)} maxLength={limit} placeholder={placeholder} aria-describedby={hint ? `brand-hint-${key}` : undefined} />{hint && <small id={`brand-hint-${key}`}>{hint}</small>}</div>)}
        </fieldset>
        {error && <p className="brand-context-error" role="alert">{error}</p>}{notice && <p className="brand-context-notice" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}
        <footer className="brand-context-footer"><div>{draft.id && <button type="button" className="brand-delete" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" />Delete profile</button>}</div><div>{draft.id && draft.id !== preferredId && onSelectProfile && <button type="button" className="ghost" disabled={disabled} onClick={() => act(async () => { const selected = await onSelectProfile(draft.id); if (!selected) throw new Error('Could not select this workspace context. Please try again.'); setNotice('Workspace context selected. Apply it when setting up your next brief.'); })}>Use as workspace context<ArrowRight size={13} aria-hidden="true" /></button>}<button type="submit" disabled={disabled}><Save size={15} aria-hidden="true" />{saving ? 'Saving…' : 'Save profile'}</button></div></footer>
        {confirmDelete && <div className="brand-delete-confirm" role="alert"><p>Delete <strong>{draft.name}</strong>? Existing briefs keep their saved context.</p><div><button type="button" className="ghost" disabled={disabled} onClick={() => setConfirmDelete(false)}>Keep profile</button><button type="button" disabled={disabled} onClick={remove}>Confirm delete</button></div></div>}
      </form>
    </div>
  </section>;
}
