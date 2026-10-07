import React, { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, Globe2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { MARKETING_TEMPLATES, buildMarketingRecipe, snapshotBrandProfile } from '../../shared/marketing-templates.js';
import './marketing-template.css';

function MarketingTemplateForm({ template, onSave, onCancel, onOpenScrapers, busy, brandProfiles, selectedBrandProfileId, onSelectBrandProfile, onManageProfiles }) {
  const [values, setValues] = useState({ brand: '', decision: '', audience: '', sourceUrls: '', maxTotalChargeUsd: '2' });
  const [profileChoice, setProfileChoice] = useState('');
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveInProgress = useRef(false);
  const form = useRef(null);
  const disabled = Boolean(busy || saving);
  const update = (field) => (event) => {
    setValues((previous) => ({ ...previous, [field]: event.target.value }));
    if (error?.field === field) setError(null);
  };
  const invalid = (field) => error?.field === field;
  const fieldProps = (field) => ({ id: `marketing-${field}`, name: field, value: values[field], onChange: update(field), 'aria-invalid': invalid(field) || undefined, 'aria-describedby': `${field}-hint${invalid(field) ? ' marketing-form-error' : ''}` });
  const uniqueCount = new Set(values.sourceUrls.split(/\r?\n/).map((url) => {
    try { const parsed = new URL(url.trim()); parsed.hash = ''; return parsed.href; } catch { return url.trim(); }
  }).filter(Boolean)).size;

  async function chooseProfile(event) {
    const id = event.target.value;
    const snapshot = snapshotBrandProfile(brandProfiles.find((profile) => profile.id === id));
    setProfileChoice(id);
    setProfileSnapshot(snapshot);
    setError(null);
    if (snapshot) setValues((previous) => ({ ...previous, brand: snapshot.name, audience: snapshot.audience }));
    try { await onSelectBrandProfile?.(id); } catch (selectionError) { setError(new Error(selectionError?.message || 'Could not save your preferred brand profile.')); }
  }

  async function save(event) {
    event.preventDefault();
    if (disabled || saveInProgress.current) return;
    setError(null);
    let recipe;
    try { recipe = buildMarketingRecipe(template.id, { ...values, brandProfile: profileSnapshot }); }
    catch (validationError) {
      setError(validationError);
      form.current?.elements.namedItem(validationError.field)?.focus();
      return;
    }
    saveInProgress.current = true;
    setSaving(true);
    try {
      const result = await onSave(recipe);
      if (!result) throw new Error('Your collection could not be saved. Your inputs are still here; please try again.');
      setSaved(true);
    } catch (saveError) {
      setError(new Error(saveError?.message || 'Your collection could not be saved. Please try again.'));
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  if (saved) return <section className="marketing-template-view marketing-template-saved" aria-labelledby="marketing-saved-title">
    <span className="marketing-saved-icon"><Check size={25} aria-hidden="true" /></span>
    <span className="marketing-eyebrow">COLLECTION SAVED</span>
    <h2 id="marketing-saved-title">Your research is ready to start.</h2>
    <p><strong>{values.brand.trim()}</strong> now has a saved {template.name.toLowerCase()} collection. Run your saved collection, then open AI reports. Your matching report format, brand, and research decision will be filled in.</p>
    <div className="marketing-saved-next"><Globe2 size={17} aria-hidden="true" /><span>Collect pages</span><ArrowRight size={14} aria-hidden="true" /><FileText size={17} aria-hidden="true" /><span>Create report</span></div>
    <p className="marketing-save-note">Saving did not start a paid run or generate a report.</p>
    <button type="button" onClick={onOpenScrapers || onCancel}>{onOpenScrapers ? 'Open saved scrapers' : 'Back to templates'}<ArrowRight size={15} aria-hidden="true" /></button>
  </section>;

  return <section className="marketing-template-view" aria-labelledby="marketing-template-title">
    <button className="marketing-back" type="button" onClick={onCancel} disabled={disabled}><ArrowLeft size={15} aria-hidden="true" />All templates</button>
    <header className="marketing-template-heading"><span className="marketing-eyebrow">{template.audience.toUpperCase()}</span><h2 id="marketing-template-title">{template.name}</h2><p>{template.description}</p></header>
    <div className="marketing-template-layout">
      <form className="marketing-template-form" ref={form} onSubmit={save} noValidate>
        <fieldset disabled={disabled}>
          <legend className="sr-only">Research setup</legend>
          <div className="marketing-profile-picker"><div className="marketing-source-label"><label htmlFor="marketing-brand-profile">Saved brand context{template.requiresIcp ? ' · required for ICP' : ' · optional'}</label>{onManageProfiles && <button type="button" className="marketing-profile-manage" onClick={onManageProfiles}>Manage profiles</button>}</div><select id="marketing-brand-profile" name="brandProfile" value={profileChoice} onChange={chooseProfile} aria-describedby="marketing-profile-hint" aria-invalid={error?.field === 'brandProfile' || undefined}><option value="">Choose a profile to apply</option>{brandProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === selectedBrandProfileId ? ' · workspace default' : ''}</option>)}</select><small id="marketing-profile-hint">Choosing a profile fills the brand and audience. Your decision and URLs stay as written. A copy of its context is saved with this collection.</small>{profileSnapshot && <div className="marketing-profile-summary"><strong>{profileSnapshot.name}</strong><p>{profileSnapshot.offering || 'No offering saved.'}</p>{template.requiresIcp && <p><b>ICP:</b> {profileSnapshot.icp || 'Add an ideal customer profile before using this playbook.'}</p>}</div>}{template.requiresIcp && !brandProfiles.length && <p className="marketing-profile-required">Add a brand profile with your ideal customer criteria, then choose it here.</p>}</div>
          <div className="marketing-field"><label htmlFor="marketing-brand">Project or brand</label><input {...fieldProps('brand')} maxLength={120} placeholder="e.g. Acme autumn launch" autoComplete="off" /><small id="brand-hint">Used to name your saved collection and brief.</small></div>
          <div className="marketing-field"><label htmlFor="marketing-decision">What decision should this help you make?</label><textarea {...fieldProps('decision')} rows={3} maxLength={2000} placeholder={template.decisionPlaceholder} /><small id="decision-hint">Add useful context, including which brands or URLs are yours.</small></div>
          <div className="marketing-field"><label htmlFor="marketing-audience">Who are you trying to reach? <span>Optional</span></label><input {...fieldProps('audience')} maxLength={800} placeholder="e.g. Marketing leaders at enterprise software companies" /><small id="audience-hint">An audience helps keep recommendations relevant.</small></div>
          <div className="marketing-field"><div className="marketing-source-label"><label htmlFor="marketing-sourceUrls">Public page URLs</label><span aria-live="polite">{uniqueCount} / 15 pages</span></div><textarea {...fieldProps('sourceUrls')} className="marketing-url-input" rows={5} spellCheck="false" placeholder={'https://example.com/product\nhttps://competitor.com/pricing'} /><small id="sourceUrls-hint">One complete URL per line. Include your own pages, competitor pages, or other relevant sources. We collect only these pages; duplicates count once.</small></div>
          <div className="marketing-budget"><div className="marketing-field"><label htmlFor="marketing-maxTotalChargeUsd">Apify run budget (USD)</label><div className="marketing-currency"><span aria-hidden="true">$</span><input {...fieldProps('maxTotalChargeUsd')} type="number" min="0.01" max="100" step="0.01" inputMode="decimal" /></div><small id="maxTotalChargeUsd-hint">A spending ceiling, not an estimated price. This limit is sent to Apify. A limited run may return fewer pages. AI analysis is separate.</small></div></div>
          <details className="marketing-details"><summary><SlidersHorizontal size={14} aria-hidden="true" />Collection details<ChevronDown size={14} aria-hidden="true" /></summary><div><dl><div><dt>Collector</dt><dd>{template.actorId}</dd></div><div><dt>Scope</dt><dd>Supplied pages only · no linked pages</dd></div><div><dt>Limits</dt><dd>Up to 15 pages · 5 minutes per run</dd></div><div><dt>Collection settings</dt><dd>Adaptive browser · concurrency 3 · 2 retries · Markdown output</dd></div><div><dt>Source access</dt><dd>Public pages · respects robots rules</dd></div><div><dt>AI during collection</dt><dd>Off · create your brief after collection</dd></div><div><dt>Schema checked</dt><dd>{template.schemaCheckedAt} · template v{template.templateVersion}</dd></div></dl><a href={template.schemaUrl} target="_blank" rel="noreferrer">View the collector’s input documentation</a></div></details>
        </fieldset>
        {error && <div id="marketing-form-error" className="marketing-form-error" role="alert">{error.message}</div>}
        <footer className="marketing-form-footer"><p className="marketing-save-note"><ShieldCheck size={14} aria-hidden="true" />Save now. Run when you’re ready.</p><div><button className="ghost" type="button" disabled={disabled} onClick={onCancel}>Cancel</button><button type="submit" disabled={disabled}>{saving ? 'Saving…' : 'Save collection'}{!saving && <ArrowRight size={15} aria-hidden="true" />}</button></div></footer>
      </form>
      <aside className="marketing-outline" aria-labelledby="marketing-outline-title"><div className="marketing-outline-icon"><FileText size={21} aria-hidden="true" /></div><span className="marketing-eyebrow">YOUR DELIVERABLE</span><h3 id="marketing-outline-title">A brief built for a decision.</h3><p>{template.outputPreview}</p><span className="marketing-preview-label">Structure preview · no findings yet</span><ol>{template.sections.map((section, index) => <li key={section.title}><span aria-hidden="true">0{index + 1}</span><div><h4>{section.title}</h4><p>{section.description}</p></div></li>)}</ol><div className="marketing-evidence-note"><Globe2 size={16} aria-hidden="true" /><p>Check citations and collection coverage before sharing. AI findings are drafts for your review.</p></div><p className="marketing-outline-footnote">{template.scope}</p></aside>
    </div>
  </section>;
}

export function MarketingTemplateView({ templateId, onSave, onCancel, onOpenScrapers, busy = false, brandProfiles = [], selectedBrandProfileId = '', onSelectBrandProfile, onManageProfiles }) {
  const template = MARKETING_TEMPLATES.find((item) => item.id === templateId);
  if (!template || !template.supportsPublicPages) return <section className="marketing-template-view"><h2>Choose a marketing template</h2><p>This template is unavailable.</p><button type="button" onClick={onCancel}>All templates</button></section>;
  return <MarketingTemplateForm key={template.id} template={template} onSave={onSave} onCancel={onCancel} onOpenScrapers={onOpenScrapers} busy={busy} brandProfiles={brandProfiles} selectedBrandProfileId={selectedBrandProfileId} onSelectBrandProfile={onSelectBrandProfile} onManageProfiles={onManageProfiles} />;
}
