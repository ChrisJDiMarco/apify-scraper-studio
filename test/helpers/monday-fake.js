// A small in-memory Monday.com board behind a fetch stand-in, for the Monday sync tests (no network). It answers the
// GraphQL documents src/main/monday-sync.js sends, by recognising each operation and reading its variables.
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body });

function createMondayFake({ boardId = '42', columns = [], groups = [], userId = '1' } = {}) {
  const board = { id: boardId, name: 'Trends', url: `https://x.monday.com/boards/${boardId}`, columns: [{ id: 'name', title: 'Name', type: 'name' }, ...columns], groups: groups.length ? groups : [{ id: 'topics', title: 'Group Title', position: '1' }] };
  const items = new Map(); const activity = []; const updates = []; const calls = []; const webhooks = new Map();
  const users = new Map([[userId, { id: userId, name: 'Studio Bot', email: 'bot@example.com' }]]);
  let nextId = 1000; let failNext = null; let failWhen = null;
  const columnType = (id) => board.columns.find((column) => column.id === id)?.type || 'text';
  function setColumn(item, id, value) {
    if (id === 'name') { item.name = value; return; }
    if (!board.columns.some((column) => column.id === id)) throw Object.assign(new Error(`Column not found: ${id}`), { code: 'InvalidColumnIdException' });
    item.columns[id] = value;
  }
  function columnValue(item, id) {
    const type = columnType(id); const value = item.columns[id];
    if (type === 'status') return { id, type, text: value?.label || '', value: value ? JSON.stringify(value) : null, label: value?.label || '' };
    if (type === 'people') return { id, type, text: '', value: value ? JSON.stringify(value) : null, persons_and_teams: (value?.personsAndTeams || []).map((p) => ({ id: String(p.id), kind: p.kind })) };
    if (type === 'date') return { id, type, text: value?.date || '', value: value ? JSON.stringify(value) : null, date: value?.date || '' };
    if (type === 'long_text') return { id, type, text: value?.text || '', value: value ? JSON.stringify(value) : null };
    return { id, type, text: typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value), value: value == null ? null : JSON.stringify(value) };
  }
  function add({ name, groupId, values = {}, createdAt }) {
    const id = String(nextId++);
    const item = { id, name, groupId: groupId || board.groups[0].id, columns: {}, state: 'active', createdAt: createdAt || new Date(Date.UTC(2026, 9, 1, 0, 0, Number(id) % 60)).toISOString(), updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(values)) setColumn(item, key, value);
    items.set(id, item); return item;
  }
  function mutate(query, variables) {
    const data = {}; const errors = [];
    for (const [, alias, op] of query.matchAll(/\b([cumpg]\d+): (create_item|change_multiple_column_values|move_item_to_group|create_update|create_group)\(/g)) {
      const i = alias.slice(1);
      try {
        if (failWhen) { const error = failWhen({ alias, op, variables, i }); if (error) throw error; }
        if (op === 'create_item') { const item = add({ name: variables[`n${i}`], groupId: variables[`g${i}`], values: JSON.parse(variables[`v${i}`] || '{}') }); data[alias] = { id: item.id, url: `${board.url}/pulses/${item.id}` }; }
        else if (op === 'change_multiple_column_values') { const item = items.get(String(variables[`i${i}`])); if (!item || item.state === 'deleted') throw Object.assign(new Error('Item not found'), { code: 'InvalidItemIdException' }); for (const [key, value] of Object.entries(JSON.parse(variables[`v${i}`]))) setColumn(item, key, value); data[alias] = { id: item.id }; }
        else if (op === 'move_item_to_group') { const item = items.get(String(variables[`i${i}`])); item.groupId = variables[`g${i}`]; data[alias] = { id: item.id }; }
        else if (op === 'create_update') { const update = { id: String(nextId++), itemId: String(variables[`i${i}`]), text: variables[`b${i}`], creatorId: userId, creatorName: 'Studio Bot', at: new Date().toISOString() }; updates.push(update); data[alias] = { id: update.id }; }
        else if (op === 'create_group') { const group = { id: `group_${nextId++}`, title: variables[`n${i}`], position: String(board.groups.length + 1) }; board.groups.push(group); data[alias] = { id: group.id }; }
      } catch (error) { data[alias] = null; errors.push({ message: error.message, path: [alias], extensions: { code: error.code || 'ColumnValueException' } }); }
    }
    return { data, errors };
  }
  async function fetchImpl(_url, init) {
    const { query, variables = {} } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (failNext) { const fail = failNext; failNext = null; const out = await fail({ query, variables }); if (out) return out; }
    if (/\bme \{/.test(query)) return reply({ data: { me: { id: userId, name: 'Studio Bot', email: 'bot@example.com', account: { id: '9', name: 'Example', slug: 'example', tier: 'standard' } } } });
    if (query.includes('items_page_by_column_values')) {
      const col = variables.col; const keys = new Set(variables.keys);
      const found = [...items.values()].filter((item) => item.state === 'active' && keys.has(item.columns[col]));
      return reply({ data: { items_page_by_column_values: { items: found.map((item) => ({ id: item.id, url: `${board.url}/pulses/${item.id}`, name: item.name, created_at: item.createdAt, group: { id: item.groupId }, column_values: [{ id: col, text: item.columns[col] }] })) } } });
    }
    if (query.startsWith('mutation')) { const { data, errors } = mutate(query, variables); return reply(errors.length ? { data, errors } : { data }); }
    if (query.includes('activity_logs')) return reply({ data: { boards: [{ activity_logs: activity.filter((row) => !variables.from || row.isoAt >= variables.from).map(({ isoAt, ...row }) => row), updates: updates.slice(-25).reverse().map((row) => ({ id: row.id, text_body: row.text, created_at: row.at, item_id: row.itemId, creator: { id: row.creatorId, name: row.creatorName } })) }] } });
    if (/items\(ids: \$ids/.test(query)) {
      const rows = variables.ids.map((id) => items.get(String(id))).filter((item) => item && item.state !== 'deleted');
      return reply({ data: { items: rows.map((item) => ({ id: item.id, name: item.name, state: item.state, url: `${board.url}/pulses/${item.id}`, updated_at: item.updatedAt, group: { id: item.groupId }, column_values: (variables.cols || []).map((id) => columnValue(item, id)), updates: updates.filter((row) => row.itemId === item.id).slice(-10).reverse().map((row) => ({ id: row.id, text_body: row.text, created_at: row.at, creator: { id: row.creatorId, name: row.creatorName } })) })) } });
    }
    if (/users\(/.test(query)) return reply({ data: { users: (variables.ids || []).map((id) => users.get(String(id))).filter(Boolean) } });
    if (/boards\(ids: \$ids\) \{ id name url workspace/.test(query)) return reply({ data: { boards: [{ ...board, workspace: { id: '1', name: 'Marketing' } }] } });
    if (/webhooks\(board_id/.test(query)) return reply({ data: { webhooks: [...webhooks.values()] } });
    return reply({ errors: [{ message: `Unhandled query: ${query.slice(0, 80)}` }] });
  }
  // A change someone made on Monday: the column value and an activity row (17-digit timestamp) by that user.
  function changeOnMonday(itemId, columnId, value, { by = '55', at = Date.now() } = {}) {
    const item = items.get(String(itemId)); item.columns[columnId] = value; item.updatedAt = new Date(at).toISOString();
    activity.push({ id: `act-${nextId++}`, event: 'update_column_value', data: JSON.stringify({ pulse_id: Number(itemId), column_id: columnId }), created_at: String(at * 10000), user_id: by, isoAt: new Date(at - 1000).toISOString() });
  }
  function comment(itemId, text, { by = '55', name = 'Dana Lee' } = {}) { const update = { id: String(nextId++), itemId: String(itemId), text, creatorId: by, creatorName: name, at: new Date().toISOString() }; updates.push(update); return update; }
  return { fetchImpl, board, items, updates, activity, calls, users, webhooks, add, changeOnMonday, comment, failNext: (fn) => { failNext = fn; }, failWhen: (fn) => { failWhen = fn; }, mutations: () => calls.filter((call) => call.query.startsWith('mutation')) };
}

module.exports = { createMondayFake, reply };
