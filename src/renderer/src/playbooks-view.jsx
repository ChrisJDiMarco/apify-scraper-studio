import React, { useMemo, useState } from 'react';
import { Copy, Mail, Megaphone, Pencil, Plus, Rocket, Search, Swords, Trash2, TrendingUp } from 'lucide-react';
import CATALOG from '../../shared/playbooks.json';
import { MoreMenu } from './role-screens.jsx';
import { hasCapability, writeProps } from './viewer.js';
import { money } from './studio-actions.js';
import { StepRail } from './workflow-editor.jsx';
import { describeTrigger } from './workflow-model.js';
import './workflows.css';

// Playbooks (Advanced › Automate): ready-made setups for common marketing jobs. Choosing one opens the setup sheet
// (playbook-setup.jsx); a playbook never runs anything itself.
const ICONS = { TrendingUp, Swords, Rocket, Mail, Megaphone, Plus };
const CATEGORIES = ['All', 'Trends', 'Competitors', 'Launches', 'Content', 'PR'];
const list = (value) => (Array.isArray(value) ? value : []);
// A playbook's step templates, as rail steps.
const railSteps = (playbook) => list(playbook.steps).map((step, index) => ({ ...step, id: `step-${index + 1}` }));
const cadence = (playbook) => {
  const trigger = playbook.trigger || {};
  if (trigger.kind === 'schedule' && trigger.schedule?.frequency === 'hourly') return `Every ${trigger.schedule.everyHours} hours around launch`;
  return describeTrigger({ ...trigger, schedule: { timeZone: 'UTC', ...(trigger.schedule || {}) } }).replace(/ \(UTC\)$/, '');
};

export function PlaybooksView({ state = {}, api = {}, viewer = {}, can = () => true, confirm, action, onSetUp, onOpenWorkflow, edition = 'general' }) {
  const studio = state.contentStudio || {};
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const showCosts = hasCapability(viewer, 'seeCosts');
  const canSetUp = can('applyPlaybook') || can('saveWorkflow');
  const builtIn = CATALOG.playbooks.filter((playbook) => list(playbook.editions).includes(edition === 'semrush' ? 'semrush' : 'general'));
  const team = list(studio.playbooks);
  const workflows = list(studio.workflows);
  const matches = (playbook) => (category === 'All' || playbook.category === category) && (!query.trim() || `${playbook.name} ${playbook.summary} ${playbook.outcome}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shown = builtIn.filter(matches);
  const inUse = useMemo(() => {
    const groups = new Map();
    for (const workflow of workflows) if (workflow.playbookId) groups.set(workflow.playbookId, [...(groups.get(workflow.playbookId) || []), workflow]);
    return [...groups.entries()].map(([id, rows]) => ({ playbook: [...builtIn, ...team].find((row) => row.id === id), rows })).filter((entry) => entry.playbook);
  }, [workflows, team, builtIn]);
  const ctx = { programs: list(studio.programs), edition, monday: state.monday, imagesReady: Boolean(studio.capabilities?.imagesConfigured) };

  const card = (playbook, { teamOwned = false } = {}) => {
    const Icon = ICONS[playbook.icon] || TrendingUp;
    return <li key={playbook.id} className="wf-card">
      <div className="wf-card-head"><span className="wf-tile" aria-hidden="true"><Icon size={18} /></span><div><h3>{playbook.name}</h3><p className="wf-hint">{playbook.outcome}</p></div></div>
      <p className="wf-card-summary">{playbook.summary}</p>
      {!playbook.blank && <StepRail steps={railSteps(playbook)} compact ctx={ctx} />}
      <div className="wf-card-meta">
        {!playbook.blank && <span className="studio-chip plain">{cadence(playbook)}</span>}
        {showCosts && playbook.budgetHint?.perRunUsd > 0 && <span className="studio-chip plain">About {money(playbook.budgetHint.perRunUsd)} a run</span>}
      </div>
      <div className="wf-card-actions">
        <button type="button" className={canSetUp ? 'studio-primary small' : 'studio-quiet small'} {...(canSetUp ? writeProps(viewer) : {})} onClick={() => onSetUp?.(playbook.id)}>{canSetUp ? (playbook.blank ? 'Start' : 'Set up') : 'Preview'}</button>
        {teamOwned && can('savePlaybook') && <MoreMenu label={`More for ${playbook.name}`} disabled={viewer?.preview} items={[
          { label: 'Edit in setup', icon: Pencil, onSelect: () => onSetUp?.(playbook.id) },
          { label: 'Duplicate', icon: Copy, onSelect: () => action?.(() => api.savePlaybook({ playbook: { ...playbook, id: undefined, name: `${playbook.name} (copy)`.slice(0, 80) } }), 'Playbook duplicated.') },
          can('deletePlaybook') && { label: 'Delete', icon: Trash2, danger: true, onSelect: async () => { if (await confirm?.({ title: `Delete “${playbook.name}”?`, lines: ['Workflows made from it keep running.'], confirmLabel: 'Delete playbook', tone: 'danger' })) action?.(() => api.deletePlaybook({ playbookId: playbook.id }), 'Playbook deleted.'); } },
        ]} />}
      </div>
    </li>;
  };

  return <div className="studio-screen studio-page wf-page">
    <div className="studio-page-head"><div><h1>Start from a playbook</h1><p>Ready-made setups for common marketing jobs. Each one sets up the research, the approval rules, the reports and channel assets, and Monday.com, and shows the cost before anything runs.</p></div></div>
    <div className="wf-toolbar">
      <div className="studio-filters" role="group" aria-label="Categories">{CATEGORIES.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
      <label className="wf-search"><Search size={15} aria-hidden="true" /><span className="wf-sr">Search playbooks</span><input type="search" value={query} placeholder="Search playbooks" onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    {shown.length ? <ul className="wf-cards" aria-label="Playbooks">{shown.map((playbook) => card(playbook))}</ul> : <p className="wf-hint">No playbook matches. Try another word, or start from scratch.</p>}
    {team.length > 0 && <section className="wf-section" aria-label="Your team’s playbooks"><h2 className="studio-section-title">Your team’s playbooks</h2><ul className="wf-cards">{team.filter(matches).map((playbook) => card(playbook, { teamOwned: true }))}</ul></section>}
    {inUse.length > 0 && <section className="wf-section" aria-label="In use"><h2 className="studio-section-title">In use</h2>
      <ul className="wf-in-use">{inUse.map(({ playbook, rows }) => <li key={playbook.id}><strong>{playbook.name}</strong>{rows.map((workflow) => <button key={workflow.id} type="button" className="studio-link" onClick={() => onOpenWorkflow?.(workflow.id)}>{workflow.name}</button>)}</li>)}</ul>
    </section>}
  </div>;
}
