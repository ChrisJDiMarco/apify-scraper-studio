'use strict';
// Ask AI's own memory, one folder per person: their conversations and the durable things they told Ask AI (preferences,
// facts, decisions, goals). It lives in content-studio/ask/<sha256(identity id)>/, inside the folder the owner lock
// protects, next to team.json. CommonJS, Electron-free.
//
// - index.json   { version, identityId, conversations:[meta], requests:[{ requestId, conversationId, userMessageId, messageId }] }
// - c/<id>.json  { version, id, title, workspaceId, createdAt, updatedAt, pinned, renamed, summary, summaryThrough, messages }
// - memory.json  { version, items:[MemoryItem] }
//
// Every call is synchronous end to end and reads from disk, so nothing awaits between a read and its write. Writes are
// atomic (temp file, fsync, rename), the same pattern as team-store.js. Nobody's folder is reachable from another
// identity: the folder name is a hash, and every id that becomes a file name is checked against its pattern first.
// Conversations are never part of the broadcast state; they are read through the help:* methods only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASK_VERSION = 1;
const MAX_CONVERSATIONS = 200; // per person; past this the oldest unpinned conversations are deleted
const MAX_MESSAGES = 400; // per conversation; the rolling summary covers what is trimmed
const MAX_ACTIVE_MEMORY = 300; // per person; past this the oldest unpinned items go first
const MAX_FORGOTTEN_MEMORY = 100; // kept so Forget can be undone; the oldest are erased
const MAX_REQUESTS = 500; // requestId → reply, so a retried question never pays twice
const HISTORY_TURNS = 8; // stored messages sent as CONVERSATION SO FAR; earlier ones travel as the summary
const MAX_PENDING = 12; // earlier messages not yet folded into the summary that are sent along to fold in
const MEMORY_TEXT_MAX = 280;
const TITLE_MAX = 60;
const MEMORY_KINDS = Object.freeze(['preference', 'fact', 'decision', 'goal']);
const MEMORY_SCOPES = Object.freeze(['me', 'workspace']);
const OUTCOME_STATUSES = Object.freeze(['done', 'failed', 'cancelled']);
const CONVERSATION_ID = /^ask-[0-9a-f-]{36}$/;
const MESSAGE_ID = /^msg-[0-9a-f-]{36}$/;
const MEMORY_ID = /^mem-[0-9a-f-]{36}$/;
const IMAGE_ID = /^help-image-[a-f0-9-]{36}$/;
const IDENTITY_ID = /^[\w:@.+-]{1,320}$/;
const DAY_MS = 86400000;
// Recall: BM25-lite over the memory text, plus boosts. There are no embeddings because the Claude app and Codex routes
// have no embedding API, and this keeps recall free and the same on every route.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const PIN_BOOST = 3;
const RECENCY_BOOST = 1; // fades over about a month (e^(-days/30))
const NAME_BOOST = 1.5; // per live trend, program or report name the item mentions (at most two)
const USES_BOOST_MAX = 1;
// Secret-shaped text never becomes a memory. team-store.js drops fields named like secrets (SECRET_KEY) and long hex
// values (HEX_SECRET); free text needs the same two checks applied to a "name: value" pair and to each word, plus the
// key formats the studio itself handles.
const SECRET_KEY = /token|hash|password|passcode|passwd|secret|cookie|api[ _-]?key|private[ _-]?key|bearer|credential/i;
const HEX_SECRET = /^[0-9a-f]{32,}$/i;
const SECRET_TEXT = [
  new RegExp(`(?:${SECRET_KEY.source})\\s*(?:is|was|=|:)\\s*["'\`]?[^\\s"'\`]{6,}`, 'i'),
  /\bsk-[A-Za-z0-9_-]{16,}/, // Anthropic and OpenAI keys
  /\bapify_api_[A-Za-z0-9]{10,}/i,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // a JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /script\.google\.com\/macros\/s\//i, // the Google Sheets bridge URL works as a key
  /\/\/[^/\s:@]+:[^/\s@]+@/, // credentials inside a URL
];
const STOP_WORDS = new Set(('a about after again all also am an and any are as at be because been before being both but by can could did do does doing '
  + 'for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or '
  + 'other our ours out over own same she should so some such than that the their them then there these they this those through to too under '
  + 'until up us very was we were what when where which while who whom why will with would you your yours im ive dont cant lets please').split(' '));

const list = (value) => (Array.isArray(value) ? value : []);
const copy = (value) => JSON.parse(JSON.stringify(value));
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const folderKey = (identityId) => crypto.createHash('sha256').update(String(identityId)).digest('hex').slice(0, 32);
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

// Lower-case word tokens with stop words removed and a light plural fold ("reports" and "report" match).
function tokens(text) {
  const words = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  return words.filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map((word) => (word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}
const phrase = (text) => tokens(text).join(' ');
// Same text once case, spacing and punctuation are set aside: two memories that say the same thing are one memory.
const normalizedText = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function looksSecret(text) {
  const value = String(text ?? '');
  if (SECRET_TEXT.some((pattern) => pattern.test(value))) return true;
  return value.split(/[\s"'`()[\]{}<>,;]+/).some((word) => HEX_SECRET.test(word.replace(/[.:!?]+$/, '')) || (word.length >= 40 && /^[A-Za-z0-9+/_=-]+$/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word)));
}

// BM25 scores for each document (an array of tokens) against the query tokens.
function bm25(documents, query) {
  const terms = [...new Set(query)];
  const count = documents.length;
  if (!count || !terms.length) return documents.map(() => 0);
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / count || 1;
  const frequency = new Map();
  for (const doc of documents) for (const term of new Set(doc)) frequency.set(term, (frequency.get(term) || 0) + 1);
  return documents.map((doc) => {
    if (!doc.length) return 0;
    const counts = new Map(); for (const term of doc) counts.set(term, (counts.get(term) || 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = counts.get(term); if (!f) continue;
      const n = frequency.get(term) || 0;
      score += Math.log(1 + (count - n + 0.5) / (n + 0.5)) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / average)));
    }
    return score;
  });
}

// A short passage around the first place the query appears, for conversation search results.
function snippet(text, query, max = 400) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const lower = value.toLowerCase();
  const at = query.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - 120, value.length - max));
  return `${start ? '…' : ''}${value.slice(start, start + max - 2).trim()}${start + max - 2 < value.length ? '…' : ''}`;
}

// What one stored message says when it travels back to the model as history. Assistant turns carry what happened to
// their buttons ("Offered: Start research for X. Outcome: done (Research started.)"), the picture prompt they drew from
// and what they remembered, so the next answer knows.
function historyTurns(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return [];
  if (message.role === 'user') return [...(message.context ? [{ role: 'user', content: String(message.context).slice(0, 3900) }] : []), { role: 'user', content: String(message.content || '') }];
  const notes = [];
  if (message.image?.prompt) notes.push(`[Picture created from this prompt: ${message.image.prompt}${message.image.status === 'failed' ? ' (it failed to draw)' : ''}]`);
  for (const action of list(message.actions)) {
    const outcome = action?.outcome;
    notes.push(`[Offered: ${action?.label || action?.kind}. Outcome: ${outcome ? `${outcome.status}${outcome.text ? ` (${outcome.text})` : ''}` : 'not clicked'}.]`);
  }
  const cards = list(message.cards).filter((card) => card?.type && card.type !== 'memory').map((card) => `${card.type} "${card.title || ''}"`);
  if (cards.length) notes.push(`[Cards shown: ${cards.join(', ')}]`);
  const remembered = list(message.remembered).map((item) => item?.text).filter(Boolean);
  if (remembered.length) notes.push(`[Remembered: ${remembered.join(' | ')}]`);
  return [{ role: 'assistant', content: [String(message.content || ''), ...notes].join('\n') }];
}

// The history for the next question: the last HISTORY_TURNS stored messages, the rolling summary of everything earlier,
// and the earlier messages the summary doesn't cover yet (sent so the model can fold them in). coverThrough is the id of
// the last earlier message, which the summary will cover once the model returns a new one.
function askHistory(conversation, { turns = HISTORY_TURNS } = {}) {
  const messages = list(conversation?.messages);
  const recent = messages.slice(-turns); const older = messages.slice(0, Math.max(0, messages.length - turns));
  const covered = conversation?.summaryThrough ? older.findIndex((message) => message.id === conversation.summaryThrough) : -1;
  const pending = older.slice(covered + 1).slice(-MAX_PENDING).flatMap(historyTurns).map((turn) => ({ ...turn, content: turn.content.slice(0, 1500) }));
  return { summary: String(conversation?.summary || ''), turns: recent.flatMap(historyTurns), pending, coverThrough: older.length ? older[older.length - 1].id : '' };
}

function plainPreview(text) {
  return clip(String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|]+/g, ' '), 140);
}
function firstTitle(question) {
  const text = clip(question, 400);
  if (text.length <= TITLE_MAX) return text || 'New conversation';
  const cut = text.slice(0, TITLE_MAX - 1); const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

function createAskStore({ root, now = () => new Date() } = {}) {
  if (!root) throw new Error('Ask AI needs the studio data folder.');
  const stamp = () => new Date(now()).toISOString();
  const clock = () => new Date(now()).getTime();
  const tooNew = () => new Error('This Ask AI data is from a newer Scraper Studio. Update the app or server.');

  function personDir(identityId) {
    if (typeof identityId !== 'string' || !IDENTITY_ID.test(identityId)) throw fail('Sign in to use Ask AI.', 403);
    return path.join(root, folderKey(identityId));
  }
  const files = (identityId) => { const dir = personDir(identityId); return { dir, index: path.join(dir, 'index.json'), memory: path.join(dir, 'memory.json'), conversations: path.join(dir, 'c') }; };
  const conversationFile = (identityId, id) => path.join(files(identityId).conversations, `${id}.json`);

  // Same pattern as team-store's writeFile: a pid-named temp file, fsync, rename, then fsync the folder.
  function writeFile(target, value) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(temp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, target);
    } catch (error) { try { fs.unlinkSync(temp); } catch (_) { /* Nothing was left behind. */ } throw error; }
    let directory;
    try { directory = fs.openSync(path.dirname(target), 'r'); fs.fsyncSync(directory); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EISDIR'].includes(error.code)) throw error; }
    finally { if (directory != null) fs.closeSync(directory); }
  }
  // A damaged file is moved aside (never deleted, so it can be recovered by hand) and Ask AI starts that part afresh
  // rather than refusing every question. A file from a newer build stops instead, so nothing newer is overwritten.
  function readFile(target, fresh) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { value: fresh(), found: false };
      try { fs.renameSync(target, `${target}.unreadable-${clock()}`); } catch (_) { /* Left in place; the next write replaces it. */ }
      return { value: fresh(), found: false, damaged: true };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { try { fs.renameSync(target, `${target}.unreadable-${clock()}`); } catch (_) { /* as above */ } return { value: fresh(), found: false, damaged: true }; }
    if (Number(parsed.version) > ASK_VERSION) throw tooNew();
    return { value: parsed, found: true };
  }

  // ---------- Conversations ----------
  function metaOf(conversation) {
    const messages = list(conversation.messages);
    const lastAnswer = [...messages].reverse().find((message) => message.role === 'assistant');
    return { id: conversation.id, title: conversation.title, workspaceId: conversation.workspaceId || '', createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messageCount: messages.length, preview: plainPreview(lastAnswer?.content || messages[messages.length - 1]?.content || ''), pinned: Boolean(conversation.pinned) };
  }
  function readConversationFile(identityId, id) {
    if (typeof id !== 'string' || !CONVERSATION_ID.test(id)) return null;
    const { value, found } = readFile(conversationFile(identityId, id), () => null);
    if (!found || !value || value.id !== id || !Array.isArray(value.messages)) return null;
    return value;
  }
  // The index is a cache of what c/ holds; a missing or damaged one is rebuilt from the conversation files.
  function loadIndex(identityId) {
    const paths = files(identityId);
    const { value, found } = readFile(paths.index, () => null);
    if (found && Array.isArray(value.conversations)) return { version: ASK_VERSION, identityId, conversations: value.conversations.filter((row) => row && CONVERSATION_ID.test(row.id)), requests: list(value.requests).filter((row) => row && typeof row.requestId === 'string') };
    let names = [];
    try { names = fs.readdirSync(paths.conversations).filter((name) => name.endsWith('.json')); } catch (_) { names = []; }
    const conversations = names.map((name) => readConversationFile(identityId, name.slice(0, -5))).filter(Boolean);
    const requests = conversations.flatMap((conversation) => { const messages = list(conversation.messages); return messages.flatMap((message, at) => (message.role === 'user' && message.requestId && messages[at + 1]?.role === 'assistant' ? [{ requestId: message.requestId, conversationId: conversation.id, userMessageId: message.id, messageId: messages[at + 1].id }] : [])); });
    const index = { version: ASK_VERSION, identityId, conversations: conversations.map(metaOf).sort((a, b) => time(b.updatedAt) - time(a.updatedAt)), requests: requests.slice(-MAX_REQUESTS) };
    if (conversations.length) writeFile(paths.index, index);
    return index;
  }
  const saveIndex = (identityId, index) => writeFile(files(identityId).index, { version: ASK_VERSION, identityId, conversations: index.conversations, requests: index.requests.slice(-MAX_REQUESTS) });
  function requireConversation(identityId, id) {
    const conversation = readConversationFile(identityId, id);
    if (!conversation) throw fail('That conversation isn’t available anymore. Start a new one.', 404);
    return conversation;
  }

  function listConversations(identityId, { workspaceId = '', limit = 100 } = {}) {
    const rows = loadIndex(identityId).conversations.filter((row) => !workspaceId || row.workspaceId === workspaceId);
    return copy(rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || time(b.updatedAt) - time(a.updatedAt)).slice(0, Math.max(1, Math.min(MAX_CONVERSATIONS, Number(limit) || 100))));
  }
  const readConversation = (identityId, id) => { const conversation = readConversationFile(identityId, id); return conversation ? copy(conversation) : null; };
  const history = (identityId, id, options) => askHistory(requireConversation(identityId, id), options);

  // The stored reply for a request already answered, so asking again with the same requestId never pays twice.
  function findByRequest(identityId, requestId) {
    const entry = [...loadIndex(identityId).requests].reverse().find((row) => row.requestId === requestId);
    if (!entry) return null;
    const conversation = readConversationFile(identityId, entry.conversationId);
    const userMessage = conversation?.messages.find((message) => message.id === entry.userMessageId);
    const message = conversation?.messages.find((row) => row.id === entry.messageId);
    if (!userMessage || !message) return null;
    return copy({ conversation: { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt }, userMessage: { id: userMessage.id, content: userMessage.content, createdAt: userMessage.createdAt }, message });
  }

  // One answered question: the person's message and Ask AI's reply land together, with what it remembered and, when
  // the model returned one, a new rolling summary. A new conversation is created when conversationId is empty.
  function appendTurn(identityId, { conversationId = '', workspaceId = '', user = {}, assistant = {}, remember = [], summary = null, title = '' } = {}) {
    const index = loadIndex(identityId); const at = stamp();
    let conversation;
    if (conversationId) {
      conversation = readConversationFile(identityId, conversationId);
      if (!conversation) throw fail('This conversation was deleted while Ask AI was answering. Ask again in a new conversation.', 404);
    } else {
      conversation = { version: ASK_VERSION, id: newId('ask'), title: firstTitle(user.content), workspaceId, createdAt: at, updatedAt: at, pinned: false, renamed: false, summary: '', summaryThrough: '', messages: [] };
    }
    // The model may name a conversation from its first answer; a title the person chose always stays.
    const suggested = clip(title, TITLE_MAX);
    if (!conversation.messages.length && !conversation.renamed && suggested) conversation.title = suggested;
    const userMessage = { id: newId('msg'), role: 'user', content: String(user.content || '').slice(0, 4000), ...(user.context ? { context: String(user.context).slice(0, 3900) } : {}), page: user.page && typeof user.page === 'object' ? copy(user.page) : null, requestId: String(user.requestId || ''), createdAt: at };
    const message = { id: newId('msg'), role: 'assistant', ...copy(assistant), cards: list(assistant.cards).map(copy), remembered: [], createdAt: at };
    const remembered = list(remember).length ? rememberItems(identityId, remember, { workspaceId: conversation.workspaceId || workspaceId, source: { conversationId: conversation.id, messageId: message.id } }) : [];
    if (remembered.length) {
      message.remembered = remembered;
      // The "Remembered" chips with Undo (forget) come from what was actually saved, never from the model's wording.
      message.cards.push({ type: 'memory', title: 'Remembered', note: '', data: { items: remembered }, actionIndexes: [] });
    }
    conversation.messages.push(userMessage, message);
    if (summary && typeof summary.text === 'string' && summary.text.trim() && summary.through) { conversation.summary = summary.text.trim().slice(0, 2000); conversation.summaryThrough = summary.through; }
    if (conversation.messages.length > MAX_MESSAGES) conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
    conversation.updatedAt = at;
    writeFile(conversationFile(identityId, conversation.id), conversation);
    index.conversations = [metaOf(conversation), ...index.conversations.filter((row) => row.id !== conversation.id)];
    if (userMessage.requestId) index.requests.push({ requestId: userMessage.requestId, conversationId: conversation.id, userMessageId: userMessage.id, messageId: message.id });
    // Past the cap the oldest unpinned conversations go, files and all.
    const unpinned = index.conversations.filter((row) => !row.pinned && row.id !== conversation.id).sort((a, b) => time(a.updatedAt) - time(b.updatedAt));
    const extra = unpinned.slice(0, Math.max(0, index.conversations.length - MAX_CONVERSATIONS)).map((row) => row.id);
    if (extra.length) {
      for (const id of extra) fs.rmSync(conversationFile(identityId, id), { force: true });
      index.conversations = index.conversations.filter((row) => !extra.includes(row.id));
      index.requests = index.requests.filter((row) => !extra.includes(row.conversationId));
    }
    saveIndex(identityId, index);
    return copy({ conversation: { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt }, userMessage: { id: userMessage.id, content: userMessage.content, createdAt: userMessage.createdAt }, message });
  }

  function renameConversation(identityId, { conversationId, title, pinned } = {}) {
    const conversation = requireConversation(identityId, conversationId);
    if (title !== undefined) {
      const name = clip(title, 80);
      if (!name) throw fail('Give the conversation a name.');
      conversation.title = name; conversation.renamed = true;
    }
    if (pinned !== undefined) conversation.pinned = pinned === true;
    writeFile(conversationFile(identityId, conversation.id), conversation);
    const index = loadIndex(identityId);
    index.conversations = index.conversations.map((row) => (row.id === conversation.id ? { ...row, title: conversation.title, pinned: Boolean(conversation.pinned) } : row));
    if (!index.conversations.some((row) => row.id === conversation.id)) index.conversations.unshift(metaOf(conversation));
    saveIndex(identityId, index);
    return copy(metaOf(conversation));
  }
  function deleteConversation(identityId, conversationId) {
    if (typeof conversationId !== 'string' || !CONVERSATION_ID.test(conversationId)) throw fail('That conversation isn’t available anymore.', 404);
    const index = loadIndex(identityId);
    fs.rmSync(conversationFile(identityId, conversationId), { force: true });
    index.conversations = index.conversations.filter((row) => row.id !== conversationId);
    index.requests = index.requests.filter((row) => row.conversationId !== conversationId);
    saveIndex(identityId, index);
    return { ok: true };
  }

  // What happened after an answer: a button's result ({ index, outcome:{ status, text } }) or the picture it drew
  // ({ outcome:{ kind:'image', imageId, status } }). Outcomes travel back to the model with the history.
  function recordOutcome(identityId, { conversationId, messageId, index, outcome = {}, imageId } = {}) {
    const conversation = requireConversation(identityId, conversationId);
    const message = typeof messageId === 'string' && MESSAGE_ID.test(messageId) ? conversation.messages.find((row) => row.id === messageId && row.role === 'assistant') : null;
    if (!message) throw fail('That answer isn’t in this conversation anymore.', 404);
    const detail = outcome && typeof outcome === 'object' ? outcome : {};
    const picture = detail.imageId ?? imageId;
    if (detail.kind === 'image' || picture !== undefined) {
      if (!message.image) throw fail('That answer has no picture.', 404);
      if (picture != null && picture !== '' && !IMAGE_ID.test(String(picture))) throw fail('That picture is no longer available.', 404);
      const status = detail.status === 'failed' ? 'failed' : picture ? 'ready' : message.image.status || 'creating';
      message.image = { ...message.image, ...(picture ? { imageId: String(picture) } : {}), status, ...(status === 'failed' && detail.text ? { error: clip(detail.text, 300) } : {}) };
      if (status !== 'failed') delete message.image.error;
    } else {
      const action = Number.isInteger(index) ? list(message.actions)[index] : null;
      if (!action) throw fail('That button isn’t on this answer anymore.', 404);
      // A quick scan's Start scan also keeps the run it started, so the reopened card follows that run live.
      const runId = typeof detail.runId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(detail.runId) ? detail.runId : '';
      action.outcome = { status: OUTCOME_STATUSES.includes(detail.status) ? detail.status : 'done', text: clip(detail.text, 300), at: stamp(), ...(runId ? { runId } : {}) };
    }
    writeFile(conversationFile(identityId, conversation.id), conversation);
    return copy(message);
  }

  // ---------- Memory ----------
  function loadMemory(identityId) {
    const { value, found } = readFile(files(identityId).memory, () => ({ version: ASK_VERSION, items: [] }));
    return { version: ASK_VERSION, items: list(found ? value.items : []).filter((item) => item && MEMORY_ID.test(item.id) && typeof item.text === 'string') };
  }
  // Caps: at most MAX_ACTIVE_MEMORY active items (the oldest unpinned go first) and MAX_FORGOTTEN_MEMORY forgotten ones.
  function saveMemoryFile(identityId, memory) {
    const active = memory.items.filter((item) => item.status === 'active');
    const overflow = new Set(active.filter((item) => !item.pinned).sort((a, b) => time(a.updatedAt) - time(b.updatedAt)).slice(0, Math.max(0, active.length - MAX_ACTIVE_MEMORY)).map((item) => item.id));
    const forgotten = memory.items.filter((item) => item.status !== 'active').sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).slice(MAX_FORGOTTEN_MEMORY).map((item) => item.id);
    for (const id of forgotten) overflow.add(id);
    memory.items = memory.items.filter((item) => !overflow.has(item.id));
    writeFile(files(identityId).memory, { version: ASK_VERSION, items: memory.items });
  }
  const visibleTo = (workspaceId) => (item) => item.scope === 'me' || !workspaceId || item.workspaceId === workspaceId;
  const memoryView = (item) => copy(item);
  function cleanItem(input = {}) {
    const text = clip(input.text, MEMORY_TEXT_MAX);
    if (!text) throw fail('Write what Ask AI should remember.');
    if (looksSecret(text)) throw Object.assign(fail('That looks like a password, key or token. Ask AI never keeps those.'), { code: 'askMemorySecret' });
    return { kind: MEMORY_KINDS.includes(input.kind) ? input.kind : 'fact', text, scope: MEMORY_SCOPES.includes(input.scope) ? input.scope : 'me' };
  }

  // Things the model was told to remember: secret-shaped text is dropped, a repeat of an active item only refreshes it,
  // and `replaces` retires the item it supersedes (text "" with replaces just forgets that item). Returns what is new
  // or changed as { id, text }; that list is the "Remembered" card.
  function rememberItems(identityId, items, { workspaceId = '', source = {} } = {}) {
    const memory = loadMemory(identityId); const at = stamp(); const saved = [];
    for (const raw of list(items).slice(0, 3)) {
      const replaces = typeof raw?.replaces === 'string' && MEMORY_ID.test(raw.replaces) ? memory.items.find((item) => item.id === raw.replaces && item.status === 'active' && visibleTo(workspaceId)(item)) : null;
      const text = clip(raw?.text, MEMORY_TEXT_MAX);
      if (replaces && (!text || normalizedText(text) !== normalizedText(replaces.text))) Object.assign(replaces, { status: 'forgotten', updatedAt: at });
      if (!text || looksSecret(text)) continue;
      const scope = MEMORY_SCOPES.includes(raw?.scope) ? raw.scope : 'me';
      const kind = MEMORY_KINDS.includes(raw?.kind) ? raw.kind : 'fact';
      const same = memory.items.find((item) => item.status === 'active' && item.scope === scope && (scope === 'me' || item.workspaceId === workspaceId) && normalizedText(item.text) === normalizedText(text));
      if (same) { Object.assign(same, { kind, updatedAt: at }); continue; }
      const item = { id: newId('mem'), kind, text, scope, workspaceId: scope === 'workspace' ? workspaceId : '', source: { conversationId: String(source.conversationId || ''), messageId: String(source.messageId || '') }, createdAt: at, updatedAt: at, lastUsedAt: '', uses: 0, pinned: false, status: 'active' };
      memory.items.unshift(item); saved.push({ id: item.id, text: item.text });
    }
    saveMemoryFile(identityId, memory);
    return saved;
  }

  function listMemory(identityId, { workspaceId = '', includeForgotten = false } = {}) {
    return loadMemory(identityId).items.filter((item) => (includeForgotten || item.status === 'active') && visibleTo(workspaceId)(item)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || time(b.updatedAt) - time(a.updatedAt)).map(memoryView);
  }
  // From the "What Ask AI remembers" sheet: a new item (no id), an edit, a pin, or bringing a forgotten one back.
  function saveMemory(identityId, input = {}, { workspaceId = '' } = {}) {
    const memory = loadMemory(identityId); const at = stamp();
    if (input.id == null || input.id === '') {
      const item = { id: newId('mem'), ...cleanItem(input), workspaceId: '', source: { conversationId: '', messageId: '' }, createdAt: at, updatedAt: at, lastUsedAt: '', uses: 0, pinned: input.pinned === true, status: 'active' };
      if (item.scope === 'workspace') item.workspaceId = workspaceId;
      const same = memory.items.find((row) => row.status === 'active' && row.scope === item.scope && row.workspaceId === item.workspaceId && normalizedText(row.text) === normalizedText(item.text));
      if (same) { Object.assign(same, { kind: item.kind, pinned: same.pinned || item.pinned, updatedAt: at }); saveMemoryFile(identityId, memory); return memoryView(same); }
      memory.items.unshift(item); saveMemoryFile(identityId, memory); return memoryView(item);
    }
    const item = memory.items.find((row) => row.id === input.id);
    if (!item) throw fail('Ask AI doesn’t remember that anymore.', 404);
    if (input.text !== undefined || input.kind !== undefined || input.scope !== undefined) {
      const next = cleanItem({ text: input.text ?? item.text, kind: input.kind ?? item.kind, scope: input.scope ?? item.scope });
      Object.assign(item, next, { workspaceId: next.scope === 'workspace' ? item.workspaceId || workspaceId : '' });
    }
    if (input.pinned !== undefined) item.pinned = input.pinned === true;
    if (input.status === 'active') item.status = 'active';
    item.updatedAt = at;
    saveMemoryFile(identityId, memory);
    return memoryView(item);
  }
  function forgetMemory(identityId, id) {
    const memory = loadMemory(identityId);
    const item = typeof id === 'string' ? memory.items.find((row) => row.id === id) : null;
    if (!item) throw fail('Ask AI doesn’t remember that anymore.', 404);
    Object.assign(item, { status: 'forgotten', pinned: false, updatedAt: stamp() });
    saveMemoryFile(identityId, memory);
    return memoryView(item);
  }

  // The memories worth putting in front of this question: lexical match against the question and page, boosted for
  // pinned items, recent ones, ones used before and ones naming a live trend, program or report. Returns at most
  // `limit` items within `maxChars`, and counts them as used.
  function recall(identityId, { workspaceId = '', query = '', names = [], limit = 12, maxChars = 2500 } = {}) {
    const memory = loadMemory(identityId);
    const pool = memory.items.filter((item) => item.status === 'active' && (item.scope === 'me' || item.workspaceId === workspaceId));
    if (!pool.length) return [];
    const lexical = bm25(pool.map((item) => tokens(item.text)), tokens(query));
    const live = [...new Set(list(names).map(phrase).filter((name) => name.length >= 4))].slice(0, 300);
    const at = clock();
    const scored = pool.map((item, index) => {
      const text = ` ${phrase(item.text)} `;
      const hits = Math.min(2, live.filter((name) => text.includes(` ${name} `)).length);
      const age = Math.max(0, (at - time(item.updatedAt || item.createdAt)) / DAY_MS);
      return { item, score: lexical[index] + (item.pinned ? PIN_BOOST : 0) + RECENCY_BOOST * Math.exp(-age / 30) + Math.min(USES_BOOST_MAX, 0.25 * Math.log1p(Number(item.uses) || 0)) + hits * NAME_BOOST };
    }).sort((a, b) => b.score - a.score || time(b.item.updatedAt) - time(a.item.updatedAt));
    const chosen = []; let size = 0;
    for (const { item } of scored) {
      if (chosen.length >= limit) break;
      const cost = item.text.length + 40; // the id, kind and scope it is shown with
      if (size + cost > maxChars) continue;
      chosen.push(item); size += cost;
    }
    if (!chosen.length) return [];
    const stampNow = stamp();
    for (const item of chosen) { item.uses = (Number(item.uses) || 0) + 1; item.lastUsedAt = stampNow; }
    saveMemoryFile(identityId, memory);
    return chosen.map(({ id, kind, text, scope, pinned, updatedAt }) => ({ id, kind, text, scope, pinned: Boolean(pinned), updatedAt }));
  }
  // The `memory` lookup: older items beyond the ones recalled, by lexical match only.
  function searchMemory(identityId, { workspaceId = '', query = '', exclude = [], limit = 12 } = {}) {
    const skip = new Set(list(exclude));
    const pool = loadMemory(identityId).items.filter((item) => item.status === 'active' && (item.scope === 'me' || item.workspaceId === workspaceId) && !skip.has(item.id));
    const scores = bm25(pool.map((item) => tokens(item.text)), tokens(query));
    return pool.map((item, index) => ({ item, score: scores[index] })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ item }) => ({ id: item.id, kind: item.kind, text: item.text, scope: item.scope, updatedAt: item.updatedAt }));
  }
  // The `conversation` lookup: "what did we decide about X last week". Scores each stored message (and each title and
  // summary) and returns the best conversations with their best passages.
  function searchConversations(identityId, query, limit = 5, { workspaceId = '', exclude = '' } = {}) {
    const terms = tokens(query);
    if (!terms.length) return [];
    const metas = loadIndex(identityId).conversations.filter((row) => row.id !== exclude && (!workspaceId || row.workspaceId === workspaceId)).sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).slice(0, 100);
    const docs = [];
    for (const meta of metas) {
      const conversation = readConversationFile(identityId, meta.id); if (!conversation) continue;
      docs.push({ conversation, message: null, words: tokens(`${conversation.title} ${conversation.summary || ''}`) });
      for (const message of conversation.messages) if (message.content) docs.push({ conversation, message, words: tokens(message.content) });
    }
    const scores = bm25(docs.map((doc) => doc.words), terms);
    const best = new Map();
    docs.forEach((doc, index) => {
      if (scores[index] <= 0) return;
      const entry = best.get(doc.conversation.id) || { conversation: doc.conversation, hits: [] };
      entry.hits.push({ doc, score: scores[index] }); best.set(doc.conversation.id, entry);
    });
    const raw = String(query).toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    return [...best.values()].map((entry) => ({ ...entry, hits: entry.hits.sort((a, b) => b.score - a.score) }))
      .map((entry) => ({ ...entry, score: entry.hits.slice(0, 2).reduce((sum, hit) => sum + hit.score, 0) }))
      .sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(10, Number(limit) || 5)))
      .map(({ conversation, hits }) => ({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt, summary: clip(conversation.summary, 400), matches: hits.filter((hit) => hit.doc.message).slice(0, 2).map(({ doc }) => ({ role: doc.message.role, text: snippet(doc.message.content, raw), createdAt: doc.message.createdAt })) }));
  }

  // A removed member's conversations and memory go with them (team:remove-member).
  function purge(identityId) {
    if (typeof identityId !== 'string' || !IDENTITY_ID.test(identityId)) return false;
    fs.rmSync(personDir(identityId), { recursive: true, force: true });
    return true;
  }

  return { listConversations, readConversation, history, findByRequest, appendTurn, renameConversation, deleteConversation, recordOutcome, listMemory, saveMemory, forgetMemory, remember: rememberItems, recall, searchMemory, searchConversations, purge, folderKey };
}

module.exports = { createAskStore, askHistory, looksSecret, normalizedText, tokens, bm25, MEMORY_ID, ASK_VERSION, MAX_CONVERSATIONS, MAX_MESSAGES, MAX_ACTIVE_MEMORY, MAX_FORGOTTEN_MEMORY, HISTORY_TURNS, MEMORY_KINDS, MEMORY_SCOPES, MEMORY_TEXT_MAX };
