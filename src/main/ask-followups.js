'use strict';
// Ask AI follow-ups (SPEC-3): when work started from an Ask AI conversation gets somewhere worth knowing (a quick scan's
// trends report, a research run's trends waiting for an OK, its finished reports, a stop), the studio posts it into that
// conversation by itself: a short message with cards and buttons, written here from the run's own records. No AI call,
// so a follow-up is free. Buttons are kept only when the person's role runs them, and money shows only to people who see
// costs. content-workspace.js raises the events (its onRunEvent option); index.js wires them to post().
//
// createAskFollowUps({ askStore, reachFor, push, log }) → { post(event), compose(event, reach) }
//   askStore  ask-store.js (appendFollowUp)
//   reachFor  (identityId) → { role, allowed, hiddenPages, costs, drive, admin } | null (null: removed or turned off)
//   push      (identityId, { type: 'followup', conversationId, messageId }) tells that person's open windows (optional)
// event: { type, key, identityId, conversationId, programName, run (publicRun), report?, reports?, error?, attempt? }
const help = require('./help-assistant');
const { windowLabel } = require('../shared/research-scan-report');

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (value == null ? '' : String(value));
const oneLine = (value, max = 300) => { const line = text(value).replace(/\s+/g, ' ').trim(); return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line; };
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const day = (value) => text(value).slice(0, 10);
const TIER_RANK = { 'FAST-TRACK': 0, STRONG: 1, MONITOR: 2, LOW: 3 };
const SHOWN_TRENDS = 3;
// Square brackets would break the [label](studio:…) link Markdown.
const linkLabel = (value) => oneLine(value, 160).replace(/[[\]]/g, '');

const themesOf = (run) => (list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes)).filter((theme) => theme && theme.id && theme.name);
const byPriority = (themes) => [...themes].sort((a, b) => (TIER_RANK[a.scoring?.priorityTier] ?? 4) - (TIER_RANK[b.scoring?.priorityTier] ?? 4));
const topicOf = (run) => oneLine(run.quickScan?.topic || text(run.title).replace(/^Quick scan · /, ''), 160) || 'this topic';
const postsOf = (run) => Number(run.counts?.retained ?? run.coverage?.retainedCount) || 0;
// A full run's window in words: "Oct 10 to Oct 17", or the quick scan's "the last 6 hours".
function runWindow(run) {
  if (run.origin === 'quick-scan') return windowLabel(run.quickScan?.lookbackHours);
  const start = day(run.window?.startDate); const end = day(run.window?.endDate);
  return start ? `${start}${end && end !== start ? ` to ${end}` : ''}` : 'its window';
}

// ---------- Cards (the renderer contract: { type, title, note, data, actionIndexes }) ----------
function trendCard(run, theme, { stage = '', actionIndexes = [] } = {}) {
  const at = day(run.createdAt);
  return {
    type: 'trend', title: oneLine(theme.name, 120), note: '', actionIndexes,
    data: {
      themeId: theme.id, runId: run.id, name: oneLine(theme.name, 160), category: theme.scoring?.taxonomy?.category && theme.scoring.taxonomy.category !== 'UNMAPPED' ? theme.scoring.taxonomy.category : text(theme.taxonomyCategory),
      momentum: '', priorityTier: text(theme.scoring?.priorityTier), stage, evidenceCount: Number(theme.evidenceCount ?? list(theme.evidenceIds).length) || 0, platforms: list(theme.platforms),
      runsSeen: 1, firstSeen: at, lastSeen: at, spark: [], reportAssetId: '', summary: oneLine(theme.description, 300), ...(run.origin === 'quick-scan' ? {} : { runLabel: oneLine(run.title, 80) }),
    },
  };
}
function reportCard({ assetId, title, summary = '', createdAt = '', kind = 'scan-report', trendName = '' }, actionIndexes = []) {
  return { type: 'report', title: oneLine(title, 120), note: '', actionIndexes, data: { assetId, title: oneLine(title, 200), kind, date: day(createdAt), trendName: oneLine(trendName, 160), excerpt: oneLine(summary, 240), status: 'draft' } };
}
function runCard(run, { costs, actionIndexes = [] } = {}) {
  return {
    type: 'run', title: oneLine(run.title, 120), note: '', actionIndexes,
    data: { runId: run.id, kind: run.origin === 'quick-scan' ? 'quick-scan' : run.type === 'research' ? 'research' : run.kit ? 'kit' : 'content', title: oneLine(run.title, 160), status: text(run.status), stage: text(run.stage), message: oneLine(run.message, 300), startedAt: text(run.createdAt), ...(costs ? { costUsd: Number(run.costUsd) || 0, budgetUsd: Number(run.maxBudgetUsd) || 0 } : {}), progress: null, themes: themesOf(run).slice(0, 6).map((theme) => oneLine(theme.name, 120)), programId: text(run.programId) },
  };
}

// ---------- Messages, one per event ----------
// Each draft returns { content, actions, cards, followUps, receipt }; a card's actionIndexes point into actions.
const DRAFTS = {
  'scan-report-ready'(event, { costs }) {
    const run = event.run; const report = event.report || {}; const topic = topicOf(run); const themes = byPriority(themesOf(run));
    const actions = [
      { kind: 'open', label: 'Open the report', target: report.title, params: { type: 'report' }, ref: { kind: 'report', id: report.assetId }, assetId: report.assetId, title: report.title },
      { kind: 'make-assets', label: 'Make channel assets from it', target: report.title, assetId: report.assetId, title: report.title },
      ...(run.programId && event.programName ? [{ kind: 'start-research', label: `Run full research with “${oneLine(event.programName, 60)}”`, target: event.programName, programId: run.programId, title: event.programName }] : []),
    ];
    const link = report.assetId ? `[${linkLabel(report.title || 'the trends report')}](studio:report/${report.assetId})` : `“${oneLine(report.title)}”`;
    return {
      content: `**Quick scan finished: “${topic}”** · ${runWindow(run)}\n\n${oneLine(report.summary, 600) || 'Here is what it found.'}\n\nIt found ${plural(themes.length, 'trend')} in ${plural(postsOf(run), 'post')}. The write-up is in ${link}.`,
      actions,
      cards: [reportCard({ ...report, createdAt: report.createdAt || run.updatedAt || run.createdAt }, [0, 1]), ...themes.slice(0, SHOWN_TRENDS).map((theme) => trendCard(run, theme))],
      followUps: themes[0] ? [`What’s driving “${oneLine(themes[0].name, 80)}”?`, `Show me real posts about “${oneLine(themes[0].name, 80)}”`, 'What should I do with this?'] : ['What should I do with this?'],
      receipt: costs ? { costUsd: Number(run.costUsd) || 0, model: text(report.model), route: text(report.route) } : null,
    };
  },
  'scan-report-failed'(event, { costs }) {
    const run = event.run; const topic = topicOf(run); const themes = byPriority(themesOf(run));
    const childId = text(run.scanReport?.runId);
    let why = oneLine(event.error || run.scanReport?.error, 300);
    // The AI cap, in dollars, is for people who see costs.
    if (!costs && /\$\d/.test(why)) why = 'The scan’s AI cap doesn’t cover the report.';
    const actions = childId ? [{ kind: 'retry-run', label: 'Retry report', target: oneLine(run.title, 160), runId: childId, title: 'Quick scan trends report' }] : [];
    return {
      content: `**Quick scan finished: “${topic}”** · ${runWindow(run)}\n\nIts short trends report didn’t finish${why ? `: ${why.replace(/[.\s]+$/, '')}` : ''}.\n\nThe ${plural(themes.length, 'trend')} it found are below. **Retry report** writes only the report; the posts aren’t collected again.`,
      actions,
      cards: [...themes.slice(0, SHOWN_TRENDS).map((theme) => trendCard(run, theme)), runCard(run, { costs, actionIndexes: actions.length ? [0] : [] })],
      followUps: themes[0] ? [`What’s driving “${oneLine(themes[0].name, 80)}”?`] : [],
      receipt: null,
    };
  },
  'scan-finished'(event, { costs }) {
    const run = event.run; const themes = byPriority(themesOf(run));
    const actions = run.programId && event.programName ? [{ kind: 'start-research', label: `Run full research with “${oneLine(event.programName, 60)}”`, target: event.programName, programId: run.programId, title: event.programName }] : [];
    return { content: `**Quick scan finished: “${topicOf(run)}”** · ${runWindow(run)}\n\n${oneLine(run.message, 600)}`, actions, cards: [...themes.slice(0, SHOWN_TRENDS).map((theme) => trendCard(run, theme)), runCard(run, { costs })], followUps: themes[0] ? [`What’s driving “${oneLine(themes[0].name, 80)}”?`] : [], receipt: null };
  },
  'scan-empty'(event, { costs }) {
    const run = event.run; const topic = topicOf(run);
    return { content: `**Quick scan finished: “${topic}”** · ${runWindow(run)}\n\n${oneLine(run.message, 600)}`, actions: [], cards: [runCard(run, { costs })], followUps: [`Plan a longer scan on ${topic}`], receipt: null };
  },
  'run-stopped'(event, { costs }) {
    const run = event.run;
    const actions = [{ kind: 'retry-run', label: 'Try again', target: oneLine(run.title, 160), runId: run.id, title: oneLine(run.title, 160) }];
    return { content: `**“${oneLine(run.title, 160)}” stopped.** ${oneLine(text(run.message).split('\n')[0], 300)}\n\nFinished steps are kept, so trying again doesn’t pay for them twice.`, actions, cards: [runCard(run, { costs, actionIndexes: [0] })], followUps: ['Why did it stop?'], receipt: null };
  },
  'trends-ready'(event) {
    const run = event.run; const themes = byPriority(themesOf(run)); const shown = themes.slice(0, SHOWN_TRENDS);
    const program = oneLine(event.programName || run.title, 120);
    const actions = []; const cards = [];
    for (const theme of shown) {
      const yes = actions.push({ kind: 'approve-trend', label: 'Yes', target: theme.name, runId: run.id, themeId: theme.id, title: theme.name }) - 1;
      const skip = actions.push({ kind: 'pass-trend', label: 'Skip', target: theme.name, runId: run.id, themeId: theme.id, title: theme.name }) - 1;
      cards.push(trendCard(run, theme, { stage: 'waiting', actionIndexes: [yes, skip] }));
    }
    actions.push({ kind: 'write-reports', label: 'Write reports for the ones you said yes to', target: '', params: {}, runId: run.id });
    if (themes.length > SHOWN_TRENDS) actions.push({ kind: 'open-tab', label: `See all ${themes.length} on Trends`, target: 'trends' });
    return {
      content: `**“${program}” found ${plural(themes.length, 'trend')}** in ${plural(postsOf(run), 'post')} from ${runWindow(run)}. They need your OK before any reports are written: say Yes or Skip to each, then **Write reports** shows the cost first.`,
      actions, cards, followUps: shown[0] ? ['Which of these should I say yes to?', `What’s driving “${oneLine(shown[0].name, 80)}”?`] : [], receipt: null,
    };
  },
  'no-trends'(event, { costs }) {
    const run = event.run;
    return { content: `**“${oneLine(run.title, 160)}” finished** without specific trends this time. ${oneLine(run.message, 300)}`, actions: [], cards: [runCard(run, { costs })], followUps: ['How can I widen the search?'], receipt: null };
  },
  'reports-ready'(event, { costs }) {
    const run = event.run; const reports = list(event.reports).filter((row) => row?.assetId).slice(0, SHOWN_TRENDS);
    const actions = []; const cards = [];
    for (const report of reports) {
      const at = actions.push({ kind: 'make-assets', label: 'Make channel assets', target: report.title, assetId: report.assetId, title: report.title }) - 1;
      cards.push(reportCard({ ...report, kind: 'evidence-report', trendName: report.themeName }, [at]));
    }
    actions.push({ kind: 'open-tab', label: 'See all reports', target: 'reports' });
    const count = list(event.reports).length;
    return { content: `**Reports are ready** for ${plural(count, 'trend')} from “${oneLine(event.programName || run.title, 120)}”.`, actions, cards, followUps: reports[0] ? [`Summarize “${oneLine(reports[0].themeName || reports[0].title, 80)}” for Slack`] : [], receipt: costs ? { costUsd: Number(run.costUsd) || 0, model: '', route: '' } : null };
  },
};

function createAskFollowUps({ askStore, reachFor, push, log = console } = {}) {
  if (!askStore || typeof askStore.appendFollowUp !== 'function') throw new Error('Ask AI follow-ups need the Ask AI store.');
  // The message for one event as this person may see it: buttons their role runs (renumbered for the cards), no money
  // unless they see costs. null for an event with no message.
  function compose(event = {}, reach = {}) {
    const draft = DRAFTS[event.type];
    if (!draft || !event.run?.id) return null;
    const costs = reach?.costs !== false;
    const out = draft(event, { costs });
    const kinds = new Set(Object.keys(help.actionsFor(help.promptRights(null), help.reachOf(reach || {}), reach?.role || 'admin')));
    const at = new Map(); const actions = [];
    out.actions.forEach((action, index) => { if (action && kinds.has(action.kind)) { at.set(index, actions.length); actions.push(action); } });
    const cards = out.cards.filter(Boolean).map((card) => ({ ...card, actionIndexes: list(card.actionIndexes).map((index) => at.get(index)).filter(Number.isInteger) }));
    return { content: out.content, pages: [], followUps: list(out.followUps).filter(Boolean).slice(0, 3), actions, cards: cards.slice(0, 6), receipt: costs ? out.receipt || null : null, followUp: { event: event.type, runId: event.run.id } };
  }
  // Post one event's message to the conversation the run was started from. Returns { messageId } (also for a repeat of
  // an event already posted) or null: the person was removed or turned off, or the conversation was deleted.
  function post(event = {}) {
    if (!event.identityId || !event.conversationId || !event.run?.id) return null;
    let reach = null; try { reach = reachFor ? reachFor(event.identityId) : null; } catch (_) { reach = null; }
    if (!reach) return null;
    const message = compose(event, reach);
    if (!message) return null;
    let saved = null;
    try { saved = askStore.appendFollowUp(event.identityId, { conversationId: event.conversationId, key: `${event.run.id}:${event.key || event.type}`, message }); }
    catch (error) { log?.error?.(`An Ask AI follow-up couldn’t be saved: ${String(error?.message || error).slice(0, 300)}`); return null; }
    if (!saved?.messageId) return null;
    if (!saved.duplicate && typeof push === 'function') {
      try { push(event.identityId, { type: 'followup', conversationId: saved.conversationId || event.conversationId, messageId: saved.messageId }); } catch (_) { /* The message is saved; the conversation shows it when it is opened again. */ }
    }
    return { messageId: saved.messageId };
  }
  return { post, compose };
}

module.exports = { createAskFollowUps, FOLLOW_UP_EVENTS: Object.freeze(Object.keys(DRAFTS)) };
