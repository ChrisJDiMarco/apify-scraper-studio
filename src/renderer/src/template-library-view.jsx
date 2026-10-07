import React, { useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, ChevronRight, FileText, FolderInput, GitCompareArrows, Globe2, Search } from 'lucide-react';
import { MARKETING_TEMPLATES } from '../../shared/marketing-templates.js';
import './template-library.css';

export function TemplateLibraryView({ state = {}, onChooseTemplate, onNavigate }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = ['All', ...new Set(MARKETING_TEMPLATES.map((template) => template.category))];
  const selectedProfile = (state.brandProfiles || []).find((profile) => profile.id === state.settings?.selectedBrandProfileId);
  const hasData = (state.datasets || []).length > 0;
  const templates = MARKETING_TEMPLATES.filter((template) => (category === 'All' || template.category === category) && `${template.name} ${template.description} ${template.audience} ${template.inputSummary}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="playbook-library" aria-labelledby="playbook-library-title">
    <header className="playbook-heading"><div><span className="playbook-eyebrow">EIGHT WAYS TO MOVE RESEARCH FORWARD</span><h2 id="playbook-library-title">Start with the decision.</h2><p>Choose an outcome, bring the right evidence, and create a brief worth reviewing.</p></div><button type="button" className="ghost" onClick={() => onNavigate('brands')}><BriefcaseBusiness size={15} aria-hidden="true" />Brand profiles</button></header>
    <div className="playbook-brand-context"><span><BriefcaseBusiness size={19} aria-hidden="true" /></span><div><strong>{selectedProfile ? `Workspace context: ${selectedProfile.name}` : 'Give every brief the same starting point.'}</strong><p>{selectedProfile ? 'Apply this saved profile when setting up a collection. Each brief keeps its own copy of the context.' : 'Save your offering, audience, competitors, brand voice, and claims to avoid.'}</p></div><button type="button" onClick={() => onNavigate('brands')}>{selectedProfile ? 'Manage context' : 'Set up brand context'}<ChevronRight size={14} aria-hidden="true" /></button></div>
    <div className="playbook-toolbar"><label className="playbook-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search playbooks</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a playbook by outcome or input" /></label><div className="playbook-filters" aria-label="Filter by outcome">{categories.map((value) => <button type="button" key={value} className={category === value ? 'active' : ''} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div></div>
    <p className="playbook-count" aria-live="polite">{templates.length} {templates.length === 1 ? 'playbook' : 'playbooks'}</p>
    <div className="playbook-grid">{templates.map((template) => {
      const Icon = template.sourceMode === 'public-pages' ? Globe2 : template.sourceMode === 'comparison' ? GitCompareArrows : FolderInput;
      const inputLabel = template.sourceMode === 'public-pages' ? 'Collect public pages' : template.sourceMode === 'comparison' ? 'Compare snapshots' : 'Use supplied data';
      const actionLabel = template.sourceMode === 'public-pages' ? 'Set up collection' : template.sourceMode === 'comparison' ? 'Compare snapshots' : hasData ? 'Choose a dataset' : 'Import source data';
      return <article className={`playbook-card ${template.sourceMode}`} key={template.id}><div className="playbook-card-top"><span><Icon size={19} aria-hidden="true" /></span><small>{inputLabel}</small></div><span className="playbook-audience">{template.audience}</span><h3>{template.name}</h3><p>{template.description}</p><dl><div><dt>Bring</dt><dd>{template.inputSummary}</dd></div><div><dt>Get</dt><dd>{template.outputPreview}</dd></div></dl><ul>{template.sections.slice(0, 2).map((section) => <li key={section.title}><Check size={12} aria-hidden="true" />{section.title}</li>)}</ul><div className="playbook-scope"><FileText size={13} aria-hidden="true" /><p>{template.scope}</p></div><div className="playbook-actions"><button type="button" onClick={() => onChooseTemplate(template.id)} aria-label={`${actionLabel}: ${template.name}`}>{actionLabel}<ArrowRight size={14} aria-hidden="true" /></button>{template.sourceMode === 'dataset' && hasData && <button className="playbook-secondary" type="button" onClick={() => onNavigate('imports', { templateId: template.id, reportPresetId: template.id })}>Import data</button>}{template.sourceMode === 'dataset' && template.supportsPublicPages && <button type="button" className="playbook-secondary" onClick={() => onNavigate('marketing-template', { templateId: template.id })}>Collect page URLs</button>}</div></article>;
    })}</div>
    {!templates.length && <div className="playbook-empty"><Search size={25} aria-hidden="true" /><h3>No playbooks match that search.</h3><p>Try an outcome such as campaign, customer, account, or content.</p><button type="button" className="ghost" onClick={() => { setQuery(''); setCategory('All'); }}>Clear filters</button></div>}
  </section>;
}
