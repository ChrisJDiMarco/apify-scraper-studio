import { describe, expect, it, vi } from 'vitest';
import sync from '../src/main/monday-sync.js';
import catalog from '../src/shared/monday.json';

// The Monday.com GraphQL client and operations (src/main/monday-sync.js), against recorded-shape responses. No network.
const reply = (body, { status = 200, headers = {} } = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });
const clientWith = (fetchImpl, extra = {}) => sync.createMondayClient({ token: 'fixture-monday-token', fetchImpl, sleep: async () => {}, random: () => 0, ...extra });

describe('the Monday.com client', () => {
  it('sends the pinned API-Version and the token, and counts each call', async () => {
    const fetchImpl = vi.fn(async () => reply({ data: { me: { id: '1', name: 'Dana Lee', email: 'Dana@Example.com', account: { id: '9', name: 'Example', slug: 'example', tier: 'enterprise' } }, complexity: { query: 10, after: 4990, reset_in_x_seconds: 30 } } }));
    const onCall = vi.fn();
    const account = await sync.whoAmI(clientWith(fetchImpl, { onCall }));
    expect(account).toMatchObject({ userId: '1', userName: 'Dana Lee', userEmail: 'dana@example.com', accountName: 'Example', tier: 'enterprise' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.monday.com/v2');
    expect(init.headers['API-Version']).toBe(catalog.apiVersion);
    expect(init.headers.Authorization).toBe('fixture-monday-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('classifies failures into plain kinds', () => {
    const kind = (input) => sync.classifyError(input).kind;
    expect(kind({ status: 401 })).toBe('auth');
    expect(kind({ message: 'User unauthorized to perform action', extensions: { code: 'UserUnauthorizedException' } })).toBe('permission');
    expect(kind({ message: 'Daily limit exceeded', extensions: { code: 'DAILY_LIMIT_EXCEEDED' } })).toBe('daily');
    const complexity = sync.classifyError({ message: 'Complexity budget exhausted', extensions: { code: 'ComplexityException', retry_in_seconds: 17 } });
    expect([complexity.kind, complexity.retryInSeconds]).toEqual(['rate', 17]);
    const tooMany = sync.classifyError({ status: 429, headers: new Headers({ 'Retry-After': '9' }) });
    expect([tooMany.kind, tooMany.retryInSeconds]).toEqual(['rate', 9]);
    expect(kind({ message: 'Concurrency limit exceeded' })).toBe('concurrency');
    expect(kind({ status: 502 })).toBe('server');
    expect(kind({ error: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) })).toBe('timeout');
    const offline = sync.classifyError({ error: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) });
    expect([offline.kind, offline.neverLeft]).toEqual(['network', true]);
    expect(kind({ message: 'Item not found', extensions: { code: 'InvalidItemIdException' } })).toBe('itemMissing');
    expect(kind({ message: 'Board not found', extensions: { code: 'InvalidBoardIdException' } })).toBe('boardMissing');
    expect(kind({ message: 'Column not found', extensions: { code: 'InvalidColumnIdException' } })).toBe('columnMissing');
    expect(kind({ message: 'invalid value', extensions: { code: 'ColumnValueException' } })).toBe('value');
    // Never the token in a message.
    expect(sync.classifyError({ message: 'bad eyJabc.def.ghi' }).detail).not.toMatch(/eyJ/);
  });

  it('retries reads, honours Monday’s wait, and never retries a create that timed out', async () => {
    const waits = [];
    let calls = 0;
    const flaky = vi.fn(async () => (++calls === 1 ? reply({ errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'ComplexityException', retry_in_seconds: 12 } }] }) : reply({ data: { workspaces: [{ id: '5', name: 'Main', kind: 'open' }] } })));
    const read = clientWith(flaky, { sleep: async (ms) => { waits.push(ms); } });
    await expect(sync.listWorkspaces(read)).resolves.toEqual([{ id: '5', name: 'Main', kind: 'open' }]);
    expect(waits).toEqual([12000]);
    const hang = vi.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    const results = await sync.pushChunk(clientWith(hang), '42', [{ kind: 'create', name: 'A', values: {} }]);
    expect(hang).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    // An idempotent update that times out is retried.
    const hang2 = vi.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    await sync.pushChunk(clientWith(hang2), '42', [{ kind: 'update', itemId: '7', values: { s: { label: 'Approved' } } }]);
    expect(hang2).toHaveBeenCalledTimes(1); // timeouts are never retried inside the client (the engine backs off)
    const server = vi.fn(async () => reply({}, { status: 503 }));
    await sync.pushChunk(clientWith(server), '42', [{ kind: 'update', itemId: '7', values: {} }]);
    expect(server).toHaveBeenCalledTimes(4); // 1 + 3 retries for an absolute update
  });

  it('maps per-alias results through errors[].path and isolates a bad op on a top-level failure', async () => {
    const partial = vi.fn(async () => reply({ data: { c0: { id: '100', url: 'https://x.monday.com/boards/42/pulses/100' }, u1: null }, errors: [{ message: 'Item not found', path: ['u1'], extensions: { code: 'InvalidItemIdException' } }] }));
    const results = await sync.pushChunk(clientWith(partial), '42', [{ kind: 'create', name: 'A', values: { s: { label: 'Potential trend' } } }, { kind: 'update', itemId: '7', values: {} }]);
    expect(results[0]).toEqual({ ok: true, id: '100', url: 'https://x.monday.com/boards/42/pulses/100' });
    expect(results[1]).toMatchObject({ ok: false, error: { kind: 'itemMissing' } });
    const query = JSON.parse(partial.mock.calls[0][1].body).query;
    expect(query).toMatch(/c0: create_item\(board_id: \$board, group_id: \$g0, item_name: \$n0, column_values: \$v0, create_labels_if_missing: true\)/);
    expect(query).toMatch(/u1: change_multiple_column_values/);
    let call = 0;
    const isolate = vi.fn(async (_url, init) => {
      call++;
      if (call === 1) return reply({ errors: [{ message: 'invalid value', extensions: { code: 'ColumnValueException' } }] });
      const body = JSON.parse(init.body);
      return body.query.includes('u0:') && body.variables.i0 === '8' ? reply({ errors: [{ message: 'invalid value', extensions: { code: 'ColumnValueException' } }] }) : reply({ data: { u0: { id: body.variables.i0 } } });
    });
    const single = await sync.pushChunk(clientWith(isolate), '42', [{ kind: 'update', itemId: '7', values: {} }, { kind: 'update', itemId: '8', values: {} }]);
    expect(single.map((row) => row.ok)).toEqual([true, false]);
    expect(isolate).toHaveBeenCalledTimes(3);
  });

  it('posts updates with the studio’s marker, HTML-escaped', () => {
    expect(sync.postBody('Reports ready <b>now</b>')).toBe('Scraper Studio · Reports ready &lt;b&gt;now&lt;/b&gt;');
  });

  it('encodes and decodes every column type it writes', () => {
    const pairs = [
      ['status', 'Approved', { label: 'Approved' }, { label: 'Approved', text: 'Approved' }, 'Approved'],
      ['dropdown', ['Blog', 'PR'], { labels: ['Blog', 'PR'] }, { text: 'Blog, PR' }, ['Blog', 'PR']],
      ['text', 'r1:t1', 'r1:t1', { text: 'r1:t1' }, 'r1:t1'],
      ['long_text', 'Notes here', { text: 'Notes here' }, { value: JSON.stringify({ text: 'Notes here' }), text: 'Notes here' }, 'Notes here'],
      ['numbers', 12, '12', { text: '12' }, 12],
      ['date', '2026-10-24', { date: '2026-10-24' }, { date: '2026-10-24' }, '2026-10-24'],
      ['link', { url: 'https://docs.google.com/d/1', text: 'Trends report' }, { url: 'https://docs.google.com/d/1', text: 'Trends report' }, { value: JSON.stringify({ url: 'https://docs.google.com/d/1', text: 'Trends report' }) }, { url: 'https://docs.google.com/d/1', text: 'Trends report' }],
      ['people', ['55'], { personsAndTeams: [{ id: 55, kind: 'person' }] }, { persons_and_teams: [{ id: 55, kind: 'person' }] }, ['55']],
    ];
    for (const [type, value, encoded, column, decoded] of pairs) {
      expect(sync.encodeValue(type, value)).toEqual(encoded);
      expect(sync.decodeValue(type, column)).toEqual(decoded);
    }
    expect(sync.encodeValue('status', '')).toEqual({});
    expect(sync.encodeValue('text', '')).toBe('');
  });

  it('reads board columns, labels from settings JSON in both shapes, and pasted board links', async () => {
    const fetchImpl = vi.fn(async () => reply({ data: { boards: [{ id: '42', name: 'Trends', url: 'https://x.monday.com/boards/42', workspace: { id: '1', name: 'Marketing' }, columns: [{ id: 'name', title: 'Name', type: 'name' }, { id: 'status', title: 'Stage', type: 'status', settings: { labels: [{ id: 1, label: 'Approved' }, { id: 2, label: 'Passed' }] } }, { id: 'priority', title: 'Priority', type: 'status', settings: JSON.stringify({ labels: { 0: 'High', 1: 'Low' } }) }], groups: [{ id: 'g2', title: 'B', position: '2' }, { id: 'g1', title: 'A', position: '1' }] }] } }));
    const board = await sync.describeBoard(clientWith(fetchImpl), '42');
    expect(board.columns.find((column) => column.id === 'status').labels).toEqual(['Approved', 'Passed']);
    expect(board.columns.find((column) => column.id === 'priority').labels).toEqual(['High', 'Low']);
    expect(board.groups.map((group) => group.id)).toEqual(['g1', 'g2']);
    expect(sync.boardIdFrom({ url: 'https://semrush.monday.com/boards/1234567890/views/9' })).toBe('1234567890');
    expect(() => sync.boardIdFrom({ url: 'https://evil.example.com/boards/1' })).toThrow(/board link/);
  });

  it('reads changed items from activity logs without depending on event names, in 100-ns timestamps', async () => {
    const fetchImpl = vi.fn(async () => reply({ data: { boards: [{ activity_logs: [{ id: 'a1', event: 'update_column_value', data: JSON.stringify({ pulse_id: 7, column_id: 'status' }), created_at: '17290000000000000', user_id: 55 }, { id: 'a2', event: 'something_new', data: JSON.stringify({ pulse_ids: [8, 9] }), created_at: '17290000010000000', user_id: 56 }], updates: [{ id: '300', text_body: 'Looks good', created_at: '2026-10-14T10:00:00Z', item_id: '7', creator: { id: '55', name: 'Dana Lee' } }] }] } }));
    const changes = await sync.readChanges(clientWith(fetchImpl), '42', '2026-10-14T09:00:00Z');
    expect(changes.activity.map((row) => row.itemIds)).toEqual([['7'], ['8', '9']]);
    expect(changes.activity[0]).toMatchObject({ columnId: 'status', userId: '55', at: 1729000000000 });
    expect(changes.updates[0]).toMatchObject({ id: '300', itemId: '7', creatorName: 'Dana Lee' });
    expect(changes.needsFull).toBe(false);
  });
});
