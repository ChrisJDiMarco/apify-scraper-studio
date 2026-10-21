'use strict';
// Monday.com GraphQL client and operations (https://developer.monday.com/api-reference). Stateless: the sync engine
// (monday-engine.js) owns the queue, the store and the rules. Every GraphQL string lives in this file, and the
// API-Version header is pinned in src/shared/monday.json, so a version bump is a one-file change. The token stays in the
// main process and never appears in an error message.
const crypto = require('crypto');
const catalog = require('../shared/monday.json');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const STAGE_LABELS = catalog.stageLabels;
const REQUEST_TIMEOUT_MS = 30000;
const RETRYABLE = new Set(['rate', 'concurrency', 'server', 'network']);
const COMPLEXITY = 'complexity { query after reset_in_x_seconds }';
const STUDIO_POST = 'Golden Thread · ';

// Plain copy for each kind of failure (the engine adds names and times where the copy needs them).
const COPY = {
  auth: 'Monday.com no longer accepts the studio’s token. Connect again in Settings → Monday.com.',
  permission: 'The studio’s Monday account can’t make this change on the board. Give it edit rights on the board.',
  daily: 'Monday.com’s daily API limit is used up.',
  rate: 'Monday.com asked the studio to slow down.',
  concurrency: 'Monday.com is busy with other requests from this account.',
  boardMissing: 'The board is gone, or the studio’s account can’t see it. Choose another board.',
  itemMissing: 'The item is gone from Monday.com.',
  columnMissing: 'A mapped column is gone from the board.',
  value: 'Monday.com didn’t accept a value.',
  timeout: 'Monday.com didn’t answer in time.',
  network: 'Monday.com didn’t answer.',
  server: 'Monday.com had a problem on its side.',
  other: 'Monday.com didn’t accept the request.',
};

class MondayError extends Error {
  constructor(kind, { message, detail = '', retryInSeconds = 0, path = '', neverLeft = false, status = 0 } = {}) {
    super(message || COPY[kind] || COPY.other);
    this.name = 'MondayError'; this.kind = kind; this.detail = redact(detail).slice(0, 160); this.retryInSeconds = retryInSeconds; this.path = path; this.neverLeft = neverLeft;
    if (status) this.status = status;
  }
}

function redact(text) { return String(text || '').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').replace(/\b[a-f0-9]{64}\b/gi, '[secret]').replace(/\s+/g, ' ').trim(); }
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const seconds = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(60, n) : 0; };

// The kind of a failure, from the HTTP status, the error code, then the message.
function classifyError({ status = 0, error = null, headers = null, message = '', code = '', extensions = {} } = {}) {
  if (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return new MondayError('timeout', { detail: error.message });
    const cause = error.cause?.code || error.code || '';
    return new MondayError('network', { detail: `${error.message} ${cause}`, neverLeft: ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(cause) });
  }
  const text = `${message || ''}`; const errorCode = String(code || extensions?.code || '');
  const header = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : '') || '';
  const retryAfter = seconds(extensions?.retry_in_seconds) || seconds(header('retry-after')) || seconds((/(?:^|[;,\s])t=(\d+)/.exec(header('ratelimit')) || [])[1]);
  const detail = `${errorCode} ${text}`.trim();
  if (errorCode === 'DAILY_LIMIT_EXCEEDED' || /daily limit/i.test(text)) return new MondayError('daily', { detail });
  if (/ComplexityException|COMPLEXITY_BUDGET_EXHAUSTED|RATE_LIMIT_EXCEEDED/i.test(errorCode) || /minute limit rate exceeded|complexity budget/i.test(text) || status === 429) return new MondayError('rate', { detail, retryInSeconds: retryAfter || 0 });
  if (/maxConcurrencyExceeded|CONCURRENCY/i.test(errorCode) || /concurrency limit exceeded/i.test(text)) return new MondayError('concurrency', { detail, retryInSeconds: retryAfter || 0 });
  if (status === 401 || /^(?:Unauthorized|NotAuthenticated|USER_UNAUTHORIZED)$/i.test(errorCode) || /not authenticated|invalid token|token .*(?:invalid|expired)/i.test(text)) return new MondayError('auth', { detail });
  if (errorCode === 'UserUnauthorizedException' || status === 403 || /permission|not authorized to/i.test(text)) return new MondayError('permission', { detail });
  if (errorCode === 'InvalidBoardIdException' || /board .*(?:not found|does not exist)|invalid board/i.test(text)) return new MondayError('boardMissing', { detail });
  if (errorCode === 'InvalidItemIdException' || (errorCode === 'ResourceNotFoundException' && /item|pulse/i.test(text)) || /item .*(?:not found|does not exist|deleted)/i.test(text)) return new MondayError('itemMissing', { detail });
  if (errorCode === 'InvalidColumnIdException' || /column .*(?:not found|does not exist)|invalid column/i.test(text)) return new MondayError('columnMissing', { detail });
  if (/ColumnValueException|InvalidArgumentException|CorrectedValueException/i.test(errorCode) || /column value|invalid value|label/i.test(text)) return new MondayError('value', { detail });
  if (status >= 500) return new MondayError('server', { detail: detail || `HTTP ${status}` });
  return new MondayError('other', { detail: detail || (status ? `HTTP ${status}` : '') });
}
const errorFrom = (entry, extra = {}) => classifyError({ message: entry?.message, extensions: entry?.extensions || {}, code: entry?.extensions?.code || entry?.error_code, ...extra });

// request(query, variables, { idempotent, operation, expectedCost }) → { data, errors, complexity }. Retries rate,
// concurrency, server and network failures (up to 3, 2/4/8 s plus jitter or Monday's own wait, at most 60 s) only for
// idempotent requests (reads, and updates that set absolute values) or a request that never left this machine. A create
// that times out is never retried: the engine marks those items 'unsure' and looks them up by Studio key next time.
function createMondayClient({ token, fetchImpl = globalThis.fetch, apiVersion = catalog.apiVersion, timeoutMs = REQUEST_TIMEOUT_MS, onCall = () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random, now = Date.now } = {}) {
  if (!token) throw new MondayError('auth', { message: 'Connect Monday.com in Settings first.' });
  const budget = { after: Infinity, resetAt: 0, costs: {} };
  async function once(query, variables) {
    let response;
    try { response = await fetchImpl(MONDAY_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': apiVersion }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw classifyError({ error }); }
    try { onCall(); } catch (_) { /* counting never fails a call */ }
    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    const errors = Array.isArray(body?.errors) ? body.errors : body?.error_message ? [{ message: body.error_message, extensions: { code: body.error_code } }] : [];
    if (!response.ok || (errors.length && (body?.data == null || !Object.keys(body.data || {}).some((key) => key !== 'complexity' && body.data[key] != null)))) {
      const first = errors[0] || {};
      throw classifyError({ status: response.ok ? 0 : response.status, headers: response.headers, message: first.message || body?.error_message || '', extensions: first.extensions || { code: body?.error_code } });
    }
    return { data: body.data || {}, errors, complexity: body.data?.complexity || null };
  }
  return async function request(query, variables = {}, { idempotent = false, operation = 'call', expectedCost = 0 } = {}) {
    const expected = expectedCost || budget.costs[operation] || 0;
    if (expected && budget.after < 1.2 * expected && budget.resetAt > now()) await sleep(Math.min(60000, budget.resetAt - now()));
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await once(query, variables);
        if (result.complexity) {
          const after = Number(result.complexity.after); const reset = Number(result.complexity.reset_in_x_seconds);
          if (Number.isFinite(after)) budget.after = after;
          if (Number.isFinite(reset)) budget.resetAt = now() + reset * 1000;
          if (Number.isFinite(Number(result.complexity.query))) budget.costs[operation] = Number(result.complexity.query);
        }
        return result;
      } catch (error) {
        if (!(error instanceof MondayError) || !RETRYABLE.has(error.kind) || attempt >= 3 || !(idempotent || error.neverLeft)) throw error;
        const wait = error.retryInSeconds ? error.retryInSeconds * 1000 : 2000 * 2 ** attempt + Math.floor(random() * 1000);
        await sleep(Math.min(60000, wait));
      }
    }
  };
}

// ---------- Values ----------
// encodeValue(type, value) → the column_values entry for that column type; decodeValue(type, columnValue) is the
// inverse, from an items query's column value ({ type, text, value, label, persons_and_teams, date }).
const OBJECT_TYPES = new Set(['status', 'dropdown', 'long_text', 'date', 'link', 'people']);
const empty = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.values(value).some((entry) => entry !== '' && entry != null && !(Array.isArray(entry) && !entry.length)));
function encodeValue(type, value) {
  if (empty(value)) return OBJECT_TYPES.has(type) ? {} : '';
  switch (type) {
    case 'status': return { label: clean(value, 40) };
    case 'dropdown': return { labels: (Array.isArray(value) ? value : [value]).map((label) => clean(label, 40)).filter(Boolean) };
    case 'text': return clean(value, 2000);
    case 'long_text': return { text: String(value).slice(0, 2000) };
    case 'numbers': return String(Number(value) || 0);
    case 'date': return { date: String(value).slice(0, 10) };
    case 'link': return { url: String(value.url || '').slice(0, 1000), text: clean(value.text || value.url, 100) };
    case 'people': return { personsAndTeams: (Array.isArray(value) ? value : [value]).map((id) => ({ id: Number(id) || String(id), kind: 'person' })) };
    default: return String(value);
  }
}
function decodeValue(type, column = {}) {
  let raw = null; try { raw = column.value ? JSON.parse(column.value) : null; } catch (_) { raw = null; }
  switch (type) {
    case 'status': return column.label ?? raw?.label?.text ?? column.text ?? '';
    case 'dropdown': return String(column.text || '').split(',').map((label) => label.trim()).filter(Boolean);
    case 'text': return column.text ?? (typeof raw === 'string' ? raw : '');
    case 'long_text': return raw?.text ?? column.text ?? '';
    case 'numbers': return column.text === '' || column.text == null ? '' : Number(column.text);
    case 'date': return column.date ?? raw?.date ?? '';
    case 'link': return raw?.url ? { url: raw.url, text: raw.text || '' } : '';
    case 'people': return (column.persons_and_teams || raw?.personsAndTeams || []).filter((entry) => entry && entry.kind !== 'team').map((entry) => String(entry.id));
    default: return column.text ?? '';
  }
}
// Status and dropdown labels from a column's settings JSON: older boards give { labels: { "0": "Done" } }, newer ones
// { labels: [{ id, label }] }.
function labelsOf(column = {}) {
  let settings = column.settings;
  if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch (_) { settings = null; } }
  const labels = settings?.labels;
  const out = Array.isArray(labels) ? labels.map((entry) => (typeof entry === 'string' ? entry : entry?.label ?? entry?.name)) : labels && typeof labels === 'object' ? Object.values(labels) : [];
  return [...new Set(out.map((label) => clean(label, 80)).filter(Boolean))];
}

// ---------- Board ids and links ----------
function validateBoardId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw Object.assign(new Error('Enter the board link, or the number in the board’s Monday.com address.'), { status: 400 });
  return id;
}
// https://x.monday.com/boards/123/views/9 (or a bare id) → '123'.
function boardIdFrom({ boardId, url } = {}) {
  if (boardId) return validateBoardId(boardId);
  const match = /^https:\/\/[a-z0-9-]+\.monday\.com\/boards\/(\d{1,20})(?:[/?#]|$)/i.exec(String(url || '').trim());
  if (!match) throw Object.assign(new Error('Paste a board link like https://yourteam.monday.com/boards/1234567890.'), { status: 400 });
  return match[1];
}
const need = (result, path) => { const value = path.split('.').reduce((node, key) => node?.[key], result.data); if (result.errors?.length && value == null) throw errorFrom(result.errors[0]); return value; };

// ---------- Operations ----------
async function whoAmI(request) {
  const result = await request(`query { ${COMPLEXITY} me { id name email account { id name slug tier } } }`, {}, { idempotent: true, operation: 'whoAmI' });
  const me = need(result, 'me') || {};
  return { userId: String(me.id || ''), userName: clean(me.name, 120), userEmail: clean(me.email, 254).toLowerCase(), accountId: String(me.account?.id || ''), accountName: clean(me.account?.name, 120), slug: clean(me.account?.slug, 80), tier: clean(me.account?.tier, 40).toLowerCase() };
}
async function listWorkspaces(request) {
  const result = await request(`query { ${COMPLEXITY} workspaces(limit: 100) { id name kind } }`, {}, { idempotent: true, operation: 'listWorkspaces' });
  return (need(result, 'workspaces') || []).map((row) => ({ id: String(row.id), name: clean(row.name, 120) || 'Main workspace', kind: row.kind || '' }));
}
async function listBoards(request, { workspaceId = '', search = '', page = 1 } = {}) {
  const ws = workspaceId ? [validateBoardId(workspaceId)] : null;
  const result = await request(`query ($page: Int, $ws: [ID]) { ${COMPLEXITY} boards(limit: 50, page: $page, workspace_ids: $ws, state: active, order_by: used_at) { id name url type items_count workspace { id name } } }`, { page: Math.max(1, Math.floor(Number(page) || 1)), ws }, { idempotent: true, operation: 'listBoards' });
  const rows = need(result, 'boards') || [];
  const term = clean(search, 80).toLowerCase();
  const boards = rows.filter((row) => (row.type || 'board') === 'board' && (!term || String(row.name || '').toLowerCase().includes(term)))
    .map((row) => ({ id: String(row.id), name: clean(row.name, 160), url: String(row.url || ''), workspaceName: clean(row.workspace?.name, 120) || 'Main workspace', itemsCount: Number(row.items_count) || 0 }));
  return { boards, more: rows.length === 50 };
}
async function describeBoard(request, boardId) {
  const result = await request(`query ($ids: [ID!]) { ${COMPLEXITY} boards(ids: $ids) { id name url items_count workspace { id name } columns { id title type settings } groups { id title position } } }`, { ids: [validateBoardId(boardId)] }, { idempotent: true, operation: 'describeBoard' });
  const board = (need(result, 'boards') || [])[0];
  if (!board) throw new MondayError('boardMissing');
  return {
    id: String(board.id), name: clean(board.name, 160), url: String(board.url || ''), workspaceName: clean(board.workspace?.name, 120) || 'Main workspace', itemsCount: Number(board.items_count) || 0,
    columns: (board.columns || []).map((column) => ({ id: String(column.id), title: clean(column.title, 120), type: String(column.type || ''), ...(['status', 'dropdown'].includes(column.type) ? { labels: labelsOf(column) } : {}) })),
    groups: (board.groups || []).sort((a, b) => Number(a.position) - Number(b.position)).map((group) => ({ id: String(group.id), title: clean(group.title, 120) })),
  };
}
async function createBoard(request, { name, kind = 'public', workspaceId = '' }) {
  const result = await request(`mutation ($name: String!, $kind: BoardKind!, $ws: ID) { ${COMPLEXITY} create_board(board_name: $name, board_kind: $kind, workspace_id: $ws, empty: true) { id url } }`, { name: clean(name, 160) || 'Trends', kind: kind === 'private' ? 'private' : 'public', ws: workspaceId || null }, { operation: 'createBoard' });
  const board = need(result, 'create_board');
  return { id: String(board.id), url: String(board.url || '') };
}
async function createColumns(request, boardId, specs) {
  if (!specs.length) return [];
  if (specs.some((spec) => !/^[a-z_]{2,20}$/.test(spec.type))) throw new MondayError('other', { message: 'That column type isn’t one the studio can add.' });
  const parts = specs.map((spec, index) => `c${index}: create_column(board_id: $board, title: $t${index}, column_type: ${spec.type}${spec.id ? `, id: $i${index}` : ''}) { id title type }`);
  const variables = { board: validateBoardId(boardId) }; const defs = ['$board: ID!'];
  specs.forEach((spec, index) => { variables[`t${index}`] = clean(spec.title, 120); defs.push(`$t${index}: String!`); if (spec.id) { variables[`i${index}`] = spec.id; defs.push(`$i${index}: String`); } });
  const result = await request(`mutation (${defs.join(', ')}) { ${COMPLEXITY} ${parts.join(' ')} }`, variables, { operation: 'createColumns' });
  return specs.map((spec, index) => { const column = result.data[`c${index}`]; const error = result.errors.find((entry) => entry.path?.[0] === `c${index}`); return column ? { ok: true, field: spec.field, id: String(column.id), title: column.title, type: column.type } : { ok: false, field: spec.field, error: error ? errorFrom(error) : new MondayError('other') }; });
}
async function createGroups(request, boardId, names) {
  if (!names.length) return [];
  const variables = { board: validateBoardId(boardId) }; const defs = ['$board: ID!'];
  const parts = names.map((name, index) => { variables[`n${index}`] = clean(name, 120) || 'Trends'; defs.push(`$n${index}: String!`); return `g${index}: create_group(board_id: $board, group_name: $n${index}) { id }`; });
  const result = await request(`mutation (${defs.join(', ')}) { ${COMPLEXITY} ${parts.join(' ')} }`, variables, { operation: 'createGroups' });
  return names.map((name, index) => String(result.data[`g${index}`]?.id || ''));
}
async function deleteGroup(request, boardId, groupId) {
  await request(`mutation ($board: ID!, $group: String!) { ${COMPLEXITY} delete_group(board_id: $board, group_id: $group) { id } }`, { board: validateBoardId(boardId), group: String(groupId) }, { idempotent: true, operation: 'deleteGroup' });
}
// Items whose Studio key column holds one of `keys` (≤100), oldest first.
async function findItemsByKey(request, boardId, keyColumnId, keys) {
  if (!keys.length) return [];
  const result = await request(`query ($board: ID!, $col: String!, $keys: [String]!, $cols: [String!]) { ${COMPLEXITY} items_page_by_column_values(board_id: $board, limit: 500, columns: [{ column_id: $col, column_values: $keys }]) { items { id url name created_at group { id } column_values(ids: $cols) { id text } } } }`, { board: validateBoardId(boardId), col: keyColumnId, keys: keys.slice(0, 100), cols: [keyColumnId] }, { idempotent: true, operation: 'findItemsByKey' });
  const items = need(result, 'items_page_by_column_values')?.items || [];
  return items.map((item) => ({ itemId: String(item.id), url: String(item.url || ''), name: item.name || '', key: String(item.column_values?.[0]?.text || '').trim(), groupId: String(item.group?.id || ''), createdAt: item.created_at || '' }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || Number(a.itemId) - Number(b.itemId));
}

// One aliased mutation for up to 10 ops: { kind: 'create'|'update'|'move'|'post', itemId, groupId, name, values, body }.
// Returns one { ok, id, url, error } per op, read from data and errors[].path. A top-level failure with several ops is
// resent one op at a time to isolate the bad one, except when nothing can be retried safely (a lost create or post):
// then every op carries the error and the engine decides (creates become 'unsure').
function chunkDocument(boardId, ops) {
  const variables = { board: validateBoardId(boardId) }; const defs = ['$board: ID!']; const parts = [];
  ops.forEach((op, i) => {
    if (op.kind === 'create') {
      variables[`n${i}`] = clean(op.name, 255) || 'Untitled trend'; variables[`v${i}`] = JSON.stringify(op.values || {}); variables[`g${i}`] = op.groupId || null;
      defs.push(`$n${i}: String!`, `$v${i}: JSON`, `$g${i}: String`);
      parts.push(`c${i}: create_item(board_id: $board, group_id: $g${i}, item_name: $n${i}, column_values: $v${i}, create_labels_if_missing: true) { id url }`);
    } else if (op.kind === 'update') {
      variables[`i${i}`] = String(op.itemId); variables[`v${i}`] = JSON.stringify(op.values || {});
      defs.push(`$i${i}: ID!`, `$v${i}: JSON!`);
      parts.push(`u${i}: change_multiple_column_values(board_id: $board, item_id: $i${i}, column_values: $v${i}, create_labels_if_missing: true) { id }`);
    } else if (op.kind === 'move') {
      variables[`i${i}`] = String(op.itemId); variables[`g${i}`] = String(op.groupId);
      defs.push(`$i${i}: ID!`, `$g${i}: String!`);
      parts.push(`m${i}: move_item_to_group(item_id: $i${i}, group_id: $g${i}) { id }`);
    } else if (op.kind === 'post') {
      variables[`i${i}`] = String(op.itemId); variables[`b${i}`] = postBody(op.body);
      defs.push(`$i${i}: ID!`, `$b${i}: String!`);
      parts.push(`p${i}: create_update(item_id: $i${i}, body: $b${i}) { id }`);
    }
  });
  return { query: `mutation (${defs.join(', ')}) { ${COMPLEXITY} ${parts.join(' ')} }`, variables };
}
const ALIAS = { create: 'c', update: 'u', move: 'm', post: 'p' };
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function postBody(text) { return `${STUDIO_POST}${escapeHtml(String(text || '').slice(0, 1500))}`; }
async function pushChunk(request, boardId, ops) {
  if (!ops.length) return [];
  const idempotent = ops.every((op) => op.kind === 'update' || op.kind === 'move');
  const { query, variables } = chunkDocument(boardId, ops);
  let result;
  try { result = await request(query, variables, { idempotent, operation: `push${ops.length}` }); }
  catch (error) {
    if (!(error instanceof MondayError)) throw error;
    // Run-level problems stop the run; the engine pauses or backs off.
    if (['auth', 'permission', 'daily', 'boardMissing', 'rate', 'concurrency'].includes(error.kind)) throw error;
    const lost = ['timeout', 'network', 'server'].includes(error.kind) && !error.neverLeft;
    if (ops.length === 1 || lost) return ops.map(() => ({ ok: false, error }));
    const single = [];
    for (const op of ops) single.push(...(await pushChunk(request, boardId, [op])));
    return single;
  }
  return ops.map((op, i) => {
    const alias = `${ALIAS[op.kind]}${i}`; const node = result.data[alias];
    if (node) return { ok: true, id: String(node.id || ''), url: String(node.url || '') };
    const entry = result.errors.find((row) => Array.isArray(row.path) && row.path[0] === alias) || result.errors[0];
    return { ok: false, error: entry ? errorFrom(entry, { path: alias }) : new MondayError('other') };
  });
}
// Current values of up to 100 items: name, state, group, the mapped columns, and (when asked) their latest updates.
async function readItems(request, ids, columnIds = [], { updates = false } = {}) {
  if (!ids.length) return [];
  const result = await request(`query ($ids: [ID!], $cols: [String!]) { ${COMPLEXITY} items(ids: $ids, limit: 100) { id name state url updated_at group { id } column_values(ids: $cols) { id type text value ... on StatusValue { label } ... on PeopleValue { persons_and_teams { id kind } } ... on DateValue { date } }${updates ? ' updates(limit: 10) { id text_body created_at creator { id name } }' : ''} } }`, { ids: ids.slice(0, 100).map(String), cols: columnIds.filter(Boolean) }, { idempotent: true, operation: 'readItems' });
  return (need(result, 'items') || []).map((item) => ({ itemId: String(item.id), name: item.name || '', state: item.state || 'active', url: String(item.url || ''), updatedAt: item.updated_at || '', groupId: String(item.group?.id || ''), columns: Object.fromEntries((item.column_values || []).map((column) => [String(column.id), column])), updates: (item.updates || []).map((row) => ({ id: String(row.id), text: String(row.text_body || ''), at: row.created_at || '', creatorId: String(row.creator?.id || ''), creatorName: clean(row.creator?.name, 120) })) }));
}
// Monday's 17-digit activity timestamps are 100-nanosecond units: ms = round(value / 10000).
const activityMs = (value) => { const text = String(value || ''); if (/^\d{15,19}$/.test(text)) return Math.round(Number(text) / 10000); const ms = Date.parse(text); return Number.isFinite(ms) ? ms : 0; };
// What changed on the board since `from` (ISO): activity rows (the changed item from data.pulse_id or data.pulse_ids, so
// no event name matters) and the board's newest updates. Pages up to 5 times, then asks for a full reconcile.
async function readChanges(request, boardId, from) {
  const activity = []; let updates = []; let needsFull = false;
  for (let page = 1; page <= 5; page++) {
    const result = await request(`query ($ids: [ID!], $from: ISO8601DateTime, $page: Int) { ${COMPLEXITY} boards(ids: $ids) { activity_logs(from: $from, limit: 100, page: $page) { id event data created_at user_id }${page === 1 ? ' updates(limit: 25) { id text_body created_at item_id creator { id name } }' : ''} } }`, { ids: [validateBoardId(boardId)], from: from || null, page }, { idempotent: true, operation: 'readChanges' });
    const board = (need(result, 'boards') || [])[0];
    if (!board) throw new MondayError('boardMissing');
    if (page === 1) updates = (board.updates || []).map((row) => ({ id: String(row.id), itemId: String(row.item_id || ''), text: String(row.text_body || ''), at: row.created_at || '', creatorId: String(row.creator?.id || ''), creatorName: clean(row.creator?.name, 120) }));
    const rows = board.activity_logs || [];
    for (const row of rows) {
      let data = {}; try { data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {}; } catch (_) { data = {}; }
      const ids = [data.pulse_id, ...(Array.isArray(data.pulse_ids) ? data.pulse_ids : [])].filter((id) => id != null && /^\d+$/.test(String(id))).map(String);
      activity.push({ id: String(row.id), event: String(row.event || ''), at: activityMs(row.created_at), userId: String(row.user_id || ''), itemIds: ids, columnId: data.column_id ? String(data.column_id) : '' });
    }
    if (rows.length < 100) break;
    if (page === 5) needsFull = true;
  }
  return { activity, updates, needsFull };
}
async function listWebhooks(request, boardId) {
  const result = await request(`query ($board: ID!) { ${COMPLEXITY} webhooks(board_id: $board) { id event board_id config } }`, { board: validateBoardId(boardId) }, { idempotent: true, operation: 'listWebhooks' });
  return (need(result, 'webhooks') || []).map((row) => ({ id: String(row.id), event: String(row.event || ''), boardId: String(row.board_id || '') }));
}
async function createWebhook(request, boardId, url, event) {
  const result = await request(`mutation ($board: ID!, $url: String!, $event: WebhookEventType!) { ${COMPLEXITY} create_webhook(board_id: $board, url: $url, event: $event) { id } }`, { board: validateBoardId(boardId), url, event }, { operation: 'createWebhook' });
  return String(need(result, 'create_webhook')?.id || '');
}
async function deleteWebhook(request, id) {
  await request(`mutation ($id: ID!) { ${COMPLEXITY} delete_webhook(id: $id) { id } }`, { id: String(id) }, { idempotent: true, operation: 'deleteWebhook' });
}
async function findUsers(request, { ids = [], emails = [] } = {}) {
  if (!ids.length && !emails.length) return [];
  const result = await request(`query ($ids: [ID!], $emails: [String]) { ${COMPLEXITY} users(ids: $ids, emails: $emails, limit: 100) { id name email } }`, { ids: ids.length ? ids.map(String) : null, emails: emails.length ? emails : null }, { idempotent: true, operation: 'findUsers' });
  return (need(result, 'users') || []).map((user) => ({ id: String(user.id), name: clean(user.name, 120), email: clean(user.email, 254).toLowerCase() }));
}

const sha1 = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

module.exports = {
  MONDAY_API_URL, STAGE_LABELS, REQUEST_TIMEOUT_MS, STUDIO_POST, COPY, MondayError, classifyError, createMondayClient,
  encodeValue, decodeValue, labelsOf, validateBoardId, boardIdFrom, activityMs, postBody, sha1, redact,
  whoAmI, listWorkspaces, listBoards, describeBoard, createBoard, createColumns, createGroups, deleteGroup, findItemsByKey, pushChunk, readItems, readChanges,
  listWebhooks, createWebhook, deleteWebhook, findUsers,
};
