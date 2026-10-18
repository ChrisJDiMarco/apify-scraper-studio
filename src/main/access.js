'use strict';
// The access gate's logic (docs/roles-and-access.md). index.js wraps every IPC/RPC handler in one synchronous gate that
// calls, in order: currentViewer() → check() (may this person call this method, and the payload rebuilt to what a channel
// owner may send) → the handler → after() (activity and access logs, then what a channel owner or a role without costs
// gets back) or rewriteError(). project() is the state each person receives, for the `state` call, the Mac app's push and
// the browser's live updates. Everything keys on the role's base (admin, editor or channel), so a custom role built on
// Channel owner gets a channel owner's scopes and projections. CommonJS in the real Node context, so it is unit-testable
// without the vm harnesses index.js runs in.
const os = require('os');
const roles = require('./roles');
const kit = require('../shared/asset-kit');
const content = require('../shared/content-studio');
const { kitChannelIds, publicKitRun, channelOf } = require('./channel-view');

const SYSTEM = Object.freeze({ id: 'system', name: 'Automatic' });
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const kindOf = (deliverableId) => content.CONTENT_DELIVERABLES.find((entry) => entry.id === deliverableId)?.kind || 'text';
const fail = (message, status, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
// Errors that send people to Settings, keys or connections they can't open.
const SENDS_TO_SETTINGS = /\bsettings\b|api[\s_-]?keys?|\bkeys?\b|\btokens?\b|\bsign(?:ed)?[\s-]?in\b|\blog(?:ged)?[\s-]?in\b|\bauth login\b|\bconnect(?:ed|ion)?\b|\bcredentials?\b|\bunauthori[sz]ed\b/i;
// Errors from (or about) the AI and data providers: they name models, the account's credit and billing, and admin-only
// program settings, none of which an editor can change and a channel owner must never see (D4).
const FROM_PROVIDER = /\b(?:claude|anthropic|codex|openai|openrouter|fal(?:\.ai)?|apify)\b|\bmodels?\b|\bcredits?\b|\bbill(?:ing|ed)\b|\bapi error\b|\boverloaded\b|\brate[\s-]?limit/i;
// Refusals the app writes for people itself (a prompt name such as "Channel asset picture (image model)", or "a
// password, key or token" in a secret check, would otherwise read as a provider error). promptSample and
// promptTestUnavailable can carry a provider's text, so they stay rewritable.
const WRITTEN_FOR_PEOPLE = new Set(['promptConflict', 'promptLocked', 'promptNote', 'promptInvalid', 'promptEmpty', 'promptUnknown', 'promptTestChanged', 'promptTestRunning', 'askMemorySecret']);
// Methods whose handler reports what happened under `activity` (the analytics log) and `audit` (the access log, rows
// for team-store audit()); after() writes both and removes them from the result.
const REPORTED = new Set(['saveMember', 'removeMember', 'createSignInLink', 'setTrendAdoption', 'inviteMembers']);
const AUDITED = new Set(['saveMember', 'removeMember', 'createSignInLink', 'revokeSignInLink', 'saveRolePolicy', 'saveRole', 'deleteRole', 'saveMemberAccess', 'inviteMembers']);
// What a channel-based role may send, method by method (the SCOPES below); roles.json channelSafeMethods is these
// plus the core methods, and test/roles.test.js keeps the two in step.
// Ask AI (roles.json askAi) for a channel-based role: each method's payload is rebuilt from what it reads, and index.js
// answers from the channel projection only (src/main/ask-channel.js), in that person's channel space of conversations
// and memory (ask-store.js), with pictures only for a role that makes channel assets.
const ASK_METHODS = Object.freeze(['readAskProgress', 'cancelAsk', 'askHelp', 'listAskConversations', 'readAskConversation', 'renameAskConversation', 'deleteAskConversation', 'recordAskOutcome', 'listAskMemory', 'saveAskMemory', 'forgetAskMemory', 'createHelpImage', 'saveHelpImage', 'listHelpImages', 'readHelpImage']);
const SCOPE_METHODS = Object.freeze({ channel: Object.freeze(['planAssetKit', 'createAssetKit', 'readStudioAsset', 'openStudioAsset', 'saveAssetKitFolder', 'cancelStudioRun', 'retryStudioRun', 'setTrendAdoption', 'setViewPrefs', 'openReportDoc', 'closeReportDoc', 'listReportNotes', 'saveReportNote', 'resolveReportNote', 'deleteReportNote', ...ASK_METHODS]), editor: Object.freeze(['saveResearchReview']) });
// The methods that read a file the browser uploads first (web-api.js FILE_PICKERS), for studio-server's upload check.
const UPLOAD_METHODS = Object.freeze(['importStudioSource', 'importWorkbook', 'pickImportFile', 'openSetupFile', 'applySetup', 'addBrandImage']);
const osName = () => { try { return os.userInfo().username || 'You'; } catch (_) { return 'You'; } };

// notes: report-notes.js (optional), for each person's mentions and replies in their projected state.
function createAccess({ teamStore, roles: policy = roles, workspace, web = false, localName = '', currentCall = () => null, notes = null } = {}) {
  if (!teamStore || !workspace) throw new Error('The access gate needs the team store and the content workspace.');
  const IDENTITY = new Set(policy.IDENTITY_METHODS); const READS = new Set(policy.READ_METHODS);
  // The Mac app has one person, always an admin; View as lives in this process's memory and ends when the app quits.
  const desktopIdentity = Object.freeze({ id: 'local', name: localName || osName(), email: '', role: 'admin', channelId: null, via: 'desktop', disabled: false, memberSince: null });
  const desktopSession = { viewAs: null };

  // ---------- Who is calling ----------
  // On the web the browser request carries the identity and its live session (studio-server sets both on every call);
  // a call without one is refused, never treated as an admin.
  const identityForCall = () => (web ? currentCall()?.user || null : desktopIdentity);
  const sessionForCall = () => (web ? currentCall()?.session || null : desktopSession);
  // The team's compiled role policy (memoised by the team store until its next change); older stores have none.
  const policyNow = () => (typeof teamStore.accessPolicy === 'function' ? teamStore.accessPolicy() : policy.DEFAULT_POLICY);
  function viewerFor(identity, session) {
    const memberId = session?.viewAs && typeof session.viewAs === 'object' ? session.viewAs.memberId : '';
    return policy.buildViewer({
      identity, session, prefs: identity?.id ? teamStore.prefsFor(identity.id) : null, editionId: workspace.activeEditionId(), web, admins: teamStore.admins(),
      policy: policyNow(), access: identity?.id && typeof teamStore.accessFor === 'function' ? teamStore.accessFor(identity.id) : null,
      // "Preview as Riley": that member's role, channel and own access, read fresh on every call.
      previewMember: typeof memberId === 'string' && memberId && typeof teamStore.memberById === 'function' ? teamStore.memberById(memberId) : null,
    });
  }
  const currentViewer = () => viewerFor(identityForCall(), sessionForCall());
  // Who content-workspace credits for a run, decision or edit: read once at a public method's entry.
  function actorForCall() { const identity = identityForCall(); return identity?.id ? { id: identity.id, name: identity.name || '' } : SYSTEM; }

  // ---------- check ----------
  function deny(error, viewer, method) {
    try { teamStore.logEvent({ event: 'denied', identityId: viewer?.id || '', role: viewer?.role ?? null, method, reason: error.code || '' }); } catch (_) { /* Logging never changes the answer. */ }
    return error;
  }
  // A viewer's base (admin, editor, channel or null); viewers from older hosts carry only role.
  const baseOf = (viewer, real = false) => (real ? viewer?.realBase ?? viewer?.realRole : viewer?.base ?? viewer?.role) ?? null;
  // viewer.allowed is built from the compiled policy (identity methods by the real person, everything else by who the
  // session looks like, reads only in a preview), so it is exactly what this person may call. Admins may also call
  // a method no capability lists.
  const mayCall = (viewer, method, base) => base === 'admin' || (Array.isArray(viewer?.allowed) ? viewer.allowed.includes(method) : policy.canCall(base, method));
  function check(method, payload, viewer) {
    if (web && !viewer?.id) throw deny(fail('Sign in to use the studio.', 403, 'forbidden'), viewer, method);
    const identityMethod = IDENTITY.has(method);
    const base = baseOf(viewer, identityMethod);
    // A preview is read-only. Checked first so an admin previewing is told why, not "Only an admin can do that."
    if (viewer.preview && !identityMethod && !READS.has(method)) throw deny(policy.refusal('preview', { who: policy.previewWho(viewer) }), viewer, method);
    if (typeof method !== 'string' || !method || !mayCall(viewer, method, base)) {
      if (base == null) throw deny(fail(viewer.disabled ? `${policy.COPY.paused} Ask ${viewer.askAdmin || 'an admin'} if you need it back.` : 'You’re not in this studio yet. Ask a studio admin to add you.', 403, 'forbidden'), viewer, method);
      let admins = []; try { admins = teamStore.admins(); } catch (_) { /* the copy falls back to "an admin" */ }
      throw deny(policy.refusalFor(method, { base }, { admins }), viewer, method);
    }
    // Scopes rebuild the payload from an allowlist for anyone below admin. Identity methods follow the real role, so an
    // admin previewing a channel owner still changes only their own preferences.
    const scope = SCOPES[method]?.[base];
    if (!scope) return payload;
    try { return scope(record(payload), viewer); } catch (error) { if (error.status === 403) deny(error, viewer, method); throw error; }
  }

  // Channel owners: what they may send. Every scope builds a new payload, so nothing else rides along (no workspaceId,
  // budget, picture count or another channel's files).
  const edition = () => workspace.activeEditionId();
  function channelDeliverables(viewer) {
    const folder = kit.kitFolders(edition()).find((entry) => entry.id === viewer.channelId);
    const offered = new Set(kit.kitDeliverableIds(edition())); const pictures = workspace.picturesReady();
    // A short video is opt-in and costs dollars, so a channel owner's set never includes one.
    return list(folder?.deliverableIds).filter((id) => offered.has(id) && kindOf(id) !== 'video' && (pictures || kindOf(id) !== 'image'));
  }
  function trendBrief(payload) {
    const source = record(payload.source);
    const assetId = source.kind === 'report' ? text(source.assetId) || text(source.id) : '';
    const found = assetId ? workspace.findAsset(assetId) : null;
    if (!found || !workspace.isTrendReport(found.asset)) throw policy.refusal('outOfScope');
    return assetId;
  }
  function channelKit(create) {
    return (payload, viewer) => {
      const assetId = trendBrief(payload); const deliverableIds = channelDeliverables(viewer);
      if (!deliverableIds.length) throw fail('Nothing for your channel can be made from this trend right now.', 409);
      // No maxBudgetUsd: the server uses the plan's own cap.
      return { source: { kind: 'report', assetId }, deliverableIds, ...(create ? { onlyIfIdle: true } : {}) };
    };
  }
  function channelFile(payload, viewer) {
    const assetId = text(payload.assetId); const found = workspace.findAsset(assetId);
    if (!found) throw fail('That file isn’t in this workspace anymore.', 404);
    const ownFile = Boolean(found.run?.kit) && channelOf(found.asset.deliverableId, edition()) === viewer.channelId;
    if (!ownFile && !workspace.isTrendReport(found.asset)) throw policy.refusal('outOfScope');
    return { assetId };
  }
  function channelRun(payload, viewer) {
    const run = workspace.findRun(text(payload.runId));
    if (!run?.kit) throw fail('That set isn’t in this workspace anymore.', 404);
    if (!kitChannelIds(run, edition()).includes(viewer.channelId)) throw policy.refusal('outOfScope');
    return run;
  }
  // Stop and Finish the rest act on a whole set, so a set made with other channels is left to an editor.
  function ownSet(retry) {
    return (payload, viewer) => {
      const run = channelRun(payload, viewer);
      if (kitChannelIds(run, edition()).length !== 1) throw policy.refusal('sharedSet');
      if (!retry) return { runId: run.id };
      // Finish the rest gets room for what's left, as Simple's Finish button gives it: about $2 per unfinished file.
      const unfinished = list(run.jobs).filter((job) => job.status !== 'succeeded').length;
      return { runId: run.id, maxBudgetUsd: Math.min(1000, Math.max(Number(run.maxBudgetUsd) || 0, Math.ceil((Number(run.reservedUsd) || 0) + unfinished * 2))) };
    };
  }
  function reportScope(fields) {
    return (payload, viewer) => ({ ...channelFile(payload, viewer), ...Object.fromEntries(fields.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])) });
  }
  const SCOPES = {
    planAssetKit: { channel: channelKit(false) },
    createAssetKit: { channel: channelKit(true) },
    readStudioAsset: { channel: channelFile },
    openStudioAsset: { channel: channelFile },
    saveAssetKitFolder: { channel: (payload, viewer) => ({ runId: channelRun(payload, viewer).id }) },
    cancelStudioRun: { channel: ownSet(false) },
    retryStudioRun: { channel: ownSet(true) },
    // Their own channel only; link, note and planned date left out keep the saved ones.
    setTrendAdoption: { channel: (payload, viewer) => ({ themeId: text(payload.themeId), channelId: viewer.channelId, status: payload.status, ...(payload.link !== undefined ? { link: payload.link } : {}), ...(payload.note !== undefined ? { note: payload.note } : {}), ...(payload.plannedFor !== undefined ? { plannedFor: payload.plannedFor } : {}) }) },
    // A channel owner's layout is always Simple and their channel is fixed, so My channels doesn't apply to them.
    setViewPrefs: { channel: (payload) => ({ ...(payload.uiMode !== undefined ? { uiMode: 'simple' } : {}), ...Object.fromEntries(['welcomedAt', 'inboxSeenAt', 'navRail'].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])) }) },
    // The report editor and notes: their own channel's assets and the trend briefs (what readStudioAsset allows), and
    // never an edit (pushReportDocUpdate and restoreReportVersion aren't channel-safe). Whose note may be changed is
    // checked by report-notes.js.
    openReportDoc: { channel: reportScope(['clientId']) },
    // Closing only takes this person's own browser off the report, so it works after the report is gone (deleted, or
    // a switched workspace) instead of leaving them listed as having it open until the timeout.
    closeReportDoc: { channel: (payload) => ({ assetId: text(payload.assetId), ...(payload.clientId !== undefined ? { clientId: payload.clientId } : {}) }) },
    listReportNotes: { channel: reportScope([]) },
    saveReportNote: { channel: reportScope(['noteId', 'replyTo', 'replyId', 'anchor', 'body', 'mentions']) },
    resolveReportNote: { channel: reportScope(['noteId', 'resolved']) },
    deleteReportNote: { channel: reportScope(['noteId', 'replyId']) },
    // On the web a review is signed by the person who saved it.
    saveResearchReview: { editor: (payload, viewer) => (web ? { ...payload, reviewer: viewer.name } : payload) },
  };
  // Ask AI for a channel-based role: only these fields reach the handler, which reads the person's channel from the
  // viewer, never from the payload. A question always goes into their stored conversations (no `history` of the
  // caller's own), and a picture needs Make channel assets, the capability that makes their channel's pictures.
  const keep = (payload, keys) => Object.fromEntries(keys.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
  const ASK_SCOPES = {
    readAskProgress: (payload) => keep(payload, ['requestId']),
    cancelAsk: (payload) => keep(payload, ['requestId']),
    askHelp: (payload) => ({ ...keep(payload, ['question', 'requestId', 'page', 'context', 'mode', 'replaces', 'attachments']), conversationId: text(payload.conversationId) }),
    listAskConversations: (payload) => keep(payload, ['limit']),
    readAskConversation: (payload) => keep(payload, ['conversationId', 'id']),
    renameAskConversation: (payload) => keep(payload, ['conversationId', 'id', 'title', 'pinned']),
    deleteAskConversation: (payload) => keep(payload, ['conversationId', 'id']),
    recordAskOutcome: (payload) => keep(payload, ['conversationId', 'id', 'messageId', 'index', 'outcome', 'imageId']),
    listAskMemory: (payload) => keep(payload, ['includeForgotten']),
    saveAskMemory: (payload) => keep(payload, ['id', 'text', 'kind', 'scope', 'pinned', 'status']),
    forgetAskMemory: (payload) => keep(payload, ['id']),
    createHelpImage: (payload, viewer) => {
      if (!list(viewer?.capabilities).includes('makeAssets')) { let admins = []; try { admins = teamStore.admins(); } catch (_) { /* "an admin" */ } throw policy.refusal('capabilityOff', { what: policy.capLabel('makeAssets'), admin: policy.askWho(admins) }); }
      return keep(payload, ['prompt', 'size', 'title', 'family']);
    },
    saveHelpImage: (payload) => keep(payload, ['id']),
    listHelpImages: () => ({}),
    readHelpImage: (payload) => keep(payload, ['id']),
  };
  for (const method of ASK_METHODS) SCOPES[method] = { channel: ASK_SCOPES[method] };
  for (const base of Object.keys(SCOPE_METHODS)) {
    const scoped = Object.keys(SCOPES).filter((method) => SCOPES[method][base]);
    if (scoped.join() !== SCOPE_METHODS[base].join()) throw new Error(`SCOPE_METHODS.${base} is out of step with the access gate's scopes.`);
  }

  // ---------- after ----------
  const activeWorkspaceId = () => workspace.activeWorkspace()?.id || '';
  const themeName = (run, themeId) => [...list(run?.discoveredThemes), ...list(run?.themes)].find((theme) => theme?.id === themeId)?.name || '';
  const count = (decisions, value) => Object.values(record(decisions)).filter((decision) => decision === value).length;
  // What the activity log records for each kind of change, with the fields the analytics sentences read.
  const ACTIVITY = {
    decideResearchTheme: (result, payload) => ['trend-decision', result?.workspaceId, { runId: result?.id, themeId: payload?.themeId, trendName: themeName(result, payload?.themeId), decision: payload?.decision }],
    approveResearchThemes: (result) => ['trend-decision', result?.workspaceId, { runId: result?.id, approved: count(result?.decisions, 'approved'), passed: count(result?.decisions, 'passed') }],
    createAssetKit: (result) => ['kit-created', result?.workspaceId, { runId: result?.id, themeId: result?.kit?.themeId || null, trendName: result?.kit?.sourceTitle || result?.title || '', channels: kitChannelIds(result, edition()), estimateUsd: result?.kit?.estimateUsd ?? null }],
    editStudioAsset: (result) => ['report-edited', result?.asset?.workspaceId, { assetId: result?.asset?.id, title: result?.asset?.title || '' }],
    restoreStudioAsset: (result) => ['report-restored', result?.asset?.workspaceId, { assetId: result?.asset?.id, title: result?.asset?.title || '' }],
    startResearchRun: (result) => ['research-started', result?.workspaceId, { runId: result?.id, programId: result?.programId, programName: result?.title || '' }],
    // The run's title is "Quick scan · <topic>", so analytics read "started a search with “Quick scan · SEO”".
    startQuickScan: (result, payload) => ['research-started', result?.workspaceId, { runId: result?.id, programId: result?.programId, programName: result?.title || '', origin: 'quick-scan', topic: result?.quickScan?.topic || String(payload?.scan?.topic || '').slice(0, 200) }],
    saveMember: (result) => ['member-changed', '', result?.activity],
    removeMember: (result) => ['member-changed', '', result?.activity],
    createSignInLink: (result) => ['link-issued', '', result?.activity],
    setTrendAdoption: (result) => ['adoption', activeWorkspaceId(), result?.activity],
    // One row per person added and per link made, as the analytics sentences read them.
    inviteMembers: (result) => list(result?.activity).filter((row) => row && ['member-changed', 'link-issued'].includes(row.kind)).map((row) => [row.kind, '', row.detail]),
  };
  const actorOf = (viewer) => ({ id: viewer?.id || SYSTEM.id, name: viewer?.name || SYSTEM.name });
  function logActivity(method, result, viewer, payload) {
    const entry = ACTIVITY[method]; if (!entry) return;
    try {
      const made = entry(result, payload);
      for (const [kind, workspaceId, detail] of Array.isArray(made?.[0]) ? made : [made]) if (detail) teamStore.log(kind, typeof workspaceId === 'string' ? workspaceId : activeWorkspaceId(), detail, actorOf(viewer));
    } catch (error) { try { teamStore.logEvent({ event: 'activity-not-logged', method, code: error.code || '' }); } catch (_) { /* never fail the action over its log */ } }
  }
  // The access log: the rows a team handler describes, written in one change, credited to the person who called.
  function logAudit(method, result, viewer) {
    if (!AUDITED.has(method) || !Array.isArray(result?.audit) || !result.audit.length || typeof teamStore.audit !== 'function') return;
    try { teamStore.audit(result.audit, actorOf(viewer)); }
    catch (error) { try { teamStore.logEvent({ event: 'audit-not-logged', method, code: error.code || '' }); } catch (_) { /* never fail the action over its log */ } }
  }
  function after(method, result, viewer, payload) {
    logActivity(method, result, viewer, payload);
    logAudit(method, result, viewer);
    let out = result;
    if ((REPORTED.has(method) || AUDITED.has(method)) && out && typeof out === 'object' && ('activity' in out || 'audit' in out)) { const { activity: _activity, audit: _audit, ...rest } = out; out = rest; }
    return projectResult(method, out, viewer);
  }
  // What a method's answer looks like to this viewer, without logging anything: after() uses it, and so does Ask AI's
  // live progress (each streamed event and snapshot is shaped as the askHelp answer would be).
  function projectResult(method, result, viewer) {
    const base = baseOf(viewer);
    const project = base === 'channel' ? RESULTS[method] : null;
    if (project) return project(result, viewer);
    // A role without See costs never receives money, from a call's answer either. Identity methods answer with the
    // viewer or the already-projected state.
    if (base === 'editor' && Array.isArray(viewer?.capabilities) && !viewer.capabilities.includes('seeCosts') && !IDENTITY.has(method)) return policy.stripMoney(result);
    return result;
  }

  // Channel owners: what comes back. No dollars, models, receipts, evidence or other channels.
  const kitRun = (run, viewer) => (run && typeof run === 'object' && run.kit ? publicKitRun(run, viewer.channelId, edition()) : run);
  function channelPlanResult(plan, viewer) {
    const value = record(plan);
    const folder = list(value.folders).find((entry) => entry.id === viewer.channelId) || { id: viewer.channelId, name: viewer.channelName || '', items: [] };
    const earlierSets = list(value.sourceKey ? workspace.kitRunsFor(value.sourceKey) : []).filter((run) => kitChannelIds(run, edition()).includes(viewer.channelId))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt)).map((run) => ({ runId: run.id, createdAt: run.createdAt || '', status: publicKitRun(run, viewer.channelId, edition()).status }));
    return {
      title: text(value.title), folder: { id: folder.id, name: folder.name, items: list(folder.items).filter((item) => item.selected !== false && item.available !== false).map((item) => ({ id: item.id, label: item.label, kind: item.kind || 'text', pictures: Number(item.pictures) || 0 })) },
      minutes: Number(value.minutes) || 0, imagesReady: Boolean(value.imagesReady), edited: value.edited?.at ? { at: value.edited.at, byName: value.edited.byName || '' } : null, earlierSets,
    };
  }
  function channelAssetResult(result) {
    const value = record(result); const asset = record(value.asset);
    const shaped = { id: asset.id, title: asset.title || '', deliverableId: asset.deliverableId, kind: asset.kind || 'text', format: asset.format || '', createdAt: asset.createdAt || '', edited: asset.edited?.at ? { at: asset.edited.at, byName: asset.edited.by?.name || '' } : null };
    return typeof value.imageDataUrl === 'string' ? { asset: shaped, imageDataUrl: value.imageDataUrl } : { asset: shaped, markdown: text(value.markdown) };
  }
  const RESULTS = {
    planAssetKit: channelPlanResult,
    createAssetKit: kitRun,
    cancelStudioRun: kitRun,
    retryStudioRun: kitRun,
    readStudioAsset: channelAssetResult,
    openStudioAsset: () => ({ opened: true }),
    saveAssetKitFolder: (result) => { const value = record(result); return value.cancelled ? { cancelled: true } : { folderName: text(value.folderName), assetCount: Number(value.assetCount) || 0, ...(value.savedTo ? { savedTo: value.savedTo } : {}) }; },
  };
  // Ask AI's answers, conversations, progress and pictures: never a cost or a receipt. A new picture also names the
  // model and the connection that drew it (for the caption beside its cost), which a channel owner doesn't see either.
  for (const method of ASK_METHODS) RESULTS[method] = (result) => policy.stripMoney(result);
  RESULTS.createHelpImage = (result) => { const { model: _model, provider: _provider, ...rest } = record(policy.stripMoney(result)); return rest; };

  // ---------- rewriteError ----------
  // Editors and channel owners never get sent to Settings, keys or connections they can't open, and never read a provider's
  // own error (model ids, credit, billing): those messages become one plain line naming who to ask. A channel owner also
  // can't raise a budget. The status stays.
  function rewriteError(error, viewer) {
    const role = baseOf(viewer);
    if (!error || typeof error !== 'object' || !['editor', 'channel'].includes(role)) return error;
    if (typeof error.code === 'string' && (Object.prototype.hasOwnProperty.call(policy.COPY, error.code) || WRITTEN_FOR_PEOPLE.has(error.code))) return error; // already written for people
    const message = String(error.message || '');
    let key = null;
    if (role === 'channel' && /\bbudget\b/i.test(message)) key = 'askBudget';
    else if (SENDS_TO_SETTINGS.test(message) || FROM_PROVIDER.test(message)) key = /\bpictures?\b|\bimages?\b/i.test(message) ? 'askPictures' : /\bgoogle\b|\bdrive\b/i.test(message) ? 'askDrive' : 'askConnection';
    if (!key) return error;
    let admin = 'an admin'; try { admin = policy.askWho(teamStore.admins()); } catch (_) { /* fall back to "an admin" */ }
    return Object.assign(new Error(policy.format(key, { admin })), { code: key, ...(error.status ? { status: error.status } : {}) });
  }

  // ---------- project ----------
  // One projection per state object and kind of viewer: a broadcast to several tabs of the same person, or several
  // people with the same view, is built once.
  const projections = new WeakMap();
  function project(base, viewer) {
    if (!base || typeof base !== 'object') return base;
    const key = policy.viewKey(viewer);
    let views = projections.get(base); if (!views) { views = new Map(); projections.set(base, views); }
    if (!views.has(key)) {
      const workspaceId = base.contentStudio?.activeWorkspaceId || activeWorkspaceId();
      let noteInbox = null; try { noteInbox = notes && viewer?.id ? notes.inboxFor(viewer.id) : null; } catch (_) { noteInbox = null; }
      views.set(key, policy.projectState(base, viewer, { adoptions: teamStore.adoptionsFor(workspaceId), admins: teamStore.admins(), memberCount: teamStore.listMembers().length, editionId: workspace.workspaceById(workspaceId)?.editionId || edition(), noteInbox }));
    }
    return views.get(key);
  }

  // ---------- For the browser server ----------
  // studio-server asks these through the people provider: whether this person may upload a file (only to call a method
  // that reads one; never in a preview), who the request acts as, and what separates one person's rendering of the
  // state from another's.
  function canUpload(identity, session) {
    const viewer = viewerFor(identity, session);
    return !viewer.preview && UPLOAD_METHODS.some((method) => mayCall(viewer, method, baseOf(viewer)));
  }
  function effectiveFor(identity, session) {
    const viewer = viewerFor(identity, session);
    return { role: viewer.base, roleId: viewer.roleId, channelId: viewer.channelId, preview: viewer.preview };
  }
  const viewKeyFor = (identity, session) => policy.viewKey(viewerFor(identity, session));
  // Whether this person (no session, so no preview) may call a method: the Monday.com sync's check that a member matched
  // by email holds decideResearchTheme before their Yes or Skip on Monday counts.
  function allows(identity, method) {
    if (!identity?.role || identity.disabled) return false;
    const viewer = viewerFor(identity, null);
    return mayCall(viewer, method, baseOf(viewer));
  }
  // Whether a workflow's owner, by identity id, may still call a method (checked before every step a workflow runs). The
  // Mac's one person ('local') and the web's admin password ('owner') are admins; a removed or disabled member, or one
  // whose role lost the capability, may not.
  function canIdentityCall(identityId, method) {
    const id = text(identityId);
    if (id === 'local' || id === 'owner') return true;
    const member = typeof teamStore.memberById === 'function' ? teamStore.memberById(id) : null;
    const identity = member && typeof teamStore.identityFor === 'function' ? teamStore.identityFor(member, 'workflow') : null;
    return allows(identity, method);
  }

  return { identityForCall, sessionForCall, viewerFor, currentViewer, actorForCall, check, after, projectResult, rewriteError, project, canUpload, effectiveFor, viewKeyFor, allows, canIdentityCall, policy: policyNow };
}

module.exports = { createAccess, SYSTEM, SCOPE_METHODS, UPLOAD_METHODS, AUDITED, ASK_METHODS };
