// "Next up": the one or two things this person should do now, ranked, from the state the studio already pushes. Pure and
// renderer-side (ESM), so Home's rail, the ⌘K palette and tests read the same rows. Every rule is gated by what the role
// can do (`can`, viewer.js), so nobody is told to press a button they don't have; a step that needs someone else says
// who to ask instead.
//
// A row: { id, kind, tone: 'attention' | 'action', title, detail, action: { kind, label, … } }. Action kinds, and what
// the layout does with them:
//   open           { target }    the layout's openTarget({ kind, id, page }), as Inbox rows and share links use
//   write-reports                 the shared Write reports (studio-actions.js), behind its cost confirmation
//   retry          { runId }      Ask AI's retry-run: the cost confirmation, then retryStudioRun
//   make-assets    { assetId }    the Make channel assets dialog on that report
//   copy           { text }       copy a ready-made message (a reminder for a channel)
import { buildTrendBoard } from '../../shared/trend-board.js';

const DAY = 86400000;
const ACTIVE = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const count = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const plural = (value, word, many = `${word}s`) => `${count(value)} ${Number(value) === 1 ? word : many}`;
const quoted = (names, max = 3) => { const shown = names.slice(0, max).map((name) => `“${name}”`); return names.length > max ? `${shown.join(', ')} and ${count(names.length - max)} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] || ''; };
const dayText = (value) => { const ms = time(value); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; };
const localDay = (ms) => { const date = new Date(ms); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const reportOf = (card) => list(card?.reportAssets).find((asset) => asset.deliverableId === 'evidence-report') || list(card?.reportAssets)[0] || null;

export const NEXT_STEP_KINDS = Object.freeze(['stopped', 'decide', 'write-reports', 'make-assets', 'review', 'add-link', 'remind', 'setup']);

/**
 * @param {Object} options
 * @param {Object} options.state  The pushed state (state.contentStudio, state.keys, state.team).
 * @param {Object} [options.viewer]  The viewer (viewer.js).
 * @param {(method: string) => boolean} options.can  Whether this role has the control.
 * @param {Object} [options.board]  The layout's buildTrendBoard result (so a Yes shown a moment ago counts).
 * @param {number} [options.now]
 * @param {string} [options.askAdmin]  Who to ask, in words ("Riley or Sam").
 * @param {string} [options.origin]  The share-link address, for reminder text (deep-links.js shareOrigin).
 * @param {string[]} [options.exclude]  Row kinds the page already shows (Home's Needs your OK card covers 'decide').
 */
export function nextSteps({ state = {}, viewer = {}, can = () => false, board: given = null, now = Date.now(), askAdmin = 'an admin', origin = '', exclude = [] } = {}) {
  const studio = state.contentStudio || {};
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId) || null;
  const mine = (row) => !workspace || !row?.workspaceId || row.workspaceId === workspace.id;
  const researchRuns = list(studio.researchRuns).filter(mine); const contentRuns = list(studio.contentRuns).filter(mine);
  const assets = list(studio.assets).filter(mine); const programs = list(studio.programs).filter(mine);
  const board = given || buildTrendBoard({ researchRuns, contentRuns, assets, programs });
  const skip = new Set(list(exclude));
  const rows = [];
  const add = (row) => { if (!skip.has(row.kind)) rows.push(row); };
  const mayRetry = can('retryStudioRun');

  // 1. Work that stopped: research that found nothing, and report or channel-asset runs from the last week that didn't
  // finish (a later finished run of the same source supersedes one).
  for (const scout of list(board.scouting).filter((row) => row.status === 'failed').slice(0, 2)) {
    add({ id: `stopped:${scout.runId}`, kind: 'stopped', tone: 'attention', title: `Research stopped · ${scout.title}`, detail: [scout.message || scout.error || 'It stopped before any trends were found.', mayRetry ? '' : `Ask ${askAdmin} to try it again.`].filter(Boolean).join(' '),
      action: mayRetry ? { kind: 'retry', runId: scout.runId, label: 'Try again' } : { kind: 'open', target: { kind: 'run', id: scout.runId, page: 'research' }, label: 'See why' } });
  }
  const sourceOf = (run) => run.kit?.sourceKey || run.kit?.reportAssetId || run.themeId || run.id;
  const finishedLater = (run) => contentRuns.some((other) => other !== run && sourceOf(other) === sourceOf(run) && (ACTIVE.has(other.status) || other.status === 'succeeded') && time(other.createdAt) > time(run.createdAt));
  const stoppedRuns = contentRuns.filter((run) => ['failed', 'partial'].includes(run.status) && now - time(run.updatedAt || run.createdAt) < 7 * DAY && !finishedLater(run))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, 2);
  for (const run of stoppedRuns) {
    // A quick scan's trends report that didn't finish: its scan found its trends, and Retry report writes only the report.
    if (run.scanReport) {
      const scan = researchRuns.find((row) => row.id === run.researchRunId);
      const topic = scan?.quickScan?.topic || String(scan?.title || run.title || '').replace(/^Quick scan · /, '');
      add({ id: `stopped:${run.id}`, kind: 'stopped', tone: 'attention', title: `Quick scan report didn’t finish · ${topic}`, detail: mayRetry ? 'The scan found its trends; Retry report writes only the report.' : `Ask ${askAdmin} to write it.`,
        action: mayRetry ? { kind: 'retry', runId: run.id, label: 'Retry report' } : { kind: 'open', target: { kind: 'run', id: scan?.id || run.id, page: 'research' }, label: 'Open' } });
      continue;
    }
    const title = (run.kit && run.kit.sourceTitle) || run.title || 'A run';
    const left = list(run.jobs).filter((job) => job.status !== 'succeeded').length;
    add({ id: `stopped:${run.id}`, kind: 'stopped', tone: 'attention', title: `${run.kit ? 'Channel assets' : 'Writing'} stopped · ${title}`, detail: [left ? `${plural(left, run.kit ? 'asset' : 'output')} didn’t finish.` : 'It didn’t finish.', mayRetry ? 'Finished work is kept.' : `Ask ${askAdmin} to finish it.`].join(' '),
      action: mayRetry ? { kind: 'retry', runId: run.id, label: run.kit ? 'Finish the rest' : 'Try again' } : { kind: 'open', target: run.kit ? { kind: 'folder', id: run.kit.sourceKey || '', page: 'assets' } : { kind: 'run', id: run.id, page: 'create' }, label: 'Open' } });
  }

  // 2. Trends waiting for this person's OK.
  const waiting = list(board.cards).filter((card) => card.stage === 'potential' && card.canDecide);
  if (waiting.length && can('decideResearchTheme')) add({ id: 'decide', kind: 'decide', tone: 'action', title: `${plural(waiting.length, 'trend')} need${waiting.length === 1 ? 's' : ''} your OK`, detail: quoted(waiting.map((card) => card.name)), action: { kind: 'open', target: { kind: 'page', page: 'trends' }, label: 'Review' } });

  // 3. Approved trends waiting for Write reports (a role needs Approve trends and Start research to write them).
  const approved = list(board.cards).filter((card) => card.stage === 'approved' && card.canDecide);
  if (approved.length && can('approveResearchThemes') && can('continueResearchRun')) add({ id: 'write-reports', kind: 'write-reports', tone: 'action', title: `${plural(approved.length, 'approved trend')} ${approved.length === 1 ? 'is' : 'are'} waiting for reports`, detail: `${quoted(approved.map((card) => card.name))}. You’ll see the cost first.`, action: { kind: 'write-reports', label: 'Write reports' } });

  // 4. A trends report ready for a day or more with no channel assets made from it.
  if (can('planAssetKit') && can('createAssetKit')) {
    const kits = contentRuns.filter((run) => run.kit);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const readyAt = (card) => list(card.reportAssets).map((row) => assetById.get(row.id)?.createdAt).filter(Boolean).sort().at(-1) || card.discoveredAt || '';
    const bare = list(board.cards).filter((card) => card.stage === 'ready' && reportOf(card) && now - time(readyAt(card)) >= DAY
      && !kits.some((run) => run.kit.themeId === card.themeId || list(card.reportAssets).some((asset) => asset.id === run.kit.reportAssetId)))
      .sort((a, b) => time(readyAt(b)) - time(readyAt(a)));
    if (bare.length) add({ id: `make-assets:${bare[0].themeId}`, kind: 'make-assets', tone: 'action', title: `Make channel assets for “${bare[0].name}”`, detail: `Its trends report has been ready since ${dayText(readyAt(bare[0]))}, with no channel assets yet.${bare.length > 1 ? ` ${plural(bare.length - 1, 'other trend')} too.` : ''}`, action: { kind: 'make-assets', assetId: reportOf(bare[0]).id, label: 'Make channel assets' } });
  }

  // 5. Assets someone moved to In review.
  // A channel-asset file opens its Assets folder and a picture opens Assets (Simple's Reports lists neither); a report
  // opens in Reports.
  const inReview = assets.filter((asset) => asset.review?.status === 'in-review').sort((a, b) => time(b.review?.at) - time(a.review?.at));
  if (inReview.length && can('setAssetStatus')) {
    const kitOf = new Map(contentRuns.filter((run) => run.kit).map((run) => [run.id, run.kit]));
    const first = inReview[0]; const kit = kitOf.get(first.runId);
    const target = kit ? { kind: 'folder', id: kit.sourceKey || '', page: 'assets' } : first.kind === 'image' ? { kind: 'page', page: 'assets' } : { kind: 'report', id: first.id, page: 'reports' };
    add({ id: 'review', kind: 'review', tone: 'action', title: `${plural(inReview.length, 'asset')} ${inReview.length === 1 ? 'is' : 'are'} In review`, detail: quoted(inReview.map((asset) => asset.title || 'Untitled'), 2), action: { kind: 'open', target, label: 'Review' } });
  }

  // 6. A channel's planned date has passed and there's no link yet. 7. Channels that answer, but not on a recent brief.
  const adoptions = studio.adoptionsByTheme || {};
  const nameOf = (themeId) => list(board.cards).find((card) => card.themeId === themeId)?.name || list(studio.themes).find((row) => row.id === themeId)?.name || 'a trend';
  const today = localDay(now);
  const missed = [];
  for (const [themeId, byChannel] of Object.entries(adoptions)) for (const [channelId, row] of Object.entries(byChannel || {})) if (row?.status === 'using' && /^\d{4}-\d{2}-\d{2}$/.test(String(row.plannedFor || '')) && row.plannedFor < today && !row.link) missed.push({ themeId, channelId, channel: row.channelName || channelId, plannedFor: row.plannedFor });
  // Only Analytics' Change answer (admins) can add a link for a channel; anyone else copies a reminder for the channel.
  if (missed.length && can('setTrendAdoption')) {
    const first = missed.sort((a, b) => a.plannedFor.localeCompare(b.plannedFor))[0];
    const trend = nameOf(first.themeId); const day = dayText(`${first.plannedFor}T12:00:00`);
    const admin = (viewer.realRole || viewer.role || 'admin') === 'admin' && !viewer.preview;
    const fix = admin && can('getTrendAnalytics')
      ? { detail: missed.length === 1 ? `Open ${first.channel}’s cell for “${trend}” in Analytics and add the link under Change answer, so the team sees it under Shipped.` : 'Open each one’s cell in Analytics and add the link under Change answer, so the team sees it under Shipped.', action: { kind: 'open', target: { kind: 'page', page: 'analytics' }, label: 'Open Analytics' } }
      : { detail: 'Ask the channel to add the link once it’s live, so the team sees it under Shipped.', action: { kind: 'copy', text: `${first.channel}: “${trend}” was planned for ${day}. Add the live link in the studio.${origin ? ` ${origin}` : ''}`, label: 'Copy reminder', done: 'Reminder copied. Paste it to the channel.' } };
    add({ id: 'add-link', kind: 'add-link', tone: 'action', title: missed.length === 1 ? `${first.channel} planned “${trend}” for ${day}. No link yet` : `${plural(missed.length, 'planned date')} passed with no link yet`, ...fix });
  }
  if (can('saveSettings')) {
    const answering = new Set(Object.values(adoptions).flatMap((byChannel) => Object.keys(byChannel || {})));
    const channelName = new Map(Object.values(adoptions).flatMap((byChannel) => Object.entries(byChannel || {}).map(([id, row]) => [id, row?.channelName || id])));
    const late = new Map();
    for (const card of list(board.cards).filter((row) => row.stage === 'ready' && reportOf(row))) {
      const ready = list(card.reportAssets).map((row) => assets.find((asset) => asset.id === row.id)?.createdAt).filter(Boolean).sort().at(-1) || card.discoveredAt;
      if (!(now - time(ready) >= 3 * DAY)) continue;
      const routed = list(list(researchRuns).find((run) => run.id === card.runId)?.decisionsBy?.[card.themeId]?.channels);
      for (const channelId of answering) if ((!routed.length || routed.includes(channelId)) && !adoptions[card.themeId]?.[channelId]) late.set(channelId, [...(late.get(channelId) || []), card.name]);
    }
    const [channelId, names] = [...late.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
    if (channelId) { const channel = channelName.get(channelId) || channelId; add({ id: `remind:${channelId}`, kind: 'remind', tone: 'action', title: `${channel} hasn’t answered on ${plural(names.length, 'trend')}`, detail: `${quoted(names, 2)}, ready 3 or more days.`, action: { kind: 'copy', text: `${plural(names.length, 'trend is', 'trends are')} waiting for ${channel}: ${quoted(names, 5)}.${origin ? ` ${origin}` : ''}`, label: 'Copy reminder', done: 'Reminder copied. Paste it to the channel.' } }); }
  }

  // 8. Setup that blocks research.
  if (state.keys && !state.keys.APIFY_API_TOKEN && can('saveSettings')) add({ id: 'setup:apify', kind: 'setup', tone: 'attention', title: 'Connect Apify to start collecting', detail: 'Research reads posts through your Apify account. It takes about a minute in Settings.', action: { kind: 'open', target: { kind: 'page', page: 'settings', section: 'sources' }, label: 'Open Settings' } });

  return rows;
}

// Settings' Check connections passed on the route research uses now (a check of another route doesn't count).
const aiChecked = (settings = {}) => Boolean(settings?.lastAiCheck?.ok) && (!settings.lastAiCheck.provider || settings.lastAiCheck.provider === (settings.aiProvider || 'auto'));

// The setup checklist on Home for an admin standing a studio up: what's done, what's next, each with the one place
// that does it. `team` is getTeam()'s answer when it was read (the browser studio), for invites and channel owners.
export function setupChecklist({ state = {}, web = false, team = null, channels = [] } = {}) {
  const studio = state.contentStudio || {};
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId) || null;
  const mine = (row) => !workspace || !row?.workspaceId || row.workspaceId === workspace.id;
  const runs = [...list(studio.researchRuns), ...list(studio.contentRuns)].filter(mine);
  const members = list(team?.members);
  const owned = new Set(members.filter((member) => member.channelId && !member.disabled).map((member) => member.channelId));
  const covered = channels.filter((channel) => owned.has(channel.id)).length;
  const items = [
    { id: 'apify', label: 'Connect Apify', detail: 'Research collects posts through it.', done: Boolean(state.keys?.APIFY_API_TOKEN), action: { kind: 'open', target: { kind: 'page', page: 'settings', section: 'sources' }, label: 'Open Settings' } },
    { id: 'ai', label: state.settings?.aiProvider === 'codex' ? 'Check that Codex works' : 'Check that Claude works', detail: 'Check connections in Settings tries the route research uses.', done: aiChecked(state.settings) || runs.some((run) => ['succeeded', 'partial', 'awaiting-review'].includes(run.status)), action: { kind: 'open', target: { kind: 'page', page: 'settings', section: 'ai' }, label: 'Check in Settings' } },
    { id: 'program', label: 'Save your first research program', detail: 'The accounts and communities research follows.', done: list(studio.programs).some(mine), action: { kind: 'create', create: 'program', label: 'New program' } },
    ...(web ? [
      { id: 'team', label: 'Invite your editors', detail: 'They say yes to trends and write reports.', done: (Number(state.team?.memberCount) || members.length) > 1, action: { kind: 'create', create: 'person', label: 'Invite people' } },
      ...(team && channels.length ? [{ id: 'owners', label: `Give each channel an owner (${count(covered)} of ${count(channels.length)})`, detail: 'Channel owners get the briefs and say what they used.', done: covered >= channels.length, action: { kind: 'open', target: { kind: 'page', page: 'people' }, label: 'Open People & access' } }] : []),
    ] : []),
    { id: 'pictures', label: 'Turn on pictures', detail: 'Optional. Hero graphics for channel assets and Ask AI.', optional: true, done: Boolean(state.keys?.OPENAI_API_KEY) || Boolean(studio.capabilities?.imagesConfigured), action: { kind: 'open', target: { kind: 'page', page: 'settings', section: 'ai' }, label: 'Open Settings' } },
    ...(!web ? [{ id: 'address', label: 'Add the Studio web address', detail: 'Optional. Share links and the Slack briefing then link into the browser studio.', optional: true, done: Boolean(state.settings?.studioWebAddress), action: { kind: 'open', target: { kind: 'page', page: 'settings', section: 'web-address' }, label: 'Open Settings' } }] : []),
  ];
  const required = items.filter((item) => !item.optional);
  return { items, done: items.filter((item) => item.done).length, total: items.length, complete: required.every((item) => item.done), allDone: items.every((item) => item.done) };
}
