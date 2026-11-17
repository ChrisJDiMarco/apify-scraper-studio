import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { Dialog } from './role-screens.jsx';
import { can, roleLabel } from './viewer.js';
import './workspace-tour.css';

export const tourKey = (viewer, workspace) => `${workspace?.id || viewer?.workspaceId || ''}:${viewer?.isSuperAdmin && !viewer?.preview ? 'superadmin' : viewer?.roleId || viewer?.role || ''}`;
const personKey = (viewer, workspace) => `${viewer?.id || ''}:${tourKey(viewer, workspace)}`;
export function tourSteps(viewer, pages = []) {
  const channel = viewer?.role === 'channel';
  const admin = viewer?.role === 'admin';
  const approves = can(viewer, 'decideResearchTheme') || can(viewer, 'approveResearchThemes');
  const generates = can(viewer, 'createAssetKit');
  const rows = [
    { page: '', title: 'Your workspace', text: viewer?.isSuperAdmin && !viewer?.preview ? 'Use the workspace menu to switch workspaces or create one. Each workspace keeps its research, channels and content separate.' : 'The workspace menu shows where you are working. You can switch to another workspace you belong to; your role can be different there.' },
    { page: 'programs', title: channel ? 'Read the research programs' : 'Start with research programs', text: channel ? 'See what each program follows and where its research comes from. Programs feed the trends your channel receives. Contact an admin when you need a program added or changed.' : 'Each research program follows a different topic, brand or set of sources. Together they feed the trends pipeline. Open a program to review its sources and schedule.' },
    { page: 'trends', title: channel ? 'Choose trends for your channel' : 'Review trends and their reports', text: channel ? can(viewer, 'setTrendAdoption') ? 'Your board starts with approved trends ready to review. Choose Using or Not for us. Everyone in your channel shares this board; your choice does not change another channel’s decision.' : 'Read approved trends and your channel’s shared decisions. Your role can view this board; a channel owner with decision access chooses which trends to use.' : approves ? 'Review the trends research finds, approve the ones worth covering and read their evidence-backed reports before making content.' : 'Read the trends research finds and their evidence-backed reports. Your workspace’s research leads decide which ones to approve.' },
    { page: 'assets', title: generates ? 'Make and review assets' : 'Review your assets', text: generates ? channel ? 'Generate drafts directly from Assets for a trend your channel can use. Review the proposed files before you start. Finished drafts and pictures stay here for your channel.' : 'Find reports and channel assets here. Start asset generation from a trend’s report, then review and download the results.' : 'Read and download the reports and assets available to your role. Ask an admin if you need access to generate new drafts.' },
    channel && { page: 'mychannel', title: 'Teach Golden Thread your channel', text: 'Save your audience, voice and asset instructions. Add image examples with a short description of what works, so future visuals have a useful reference.' },
    !channel && { page: 'calendar', title: 'Plan the work', text: 'The calendar connects channel plans to the trends and assets behind them. Review what is planned and when it goes out.' },
    admin && { page: 'people', title: 'Manage workspace access', text: viewer?.isSuperAdmin && !viewer?.preview ? 'Manage people in this workspace, or add an existing account from another workspace. Choose their role and channel here without creating another account.' : 'Manage the people and roles in this workspace. A Super Admin creates workspaces and adds existing accounts across workspaces.' },
    { page: 'ask', title: 'Ask AI for help or drafts', text: channel ? 'Ask about your channel’s trends, make drafts or request pictures. Actions are checked against your access and require your confirmation before generation starts.' : 'Ask questions about the workspace or request help making content. Golden Thread offers actions for you to review before it starts work.' },
  ].filter(Boolean);
  return rows.filter((step) => !step.page || pages.includes(step.page));
}

// Completion is keyed by person in memory and workspace + role in the server's per-person preferences. Replays in
// View as demonstrate the other role without writing completion to the admin's real preferences.
export function WorkspaceTour({ viewer, workspace, pages = [], onOpenPage, onSave, enabled = true }) {
  const titleId = useId();
  const [closed, setClosed] = useState({});
  const [replay, setReplay] = useState('');
  const [active, setActive] = useState({ key: '', index: -1 });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const titleRef = useRef(null);
  const key = tourKey(viewer, workspace);
  const personal = personKey(viewer, workspace);
  const live = useRef({ personal, key, viewer }); live.current = { personal, key, viewer };
  useEffect(() => {
    const start = () => { setReplay(live.current.personal); setActive({ key: live.current.personal, index: -1 }); setProblem(''); };
    window.addEventListener('golden-thread-replay-tour', start);
    return () => window.removeEventListener('golden-thread-replay-tour', start);
  }, []);
  const seen = Boolean(viewer?.prefs?.workspaceTours?.[key]);
  const show = enabled && Boolean(viewer?.id && viewer?.role && workspace?.id) && (replay === personal || (viewer.workspaceId && !viewer.preview && !seen && !closed[personal]));
  const index = active.key === personal ? active.index : -1;
  const steps = tourSteps(viewer, pages);
  const step = steps[index];
  useEffect(() => { if (show && index >= 0) titleRef.current?.focus({ preventScroll: true }); }, [show, index, personal]);
  async function finish() {
    if (saving) return;
    const finishing = personal;
    setSaving(true); setProblem('');
    try {
      if (!viewer.preview && onSave) await onSave({ workspaceTours: { [key]: new Date().toISOString() } });
      setClosed((value) => ({ ...value, [finishing]: true }));
      setReplay((value) => value === finishing ? '' : value);
    } catch (error) { setProblem(error?.message || 'The walkthrough could not be saved. Try again.'); }
    finally { setSaving(false); }
  }
  function go(next) {
    setProblem('');
    if (next >= steps.length) { finish(); return; }
    const target = steps[next];
    setActive({ key: personal, index: next });
    if (target?.page) onOpenPage?.(target.page);
  }
  if (!show) return null;
  const label = viewer.isSuperAdmin && !viewer.preview ? 'Super Admin' : roleLabel(viewer);
  if (!step) return <Dialog labelledBy={titleId} onClose={finish} closeDisabled={saving} className="workspace-tour-intro">
    <header className="studio-dialog-head"><div><h2 id={titleId}>Welcome to {workspace.name || 'your workspace'}</h2><p className="studio-dialog-meta">{label}{viewer.channelName ? ` · ${viewer.channelName}` : ''}</p></div></header>
    <div className="studio-dialog-body"><p>Take a short walkthrough of the pages and actions available to you in this workspace. You can replay it from the account menu.</p>{problem && <p className="studio-error" role="alert">{problem}</p>}</div>
    <footer className="workspace-tour-actions"><button type="button" className="studio-quiet" disabled={saving} onClick={finish}>Skip for now</button><button type="button" className="studio-primary" disabled={saving} onClick={() => go(0)}><Compass size={15} aria-hidden="true" />Start walkthrough</button></footer>
  </Dialog>;
  return <aside className="workspace-tour-card" role="region" aria-label="Workspace walkthrough">
    <header><span>{workspace.name} · {label}</span><button type="button" className="studio-icon-button" aria-label="Skip walkthrough" disabled={saving} onClick={finish}><X size={16} aria-hidden="true" /></button></header>
    <p className="workspace-tour-progress">Step {index + 1} of {steps.length}</p>
    <h2 ref={titleRef} tabIndex={-1}>{step.title}</h2><p>{step.text}</p>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    <footer className="workspace-tour-actions">{index > 0 ? <button type="button" className="studio-quiet" disabled={saving} onClick={() => go(index - 1)}><ArrowLeft size={15} aria-hidden="true" />Back</button> : <span />}
      <button type="button" className="studio-primary" disabled={saving} onClick={() => go(index + 1)}>{index === steps.length - 1 ? <><Check size={15} aria-hidden="true" />Finish walkthrough</> : <>Next<ArrowRight size={15} aria-hidden="true" /></>}</button></footer>
  </aside>;
}
