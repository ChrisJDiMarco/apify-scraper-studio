import React, { useRef, useState } from 'react';
import { SaveBar } from './studio-kit.jsx';
import { ArrowRight, BriefcaseBusiness, Check, Plus, Trash2, X } from 'lucide-react';
import './brand-context.css';

const EMPTY = { name: '', offering: '', audience: '', positioning: '', competitors: [], icp: '', brandVoice: '', forbiddenClaims: '' };
// A research profile is one product or service of the brand. The brand itself (its name, audience, positioning, voice
// and claims to avoid) is in the Brand tab, and the data tools get it with every profile (research-workspace.js), so a
// profile only holds what's specific to the product. Blank fields fall back to the brand's.
const FIELDS = [
  { key: 'offering', label: 'What does it do?', limit: 3000, placeholder: 'What the product or service does, the problem it solves, and the proof you can support.', hint: 'Keep this factual. The AI treats it as your stated position.' },
  { key: 'audience', label: 'Who is it for?', limit: 800, placeholder: 'Buyer roles, industries and company sizes this product serves.', hint: 'Leave blank to use the brand’s audience.' },
  { key: 'positioning', label: 'How should people understand it?', limit: 3000, placeholder: 'Its category, distinctive promise, alternatives and reasons to believe.', hint: 'Leave blank to use the brand’s positioning.' },
  { key: 'icp', label: 'Ideal customer profile (ICP)', limit: 3000, placeholder: 'Fit criteria and disqualifiers: industry, size, geography, needs, or required capabilities.', hint: 'Required for the ABM account playbook. Leave blank to use the brand’s ICP.' },
];
const lines = (value) => (Array.isArray(value) ? value : String(value || '').split('\n')).map((entry) => (typeof entry === 'string' ? entry : entry?.name || '')).map((entry) => entry.trim()).filter(Boolean);
function copyProfile(profile) {
  return { ...EMPTY, ...profile, competitors: (profile?.competitors || []).map((competitor) => ({ name: competitor.name || '', domain: competitor.domain || '' })) };
}

export function BrandContextView({ state = {}, busy = false, onSaveProfile, onDeleteProfile, onSelectProfile, onNotice }) {
  const profiles = state.brandProfiles || [];
  // The brand's approved products (Brand tab › Approved product registry): a profile can start from one.
  const brand = (state.contentStudio?.workspaces || []).find((row) => row.id === state.contentStudio?.activeWorkspaceId) || null;
  const products = Array.isArray(brand?.products) ? brand.products.filter((product) => String(product?.name || '').trim()) : [];
  function startFrom(productId) {
    const product = products.find((row) => String(row.id) === productId); if (!product) return;
    const offering = [String(product.description || '').trim(), lines(product.capabilities).length ? `Capabilities: ${lines(product.capabilities).join('; ')}.` : '', product.url ? `Website: ${product.url}` : ''].filter(Boolean).join('\n\n').slice(0, 3000);
    setDraft({ ...copyProfile(), name: String(product.name).slice(0, 120), offering }); setFromProduct(productId);
    setError(''); setNotice(''); setConfirmDelete(false);
  }
  const preferredId = state.settings?.selectedBrandProfileId || '';
  const [draft, setDraft] = useState(() => copyProfile(profiles.find((profile) => profile.id === preferredId)));
  const [loaded, setLoaded] = useState(() => JSON.stringify(copyProfile(profiles.find((profile) => profile.id === preferredId))));
  const [fromProduct, setFromProduct] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  const nameInput = useRef(null);
  const disabled = busy || saving;
  const update = (key) => (event) => { setDraft((previous) => ({ ...previous, [key]: event.target.value })); setError(''); setNotice(''); };
  const edit = (profile) => { setDraft(copyProfile(profile)); setLoaded(JSON.stringify(copyProfile(profile))); setFromProduct(''); setError(''); setNotice(''); setConfirmDelete(false); };
  // What the save bar counts: each field that differs from what was opened (the competitor list as one).
  const opened = JSON.parse(loaded);
  const changes = ['name', ...FIELDS.map(({ key }) => key)].filter((key) => (draft[key] || '').trim() !== (opened[key] || '').trim()).length + (JSON.stringify(draft.competitors) !== JSON.stringify(opened.competitors) ? 1 : 0);
  const updateCompetitor = (index, key, value) => { setDraft((previous) => ({ ...previous, competitors: previous.competitors.map((competitor, i) => i === index ? { ...competitor, [key]: value } : competitor) })); setError(''); setNotice(''); };
  async function act(callback) {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try { await callback(); } catch (failure) { setError(failure?.message || 'Could not save your changes. Your draft is still here.'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setError('Name the product or service.'); nameInput.current?.focus(); return; }
    act(async () => {
      const payload = Object.fromEntries(['name', ...FIELDS.map(({ key }) => key)].map((key) => [key, draft[key].trim()]));
      payload.competitors = draft.competitors.map((competitor) => ({ name: competitor.name.trim(), domain: competitor.domain.trim() })).filter((competitor) => competitor.name || competitor.domain);
      if (draft.id) payload.id = draft.id;
      const saved = await onSaveProfile(payload);
      if (!saved) throw new Error('Your profile could not be saved. Your draft is still here; please try again.');
      setDraft(copyProfile(saved)); setLoaded(JSON.stringify(copyProfile(saved))); setFromProduct(''); setConfirmDelete(false);
      const line = 'Profile saved and selected for the data tools. They use it with the brand’s knowledge; existing briefs keep theirs.';
      if (onNotice) onNotice(line); else setNotice(line);
    });
  }
  function remove() {
    act(async () => {
      const result = await onDeleteProfile(draft.id);
      if (!result) throw new Error('The profile could not be deleted. Please try again.');
      setDraft(copyProfile()); setLoaded(JSON.stringify(copyProfile())); setConfirmDelete(false);
      const line = 'Profile deleted. Briefs saved before keep their context.';
      if (onNotice) onNotice(line); else setNotice(line);
    });
  }
  return <section className="brand-context-view" aria-labelledby="brand-context-title">
    <header className="brand-context-heading"><div><h2 id="brand-context-title">Your products and services</h2><p>One profile for each product or service you research with the Workbench’s data tools. The brand itself (its name, audience, positioning, voice and claims to avoid) comes from the Brand tab, so a profile only needs what’s specific to the product.</p></div><button type="button" className="ghost" disabled={disabled} onClick={() => edit()}><Plus size={16} aria-hidden="true" />New product profile</button></header>
    <div className="brand-context-layout">
      <aside className="brand-profile-list" aria-label="Saved product profiles"><div className="brand-profile-list-heading"><span>Profiles</span><small>{profiles.length}</small></div>{profiles.length ? profiles.map((profile) => <button type="button" key={profile.id} disabled={disabled} aria-label={`Edit ${profile.name}`} aria-pressed={draft.id === profile.id} className={draft.id === profile.id ? 'active' : ''} onClick={() => edit(profile)}><span className="brand-profile-monogram" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span><span><strong>{profile.name}</strong><small>{profile.id === preferredId ? 'Used by the data tools' : profile.icp ? 'ICP included' : 'Product profile'}</small></span>{profile.id === preferredId && <Check size={13} aria-hidden="true" />}</button>) : <div className="brand-profiles-empty"><BriefcaseBusiness size={24} aria-hidden="true" /><strong>No product profiles yet.</strong><p>Until you add one, the data tools use the brand’s knowledge on its own. Add a profile for each product or service you research.</p></div>}<div className="brand-profile-snapshot-note"><BriefcaseBusiness size={16} aria-hidden="true" /><p>Each collection keeps a copy of the profile you apply. Editing a profile changes future briefs.</p></div></aside>
      <form id="brand-profile-form" className="brand-context-form" onSubmit={save} noValidate>
        <SaveBar changes={changes} form="brand-profile-form" saving={saving} saveLabel={draft.id ? 'Save profile' : 'Save new profile'} onDiscard={() => { setDraft(JSON.parse(loaded)); setFromProduct(''); setError(''); }} />
        <div className="brand-form-heading"><h3>{draft.id ? draft.name || 'Product profile' : 'Which product or service is this research about?'}</h3><p>A name is all you need to start. The rest makes the recommendations more relevant.</p>{!draft.id && products.length > 0 && <label className="brand-context-field brand-start-from"><span>Start from a product in the Brand tab</span><select value={fromProduct} disabled={disabled} onChange={(event) => startFrom(event.target.value)}><option value="">Choose a product…</option>{products.map((product) => <option key={product.id || product.name} value={String(product.id)}>{product.name}</option>)}</select></label>}</div>
        <fieldset disabled={disabled}><legend className="sr-only">Product profile</legend>
          <div className="brand-context-field"><label htmlFor="brand-profile-name">Product or service name <span>Required</span></label><input id="brand-profile-name" ref={nameInput} value={draft.name} onChange={update('name')} maxLength={120} autoComplete="off" placeholder="e.g. Your flagship product" /></div>
          {FIELDS.slice(0, 3).map(({ key, label, limit, placeholder, hint }) => <div className="brand-context-field" key={key}><label htmlFor={`brand-profile-${key}`}>{label}</label><textarea id={`brand-profile-${key}`} rows={3} value={draft[key]} onChange={update(key)} maxLength={limit} placeholder={placeholder} aria-describedby={hint ? `brand-hint-${key}` : undefined} />{hint && <small id={`brand-hint-${key}`}>{hint}</small>}</div>)}
          <section className="brand-competitors" aria-labelledby="brand-competitors-title"><div><h4 id="brand-competitors-title">Competitors and alternatives</h4><span>{draft.competitors.length} / 20</span></div><p>Names and public domains help tell this product apart from its competitors in your sources.</p>{draft.competitors.map((competitor, index) => <div className="brand-competitor-row" key={index}><div><label className="sr-only" htmlFor={`competitor-name-${index}`}>Competitor {index + 1} name</label><input id={`competitor-name-${index}`} maxLength={120} value={competitor.name} onChange={(event) => updateCompetitor(index, 'name', event.target.value)} placeholder="Company name" /></div><div><label className="sr-only" htmlFor={`competitor-domain-${index}`}>Competitor {index + 1} domain</label><input id={`competitor-domain-${index}`} value={competitor.domain} onChange={(event) => updateCompetitor(index, 'domain', event.target.value)} placeholder="example.com" autoCapitalize="none" spellCheck="false" /></div><button type="button" className="brand-competitor-remove" aria-label={`Remove competitor ${index + 1}`} onClick={() => setDraft((previous) => ({ ...previous, competitors: previous.competitors.filter((_, i) => i !== index) }))}><X size={15} aria-hidden="true" /></button></div>)}<button type="button" className="ghost brand-add-competitor" disabled={draft.competitors.length >= 20} onClick={() => setDraft((previous) => ({ ...previous, competitors: [...previous.competitors, { name: '', domain: '' }] }))}><Plus size={14} aria-hidden="true" />Add competitor</button></section>
          {FIELDS.slice(3).map(({ key, label, limit, placeholder, hint }) => <div className="brand-context-field" key={key}><label htmlFor={`brand-profile-${key}`}>{label}</label><textarea id={`brand-profile-${key}`} rows={3} value={draft[key]} onChange={update(key)} maxLength={limit} placeholder={placeholder} aria-describedby={hint ? `brand-hint-${key}` : undefined} />{hint && <small id={`brand-hint-${key}`}>{hint}</small>}</div>)}
        </fieldset>
        {error && <p className="brand-context-error" role="alert">{error}</p>}{notice && <p className="brand-context-notice" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}
        <footer className="brand-context-footer"><div>{draft.id && <button type="button" className="brand-delete" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" />Delete profile</button>}</div><div>{draft.id && draft.id !== preferredId && onSelectProfile && <button type="button" className="ghost" disabled={disabled} onClick={() => act(async () => { const selected = await onSelectProfile(draft.id); if (!selected) throw new Error('Could not select this profile. Please try again.'); const line = 'Selected. The data tools use this profile with the brand’s knowledge. Apply it when setting up your next brief.'; if (onNotice) onNotice(line); else setNotice(line); })}>Use for the data tools<ArrowRight size={13} aria-hidden="true" /></button>}</div></footer>
        {confirmDelete && <div className="brand-delete-confirm" role="alert"><p>Delete <strong>{draft.name}</strong>? Existing briefs keep their saved context.</p><div><button type="button" className="ghost" disabled={disabled} onClick={() => setConfirmDelete(false)}>Keep profile</button><button type="button" disabled={disabled} onClick={remove}>Confirm delete</button></div></div>}
      </form>
    </div>
  </section>;
}
