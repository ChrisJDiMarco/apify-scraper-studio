import React from 'react';
import { ArrowRight, ArrowUpRight, Check, Database, FileText, Globe2, History, BriefcaseBusiness, MessageCircle, Plus, ScanSearch, ShieldCheck, Sparkles, Target, Workflow } from 'lucide-react';
import { summarizeStudio } from '../../shared/dashboard.js';
import { MARKETING_TEMPLATES } from '../../shared/marketing-templates.js';
import { Badge, Button, formatDate, number, statusTone } from './ui.jsx';
import './home-marketing.css';

const SOURCES = [
  { id: 'web', title: 'Websites', detail: 'Pages, articles & product data', icon: Globe2, color: 'blue' },
  { id: 'reddit', title: 'Reddit', detail: 'Conversations & communities', icon: MessageCircle, color: 'orange' },
  { id: 'linkedin', title: 'LinkedIn', detail: 'Companies & professional insights', icon: BriefcaseBusiness, color: 'linkedin' },
  { id: 'x', title: 'X / Twitter', detail: 'Posts, trends & public conversations', icon: null, color: 'black' },
];

const STARTERS = [
  { id: 'competitor-positioning', icon: ScanSearch, label: 'KNOW YOUR COMPETITION', tone: 'indigo' },
  { id: 'campaign-message-audit', icon: Target, label: 'SHARPEN YOUR MESSAGE', tone: 'sand' },
  { id: 'launch-research', icon: Sparkles, label: 'PLAN YOUR NEXT LAUNCH', tone: 'sage' },
];

function MarketingStarters({ onNavigate }) {
  return (
    <section className="marketing-starters" aria-labelledby="marketing-starters-title">
      <div className="section-heading">
        <div><h3 id="marketing-starters-title">Start with a question worth answering.</h3><p>Choose a ready-made research brief. Add your context and the pages you want to explore.</p></div>
        <Button className="text-button" onClick={() => onNavigate('templates')}>Explore all 8 playbooks<ArrowRight size={14} /></Button>
      </div>
      <div className="marketing-starter-grid">
        {STARTERS.map(({ id, icon: Icon, label, tone }) => {
          const template = MARKETING_TEMPLATES.find((item) => item.id === id);
          if (!template) return null;
          return (
            <article className={`marketing-starter-card ${tone}`} key={id}>
              <div className="marketing-starter-top"><span className="marketing-starter-icon"><Icon size={21} strokeWidth={1.65} /></span><span>Up to 15 pages</span></div>
              <div className="marketing-starter-copy"><span className="marketing-starter-label">{label}</span><h4>{template.name}</h4><p>{template.description}</p></div>
              <div className="marketing-starter-output"><span>YOUR BRIEF INCLUDES</span><ul>{template.sections.slice(0, 2).map((section) => <li key={section.title}><Check size={12} />{section.title}</li>)}</ul></div>
              <Button className="marketing-starter-action" aria-label={`Use ${template.name}`} onClick={() => onNavigate('marketing-template', { templateId: id })}>Preview &amp; set up<ArrowRight size={15} /></Button>
            </article>
          );
        })}
      </div>
      <div className="marketing-starter-note"><FileText size={14} /><span>A structured draft with source links, ready for your review. You choose when to collect and analyze.</span></div>
    </section>
  );
}

function ResearchNextSteps({ state, onNavigate }) {
  const actions = (state.researchReviews || []).flatMap((review) => (review.actions || []).filter((action) => !['done', 'dismissed'].includes(action.status)).map((action) => ({ ...action, analysisId: review.analysisId }))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const dueChecks = (state.monitors || []).filter((monitor) => monitor.nextCheckAt && Date.parse(monitor.nextCheckAt) <= Date.now()).sort((a, b) => Date.parse(a.nextCheckAt) - Date.parse(b.nextCheckAt));
  if (!actions.length && !dueChecks.length) return null;
  return <section className="home-research-next" aria-labelledby="home-research-next-title"><div className="section-heading"><div><h3 id="home-research-next-title">Keep the research moving.</h3><p>{actions.length} open {actions.length === 1 ? 'action' : 'actions'} · {dueChecks.length} source {dueChecks.length === 1 ? 'check' : 'checks'} due</p></div><span className="section-caption">YOUR NEXT STEPS</span></div><div className="home-next-grid">{actions.slice(0, 3).map((action) => <button type="button" key={`${action.analysisId}-${action.id}`} onClick={() => onNavigate('reports', { analysisId: action.analysisId, datasetId: state.analyses?.find((analysis) => analysis.id === action.analysisId)?.datasetId })}><span className="home-next-icon"><FileText size={17} aria-hidden="true" /></span><span><strong>{action.title}</strong><small>{action.owner || 'Unassigned'} · {action.dueDate ? `Due ${action.dueDate}` : 'No due date'}</small></span><ArrowRight size={14} aria-hidden="true" /></button>)}{dueChecks.slice(0, 2).map((monitor) => <button type="button" key={monitor.id} onClick={() => onNavigate('compare')}><span className="home-next-icon"><History size={17} aria-hidden="true" /></span><span><strong>{monitor.name}</strong><small>Source check due · collect and compare manually</small></span><ArrowRight size={14} aria-hidden="true" /></button>)}</div></section>;
}

export function HomeView({ state, onNavigate }) {
  const metrics = summarizeStudio(state);
  const connected = metrics.apifyConnected;
  const hasData = state.datasets.length > 0;
  const reports = (state.analyses || []).filter((item) => item.kind === 'report' && item.status === 'succeeded');
  const setup = [
    { label: 'Connect Apify', detail: 'Add your API token', done: connected, view: 'settings' },
    { label: 'Create a scraper', detail: 'Choose what to collect', done: state.recipes.length > 0, view: 'automation', args: { create: true } },
    { label: 'Explore your data', detail: 'Find something useful', done: hasData, view: hasData ? 'datasets' : 'automation' },
  ];
  const nextStep = setup.findIndex((step) => !step.done);
  const recent = [...(state.runs || []).map((run) => ({ ...run, kind: 'scrape', title: state.recipes.find((recipe) => recipe.id === run.recipeId)?.name || run.recipeName || 'Scraper run' })), ...(state.analyses || []).map((run) => ({ ...run, title: run.reportPresetName || `${run.kind === 'report' ? 'AI report' : 'Dataset analysis'}` }))].sort((a, b) => new Date(b.startedAt || b.createdAt || 0) - new Date(a.startedAt || a.createdAt || 0)).slice(0, 4);
  return (
    <section className="home-view marketing-home">
      <div className="page-heading">
        <div><div className="eyebrow"><span />YOUR LOCAL RESEARCH WORKSPACE</div><h2>Research your market. <span>Make your next move.</span></h2><p>Turn the pages you trust into a brief your marketing team can use.</p></div>
        <Button className="ghost" onClick={() => onNavigate('automation', { create: true })}><Plus size={16} />New scraper</Button>
      </div>
      <div className="home-search-entry"><div><strong>What would you like to research?</strong><p>Search Reddit, X, and LinkedIn with your connected scrapers. Ask questions about what you find.</p></div><Button onClick={() => onNavigate('search')}>Search platforms<ArrowRight size={16} /></Button></div><div className="marketing-home-intro">
        <div><span className="marketing-intro-icon"><FileText size={22} strokeWidth={1.5} /></span><div><strong>From a business question to a useful brief.</strong><p>A focused starting point, the sources behind it, and a clear next step.</p></div></div>
        <ol aria-label="Research workflow"><li><span>1</span>Choose a brief</li><li><span>2</span>Add your sources</li><li><span>3</span>Review the findings</li></ol>
      </div>
      <MarketingStarters onNavigate={onNavigate} />
      <div className="home-brand-entry"><BriefcaseBusiness size={19} aria-hidden="true" /><div><strong>{state.brandProfiles?.find((profile) => profile.id === state.settings?.selectedBrandProfileId)?.name || 'Give every brief your brand context.'}</strong><p>Reuse your audience, positioning, ICP, brand voice, and claims to avoid.</p></div><Button className="text-button" onClick={() => onNavigate('brands')}>Brand profiles<ArrowRight size={14} /></Button></div>
      <ResearchNextSteps state={state} onNavigate={onNavigate} />
      <section className="source-section custom-collection" aria-labelledby="custom-collection-title">
        <div className="section-heading"><div><h3 id="custom-collection-title">Build a custom collection</h3><p>Have something else in mind? Choose a source and connect an Apify Actor or saved task.</p></div><span className="section-caption">YOUR OWN WORKFLOW</span></div>
        <div className="source-grid">{SOURCES.map(({ id, title, detail, icon: Icon, color }) => <button className="source-card" key={id} onClick={() => onNavigate('automation', { templateId: id, create: true })}><div><span className={`source-icon ${color}`}>{Icon ? <Icon size={21} strokeWidth={1.8} /> : <span className="x-logo">𝕏</span>}</span><ArrowUpRight size={16} /></div><strong>{title}</strong><small>{detail}</small></button>)}</div>
      </section>
      {!hasData && <div className="getting-started" aria-label="Getting started"><div className="getting-started-label"><strong>Your first collection</strong><span>{setup.filter((step) => step.done).length} of 3 complete</span></div><div className="setup-steps">{setup.map((step, index) => <button type="button" className={`setup-step ${step.done ? 'complete' : index === nextStep ? 'current' : ''}`} key={step.label} onClick={() => onNavigate(step.view, step.args || {})}><span className="step-number">{step.done ? <Check size={15} /> : `0${index + 1}`}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div><ArrowUpRight size={14} /></button>)}</div></div>}
      <div className="home-metrics" aria-label="Workspace totals">{[
        { title: 'Saved scrapers', value: metrics.recipes, icon: Globe2, view: 'automation', detail: 'Your reusable collections' },
        { title: 'Collected rows', value: metrics.totalItems, icon: Database, view: 'datasets', detail: `${number(metrics.datasets)} datasets in your workspace` },
        { title: 'AI reports', value: reports.length, icon: FileText, view: 'reports', detail: 'Completed and ready to review' },
      ].map(({ title, value, icon: Icon, view, detail }) => <button className="home-metric" key={title} onClick={() => onNavigate(view)}><div><span>{title}</span><Icon size={17} /></div><strong>{number(value)}</strong><small>{detail}<ArrowRight size={13} /></small></button>)}</div>
      <div className="home-bottom"><section className="recent-section"><div className="section-heading"><h3>Recent activity</h3><Button className="text-button" onClick={() => onNavigate('runs')}>View activity<ArrowRight size={14} /></Button></div>{recent.length ? <div className="recent-list">{recent.map((item) => <button className="recent-row" key={`${item.kind}-${item.id}`} onClick={() => onNavigate(item.kind === 'scrape' ? 'runs' : 'reports', { datasetId: item.datasetId })}><span className="recent-icon">{item.kind === 'scrape' ? <Globe2 size={17} /> : <Sparkles size={17} />}</span><div><strong>{item.title}</strong><small>{formatDate(item.startedAt || item.createdAt)}</small></div><Badge tone={statusTone(item.status)}>{item.status || 'Pending'}</Badge></button>)}</div> : <div className="quiet-empty"><span><History size={22} strokeWidth={1.5} /></span><div><strong>A fresh start.</strong><p>Your collections and analyses will appear here as you go.</p></div></div>}</section><aside className="home-tip"><span className="tip-icon"><Workflow size={18} /></span><div><span className="eyebrow">BUILT FOR YOUR FLOW</span><h3>A starting point you can reuse.</h3><p>Keep your source collection for the next research question. Review the results, export a CSV, or ask your AI assistant to draft a report.</p><Button className="text-button" onClick={() => onNavigate('automation')}>Explore scrapers<ArrowRight size={14} /></Button></div></aside></div>
      <footer className="home-footer"><span><ShieldCheck size={13} />Workspace files are stored on this Mac</span><span>Collection uses Apify · AI: {state.settings?.aiProvider === 'codex' ? 'Codex' : 'Claude Opus'}</span></footer>
    </section>
  );
}
