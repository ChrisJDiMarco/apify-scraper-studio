import React from 'react';
import { HelpAssistant } from './help-assistant.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { AI_ACTION_METHOD, aiRequest } from './studio-actions.js';
import { channelPlan, fileLabel } from './channel-owner.jsx';
import { PREVIEW_TITLE, formatDay, plural } from './viewer.js';

// Ask AI in a channel owner's layout: the shared Ask AI page, with what it can do for this channel. The server answers
// from their channel's view only (src/main/ask-channel.js) and checks every call against their role; here the buttons
// it offers run through the same API and the same gate as the channel screens' own buttons: Generate for my channel
// (planAssetKit, then createAssetKit after they confirm what will be made), Yes, I'm using this trend / Not for us
// (setTrendAdoption), Stop and Finish the rest on a set made for their channel only, Save folder, and opening their
// trends, drafts, plan and inbox. Nothing here reads beyond state.contentStudio.channelView.
const list = (value) => (Array.isArray(value) ? value : []);
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const ACTIVE = new Set(['queued', 'running']);
const UNFINISHED = new Set(['failed', 'partial', 'cancelled']);
const TABS = ['trends', 'assets', 'plan', 'inbox', 'ask'];
const minutesText = (minutes) => { const value = Math.round(Number(minutes) || 0); return value <= 0 ? 'Usually takes a few minutes.' : value === 1 ? 'Takes about a minute.' : `Takes about ${value} minutes.`; };
const viewOf = (state) => state?.contentStudio?.channelView || null;
const left = (run) => list(run?.jobs).filter((job) => job.status !== 'succeeded').length;
const trendNames = (trend) => [trend?.name, ...list(trend?.reportAssets).map((asset) => asset.title)].filter(Boolean).map(norm);

// What needs them now, from their channel's view (no AI call): new trends to answer, a set of theirs that didn't
// finish, and a planned day coming up. Each is a button the channel runner below takes.
export function channelNeeds(state, can = () => true) {
  const view = viewOf(state); if (!view) return [];
  const trends = list(view.trends); const out = [];
  const fresh = trends.filter((trend) => trend.isNew && !trend.adoption);
  if (fresh.length) out.push({ label: `${plural(fresh.length, 'new trend')} for ${view.channel?.name || 'your channel'}${can('setTrendAdoption') ? `: say if you’re using ${fresh.length === 1 ? 'it' : 'them'}` : ''}`, request: { kind: 'open-tab', label: 'Open Trends', target: 'trends' } });
  const seen = new Set();
  for (const run of list(view.runs)) {
    const key = run.kit?.themeId || run.id; if (seen.has(key)) continue; seen.add(key);
    if (UNFINISHED.has(run.status) && left(run) && !run.shared && !run.needsAdmin) { out.push({ label: `${plural(left(run), 'draft')} for “${run.kit?.sourceTitle || run.title}” didn’t finish`, request: { kind: 'finish-assets', label: 'Finish them', target: run.kit?.sourceTitle || run.title, runId: run.id, themeId: run.kit?.themeId || '' } }); break; }
  }
  // A planned day coming up: only for a role that has My plan and can save the link (Mark trends used).
  const soon = can('setTrendAdoption') && trends.filter((trend) => trend.adoption?.status === 'using' && trend.adoption.plannedFor && !trend.adoption.link).map((trend) => ({ trend, days: (Date.parse(`${trend.adoption.plannedFor}T12:00:00`) - Date.now()) / 86400000 })).filter((row) => row.days >= -1 && row.days <= 7).sort((a, b) => a.days - b.days)[0];
  if (soon) out.push({ label: `“${soon.trend.name}” is planned for ${formatDay(soon.trend.adoption.plannedFor)}: add the live link when it’s out`, request: { kind: 'open-tab', label: 'Open My plan', target: 'plan' } });
  return out.slice(0, 3);
}

// Questions to start with, from their view, then plain ones about what a channel owner does.
export function channelStarters(state, { can = () => true, imagesReady = false } = {}) {
  const view = viewOf(state); const trends = list(view?.trends);
  const newest = trends[0];
  const out = [
    trends.some((trend) => trend.isNew) ? 'What’s new for my channel this week?' : '',
    newest ? `Summarize the brief for “${String(newest.name).slice(0, 50)}”` : '',
    newest && can('createAssetKit') ? `Generate drafts for “${String(newest.name).slice(0, 50)}”` : '',
    list(view?.assets).length ? 'Which of my drafts are still drafts?' : '',
    newest ? 'Draft a LinkedIn post about my newest trend' : '',
    newest && imagesReady ? 'Create a picture for my newest trend' : '',
    'How do I mark a trend as used?',
  ].filter(Boolean);
  return [...new Set(out)].slice(0, 4);
}

// The buttons Ask AI offers a channel owner. `nav`: { openTrend(themeId), openFolder(themeId), openTab(tab) }; `action`:
// App's runAction (it refreshes the state after each write); `web`: downloads instead of the Downloads folder.
export function channelAskRunner({ api, state, viewer = {}, canRun = () => true, action, confirm, nav = {}, askAdmin = 'an admin', imagesReady = false, web = false }) {
  const view = viewOf(state) || {}; const channel = view.channel || {};
  const trends = list(view.trends); const runs = list(view.runs);
  const act = (fn) => (action ? action(fn, '', true) : Promise.resolve().then(fn));
  const trendOf = (request) => (request.themeId && trends.find((trend) => trend.themeId === request.themeId)) || trends.find((trend) => trendNames(trend).includes(norm(request.title || request.target))) || null;
  const setOf = (request, keep) => (request.runId && runs.find((run) => run.id === request.runId && keep(run))) || (() => { const trend = trendOf(request); return trend ? runs.find((run) => run.kit?.themeId === trend.themeId && keep(run)) : runs.find((run) => norm(run.kit?.sourceTitle || run.title) === norm(request.target) && keep(run)); })() || null;
  const missing = (request) => new Error(`I couldn’t find “${request.target || 'that'}” among ${channel.name || 'your channel'}’s trends.`);
  // The pages this role has (viewer.nav.main, which lists Ask AI too when they have it): a custom channel role without
  // Mark trends used has no My plan, so a button for it says so instead of claiming it opened.
  const pages = Array.isArray(viewer?.nav?.main) ? viewer.nav.main : TABS;
  const openPage = (page, target) => { if (!TABS.includes(page) || !pages.includes(page)) throw new Error(`There’s no “${target || page}” page here.`); nav.openTab?.(page); return 'Opened.'; };
  const executors = {
    // Generate for my channel: what will be made comes from the server's plan, confirmed before anything is made.
    'make-assets': async (request) => {
      const trend = trendOf(request); if (!trend) throw missing(request);
      if (!trend.primaryReportId) throw new Error(`The brief for “${trend.name}” isn’t ready yet.`);
      const source = { kind: 'report', assetId: trend.primaryReportId };
      const deliverableIds = list(channel.deliverables).map((item) => item.id);
      const plan = channelPlan(await api.planAssetKit({ source, ...(deliverableIds.length ? { deliverableIds } : {}) }), channel, imagesReady);
      if (!plan.items.length) throw new Error('Nothing for your channel can be made from this brief right now.');
      const count = plural(plan.items.length, 'draft');
      const ok = await confirm({ title: `Generate ${count} for “${trend.name}”?`, items: plan.items.map((item) => fileLabel(item.label)), lines: [minutesText(plan.minutes), 'Drafts appear in My assets, and the trend’s card shows how far along they are.', ...(plan.picturesOff ? ['Pictures are off for your team, so only the written drafts are made.'] : [])], confirmLabel: `Generate ${count}` });
      if (!ok) return false;
      await act(() => api.createAssetKit({ source, deliverableIds: plan.items.map((item) => item.id) }));
      return `Generating ${count} for ${channel.name || 'your channel'}. Progress shows in My assets.`;
    },
    // Yes, I'm using this trend / Not for us, for their own channel (the server fixes the channel).
    'mark-used': async (request) => {
      const trend = trendOf(request); if (!trend) throw missing(request);
      const params = request.params || {}; const status = ['using', 'not-using', 'clear'].includes(params.status) ? params.status : 'using';
      const payload = status === 'clear' ? { themeId: trend.themeId, status } : { themeId: trend.themeId, status, ...(params.link ? { link: String(params.link) } : {}), ...(params.note ? { note: String(params.note) } : {}), ...(status === 'using' && params.date ? { plannedFor: String(params.date) } : {}) };
      await act(() => api.setTrendAdoption(payload));
      return status === 'clear' ? 'Answer cleared.' : status === 'using' ? `Saved: ${channel.name || 'your channel'} is using “${trend.name}”${params.date ? `, planned for ${formatDay(params.date) || params.date}` : ''}.` : `Saved: “${trend.name}” is not for ${channel.name || 'your channel'}.`;
    },
    'finish-assets': async (request) => {
      const run = setOf(request, (row) => UNFINISHED.has(row.status) && left(row) > 0); if (!run) throw new Error(`Nothing for “${request.target || 'that'}” needs another try.`);
      if (run.shared) throw new Error('This set was made with other channels. Ask an editor.');
      if (!(await confirm({ title: `Finish the ${plural(left(run), 'draft')} that didn’t make it?`, lines: ['Finished drafts aren’t made again.'], confirmLabel: 'Finish them' }))) return false;
      await act(() => api.retryStudioRun({ runId: run.id }));
      return 'Finishing the rest. Progress shows in My assets.';
    },
    'stop-run': async (request) => {
      const run = setOf(request, (row) => ACTIVE.has(row.status)); if (!run) throw new Error(`Nothing for “${request.target || 'that'}” is being made.`);
      if (run.shared) throw new Error('This set was made with other channels. Ask an editor.');
      if (!(await confirm({ title: 'Stop making these drafts?', lines: ['Finished ones are kept, and you can finish the rest later.'], confirmLabel: 'Stop', tone: 'danger' }))) return false;
      await act(() => api.cancelStudioRun({ runId: run.id }));
      return 'Stopped. Finished drafts are kept.';
    },
    'save-folder': async (request) => {
      const run = setOf(request, (row) => list(row.jobs).some((job) => job.assetId || list(job.assetIds).length)); if (!run) throw new Error(`No drafts for “${request.target || 'that'}” are ready to save yet.`);
      await act(() => api.saveAssetKitFolder({ runId: run.id }));
      return web ? 'Download started.' : 'Saved to your Downloads folder.';
    },
    open: (request) => {
      const ref = request.ref || {}; const type = ref.kind || request.params?.type || '';
      const page = ref.kind === 'page' ? ref.id : request.page || (type === 'page' ? norm(request.target) : '');
      if (page) return openPage(page, request.target);
      const trend = trendOf({ ...request, themeId: request.themeId || ref.id }); if (!trend) throw missing(request);
      if (type === 'folder') { nav.openFolder?.(trend.themeId); return 'Opened your drafts.'; }
      nav.openTrend?.(trend.themeId); return 'Opened the brief.';
    },
    'open-tab': (request) => openPage(norm(request.target), request.target),
    // Ask AI asks a plan's "ask" step itself (help-assistant.jsx); this is only the fallback.
    ask: () => 'Asked.',
  };
  async function runAiAction(raw = {}) {
    const request = aiRequest(raw);
    const execute = executors[request.kind];
    if (!execute) throw new Error('That isn’t something Ask AI can do in your channel.');
    const blocked = list(AI_ACTION_METHOD[request.kind]).find((method) => !canRun(method));
    if (blocked) throw new Error(viewer.preview ? PREVIEW_TITLE : `Your access doesn’t include that. Ask ${askAdmin} if you need it.`);
    return execute(request);
  }
  return { runAiAction, executors };
}

// The page: HelpAssistant with this channel's starters, Needs you now, buttons and ways to open things. `lastTab` is
// the page they came from; `seed` a question sent from elsewhere.
export function ChannelAskPage({ api, state, viewer, can, canRun, action, askAdmin = 'an admin', web = false, seed = null, lastTab = 'trends', onOpenTrend, onOpenFolder, onOpenTab }) {
  const confirm = useConfirm();
  const view = viewOf(state) || {}; const channel = view.channel || {};
  const imagesReady = Boolean(state?.contentStudio?.capabilities?.imagesConfigured) && can('createHelpImage') && list(viewer?.capabilities).includes('makeAssets');
  const nav = {
    openTrend: (themeId) => onOpenTrend?.(themeId), openFolder: (themeId) => onOpenFolder?.(themeId), openTab: (tab) => onOpenTab?.(tab),
    // Cards and links: a trend card's Open report opens its brief; a folder card opens My assets on that trend.
    openReport: (assetId) => { const trend = list(view.trends).find((row) => list(row.reportAssets).some((asset) => asset.id === assetId)); if (trend) onOpenTrend?.(trend.themeId); else onOpenTab?.('trends'); },
    openTarget: ({ kind, id, page } = {}) => { if (kind === 'trend') onOpenTrend?.(id); else if (kind === 'folder') onOpenFolder?.(id); else if (kind === 'page') onOpenTab?.(TABS.includes(page || id) ? page || id : 'trends'); else onOpenTab?.('trends'); },
  };
  const runner = channelAskRunner({ api, state, viewer, canRun, action, confirm, nav, askAdmin, imagesReady, web });
  const name = channel.name || viewer?.channelName || 'your channel';
  const copy = {
    title: 'What can I help with?',
    intro: `Ask about the trends for ${name}, your drafts and your plan, or ask for a draft to copy. Answers use only what your channel can see.`,
    noPictures: list(viewer?.capabilities).includes('makeAssets') ? `Pictures are off for your team. ${askAdmin} can turn them on.` : `Pictures aren’t part of your access. Ask ${askAdmin} if you need them.`,
    placeholder: imagesReady ? 'Ask about your trends and drafts, or describe a picture' : 'Ask about your trends and drafts, or type / for commands',
  };
  return <HelpAssistant api={api} variant="page" open seed={seed} starters={channelStarters(state, { can, imagesReady })} copy={copy} imagesReady={imagesReady} needs={channelNeeds}
    page={{ id: 'channel', label: name, layout: 'channel', tab: lastTab }}
    onOpenPage={(page) => onOpenTab?.(TABS.includes(page) ? page : 'trends')} onAction={runner.runAiAction} state={state} nav={nav} onClose={() => onOpenTab?.('trends')} />;
}
