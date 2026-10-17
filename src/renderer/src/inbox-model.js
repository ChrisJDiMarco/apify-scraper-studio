// Inbox: what changed that this person should know about, derived on the client from the state the studio already
// pushes (no new service, no polling). Pure ESM, so tests and both layouts share it.
//
// buildInbox({ state, viewer, seenAt, now? }) → { items, unread }
//   item = { id, kind, title, detail, at, target: { kind, id, page }, unread }
//   kind: 'needs-ok' | 'adoption' | 'edit' | 'run-finished' | 'run-stopped' | 'prompt-change' | 'routed'
//   target.kind: 'trend' | 'report' | 'run' | 'folder' | 'prompt' | 'page' (page: a page id such as 'trends')
// Unread means newer than prefs.inboxSeenAt (the last 7 days before it was ever set). Rows are newest first, from the
// last 30 days, at most 60.

export const INBOX_DAYS = 30;
export const INBOX_LIMIT = 60;
const DAY = 86400000;
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const quote = (value) => `“${String(value || 'Untitled').trim()}”`;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
// "2026-10-20" → "Tue, Oct 20", as My plan and the Calendar word it (a local calendar day, never a day early west of UTC).
const plannedDay = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : String(day || ''));
const ACTIVE = new Set(['queued', 'running']);
const STOPPED = new Set(['failed', 'partial', 'cancelled']);
const REPORT_DELIVERABLES = new Set(['evidence-report', 'editorial-toolkit']);
// A stop only an admin can fix (a key, a sign-in, a setting, the account's credit), as channel-view.js words it.
const NEEDS_ADMIN = /(api[\s_-]?keys?|\bkeys?\b|\bsettings\b|\btokens?\b|\blog(?:ged)?[\s-]?in\b|\bsign(?:ed)?[\s-]?in\b|\bcredentials?\b|\bunauthori[sz]ed\b|\bauthenticat|\bcredits?\b|\bbilling\b)/i;
// What the role has (in an admin's preview, the previewed role's controls), without importing React.
const allows = (viewer, method) => !viewer?.allowed || (Array.isArray(viewer.roleAllowed) ? viewer.roleAllowed : viewer.allowed).includes(method);
const firstLine = (value, max = 110) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text; };
const shortDay = (value) => { const ms = time(value); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { weekday: 'short' }) : ''; };
const adminWord = (state) => { const names = list(state?.team?.admins).map((row) => (typeof row === 'string' ? row : row?.name)).filter(Boolean); return names[0] || 'an admin'; };

export function buildInbox({ state = {}, viewer = {}, seenAt = '', now = Date.now() } = {}) {
  const studio = state.contentStudio || {};
  const workspaceId = studio.activeWorkspaceId || '';
  const mine = (row) => !workspaceId || !row?.workspaceId || row.workspaceId === workspaceId;
  const since = now - INBOX_DAYS * DAY;
  const items = [];
  const push = (item) => { const at = time(item.at); if (!Number.isFinite(at) || at < since || at > now + 5 * 60000) return; items.push({ detail: '', ...item, at: new Date(at).toISOString() }); };
  const me = String(viewer?.id || '');
  const askAdmin = adminWord(state);

  // A channel owner's inbox comes from their channel's view: new trends (routed to them, or to everyone) and their sets.
  if (studio.channelView) {
    const view = studio.channelView; const channel = view.channel?.name || 'your channel';
    for (const trend of list(view.trends)) {
      if (!trend.isNew && !trend.forUs) continue;
      const by = trend.suggestion?.byName || '';
      push({ id: `routed:${trend.themeId}`, kind: 'routed', at: trend.readyAt,
        title: trend.forUs && by ? `${by} suggested ${quote(trend.name)} for ${channel}` : `New trend for ${channel}: ${quote(trend.name)}`,
        detail: trend.suggestion?.note ? `“${firstLine(trend.suggestion.note, 140)}”` : 'Read the brief, then say whether you’re using it.',
        target: { kind: 'trend', id: trend.themeId, page: 'trends' } });
    }
    for (const run of list(view.runs)) {
      if (ACTIVE.has(run.status)) continue;
      const at = run.finishedAt || run.createdAt;
      if (run.status === 'succeeded') push({ id: `run:${run.id}`, kind: 'run-finished', at, title: `Drafts ready · ${quote(run.title)}`, detail: run.message || '', target: { kind: 'folder', id: run.kit?.themeId || run.id, page: 'assets' } });
      else if (STOPPED.has(run.status)) push({ id: `run:${run.id}`, kind: 'run-stopped', at, title: `Drafts stopped · ${quote(run.title)}`, detail: run.needsAdmin ? `${run.message || 'The AI connection needs attention.'}` : run.message || 'Some drafts didn’t finish. Finish the rest on Trends.', target: { kind: 'trend', id: run.kit?.themeId || '', page: 'trends' } });
    }
  } else {
    const researchRuns = list(studio.researchRuns).filter(mine);
    const contentRuns = list(studio.contentRuns).filter(mine);
    const assets = list(studio.assets).filter(mine);
    const programName = (run) => list(studio.programs).find((program) => program.id === run.programId)?.name || '';
    const canDecide = allows(viewer, 'decideResearchTheme');

    // Trends waiting for a yes or a skip, one row per research run.
    for (const run of researchRuns) {
      if (run.origin === 'quick-scan') continue;
      const discovered = list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes);
      if (run.status === 'awaiting-review' && canDecide) {
        const waiting = discovered.filter((theme) => !['approved', 'passed'].includes(run.decisions?.[theme.id]));
        if (waiting.length) push({ id: `needs-ok:${run.id}`, kind: 'needs-ok', at: run.updatedAt || run.createdAt, title: `${plural(waiting.length, 'trend needs', 'trends need')} your OK`, detail: [programName(run) || run.title, shortDay(run.createdAt) ? `${shortDay(run.createdAt)}’s run` : ''].filter(Boolean).join(' · '), target: { kind: 'trend', id: waiting[0].id, page: 'trends' } });
      }
      const at = run.updatedAt || run.createdAt;
      if (run.status === 'succeeded') push({ id: `run:${run.id}`, kind: 'run-finished', at, title: `Research run finished · ${plural(discovered.length, 'trend')}`, detail: programName(run) || run.title || '', target: { kind: 'page', id: run.id, page: 'trends' } });
      else if (STOPPED.has(run.status) && !(run.status === 'cancelled' && !discovered.length && run.createdBy?.id === me)) {
        const message = typeof run.error === 'string' ? run.error : run.error?.message || run.message || '';
        push({ id: `run:${run.id}`, kind: 'run-stopped', at, title: `Research run stopped${message ? `: ${firstLine(message, 70)}` : ''}`, detail: [programName(run) || run.title, NEEDS_ADMIN.test(message) && !allows(viewer, 'saveSettings') ? `ask ${askAdmin}` : ''].filter(Boolean).join(' · '), target: { kind: 'run', id: run.id, page: 'research' } });
      }
    }
    // Quick scans finish with a pulse rather than trends to decide; one that wrote its short trends report opens it.
    for (const run of researchRuns.filter((row) => row.origin === 'quick-scan' && row.status === 'succeeded')) {
      const found = list(run.discoveredThemes).length; const topic = run.quickScan?.topic ? quote(run.quickScan.topic) : run.title || '';
      const report = run.scanReport || null; const ready = report?.status === 'succeeded' && report.assetId && assets.some((asset) => asset.id === report.assetId);
      if (ready) push({ id: `run:${run.id}`, kind: 'run-finished', at: run.updatedAt || run.createdAt, title: `Quick scan report ready · ${topic}`, detail: plural(found, 'trend'), target: { kind: 'report', id: report.assetId, page: 'reports' } });
      else push({ id: `run:${run.id}`, kind: 'run-finished', at: run.updatedAt || run.createdAt, title: `Quick scan finished · ${topic}`, detail: [found ? plural(found, 'trend') : 'No clear trends this time', report && ['failed', 'cancelled'].includes(report.status) ? 'its trends report didn’t finish' : ''].filter(Boolean).join(' · '), target: { kind: 'run', id: run.id, page: 'research' } });
    }
    // Reports written, channel-asset sets and Create content drafts.
    const assetsByRun = new Map();
    for (const asset of assets) { const rows = assetsByRun.get(asset.runId) || []; rows.push(asset); assetsByRun.set(asset.runId, rows); }
    for (const run of contentRuns) {
      // A quick scan's trends report is told on its scan's row.
      if (ACTIVE.has(run.status) || run.scanReport) continue;
      const at = run.updatedAt || run.createdAt; const files = assetsByRun.get(run.id) || [];
      const report = files.find((asset) => asset.deliverableId === 'evidence-report') || files.find((asset) => REPORT_DELIVERABLES.has(asset.deliverableId)) || null;
      if (run.status === 'succeeded') {
        if (run.kit) push({ id: `run:${run.id}`, kind: 'run-finished', at, title: `Channel assets ready · ${quote(run.kit.sourceTitle || run.title)}`, detail: plural(files.length, 'file'), target: { kind: 'folder', id: run.kit.sourceKey || '', page: 'assets' } });
        else if (run.themeId && report) push({ id: `run:${run.id}`, kind: 'run-finished', at, title: `Report ready · ${quote(run.title)}`, detail: files.length > 1 ? 'Trends report and editorial toolkit' : 'Trends report', target: { kind: 'report', id: report.id, page: 'reports' } });
        // A written draft opens in Reports; a set of pictures alone opens Assets (App's router sends a picture there).
        else if (files[0]) push({ id: `run:${run.id}`, kind: 'run-finished', at, title: `Drafts ready · ${quote(run.title)}`, detail: plural(files.length, 'file'), target: { kind: 'report', id: (files.find((file) => file.kind !== 'image' && file.kind !== 'video') || files[0]).id, page: 'reports' } });
      } else if (STOPPED.has(run.status) && !(run.status === 'cancelled' && run.createdBy?.id === me)) {
        const message = run.message || '';
        push({ id: `run:${run.id}`, kind: 'run-stopped', at, title: `${run.kit ? 'Channel assets' : run.themeId ? 'Report' : 'Drafts'} stopped · ${quote(run.kit?.sourceTitle || run.title)}`, detail: [firstLine(message, 90), NEEDS_ADMIN.test(message) && !allows(viewer, 'saveSettings') ? `ask ${askAdmin}` : ''].filter(Boolean).join(' · '), target: run.kit ? { kind: 'folder', id: run.kit.sourceKey || '', page: 'assets' } : { kind: 'run', id: run.id, page: 'create' } });
      }
    }
    // Someone else edited or restored a report, a draft or a channel asset. These rows carry the asset id; App's router
    // opens a channel asset in its Assets folder (Simple) or the Library (Advanced).
    const kitRunIds = new Set(contentRuns.filter((run) => run.kit).map((run) => run.id));
    for (const asset of assets) {
      const row = asset.edited?.at ? { ...asset.edited, verb: 'edited' } : asset.restored?.at ? { ...asset.restored, verb: 'restored the original of' } : null;
      if (row && row.by?.id !== me) push({ id: `edit:${asset.id}:${row.at}`, kind: 'edit', at: row.at, title: `${row.by?.name || row.byName || 'Someone'} ${row.verb} ${quote(asset.title)}`, detail: REPORT_DELIVERABLES.has(asset.deliverableId) ? (asset.deliverableId === 'evidence-report' ? 'Trends report' : 'Editorial toolkit') : kitRunIds.has(asset.runId) ? 'Channel asset' : 'Draft', target: { kind: 'report', id: asset.id, page: 'reports' } });
      const review = asset.review;
      if (review?.at && review.by?.id !== me && review.status === 'published') push({ id: `status:${asset.id}:${review.at}`, kind: 'adoption', at: review.at, title: `${review.by?.name || 'Someone'} published ${quote(asset.title)}`, detail: review.link || '', target: { kind: 'report', id: asset.id, page: 'reports' } });
    }
    // Channels that used (or passed on) a trend.
    const trendName = (themeId) => {
      for (const run of researchRuns) { const theme = [...list(run.themes), ...list(run.discoveredThemes)].find((row) => row?.id === themeId); if (theme?.name) return theme.name; }
      return list(studio.themes).find((row) => row.id === themeId)?.name || 'a trend';
    };
    for (const [themeId, byChannel] of Object.entries(studio.adoptionsByTheme || {})) {
      for (const [channelId, row] of Object.entries(byChannel || {})) {
        if (!row?.at || !['using', 'not-using'].includes(row.status)) continue;
        const channel = row.channelName || channelId;
        push({ id: `adoption:${themeId}:${channelId}:${row.at}`, kind: 'adoption', at: row.at, title: row.status === 'using' ? `${channel} used ${quote(trendName(themeId))}` : `${channel} passed on ${quote(trendName(themeId))}`, detail: row.status === 'using' ? row.link || (row.plannedFor ? `Planned for ${plannedDay(row.plannedFor)}` : 'No link yet') : row.byName ? `Answered by ${row.byName}` : '', target: { kind: 'trend', id: themeId, page: 'trends' } });
      }
    }
  }

  // Prompt changes, when the studio pushes them (contentStudio.promptChanges or activity rows of kind prompt-changed).
  const promptRows = [...list(studio.promptChanges), ...list(state.activity).filter((row) => row?.kind === 'prompt-changed').map((row) => ({ ...row.detail, at: row.at, by: row.by }))];
  for (const row of promptRows) {
    if (!row?.at || !row.promptId || (me && row.by?.id === me)) continue;
    // contentStudio.promptChanges rows (prompt-lab recentChanges) carry `name` and `byName`; activity rows `promptName`.
    push({ id: `prompt:${row.promptId}:${row.version || row.at}`, kind: 'prompt-change', at: row.at, title: `${row.by?.name || row.byName || 'Someone'} changed the ${quote(row.promptName || row.name || row.promptId)} prompt`, detail: [row.version ? `Version ${row.version}` : '', firstLine(row.note, 90)].filter(Boolean).join(' · '), target: { kind: 'prompt', id: row.promptId, page: 'prompts' } });
  }

  // Never opened: the last 7 days count as new, so a first visit isn't a wall of unread rows.
  const seen = Number.isFinite(time(seenAt)) ? time(seenAt) : now - 7 * DAY;
  const unique = new Map(); for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  const sorted = [...unique.values()].sort((a, b) => time(b.at) - time(a.at) || a.id.localeCompare(b.id)).slice(0, INBOX_LIMIT)
    .map((item) => ({ ...item, unread: time(item.at) > seen }));
  return { items: sorted, unread: sorted.filter((item) => item.unread).length };
}

// Words for the kind of row, for screen readers and the filter.
export const INBOX_KIND_LABEL = Object.freeze({ 'needs-ok': 'Needs your OK', adoption: 'Channel answer', edit: 'Edit', 'run-finished': 'Finished', 'run-stopped': 'Stopped', 'prompt-change': 'Prompt change', routed: 'For your channel' });
