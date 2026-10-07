// Monday.com mirror of the trend board. One Monday item per trend card; its status column follows the card's stage.
// Uses the public GraphQL API (https://developer.monday.com/api-reference). The token stays in the main process.
const MONDAY_API_URL = 'https://api.monday.com/v2';
const STAGE_LABELS = { potential: 'Potential trend', approved: 'Approved', production: 'In production', ready: 'Ready to use', passed: 'Passed' };
const MAX_CARDS = 200;
const FATAL = /rejected the token|short break/;

function clean(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }

function validateBoardId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new Error('Enter the numeric board ID from the board’s Monday.com URL.');
  return id;
}

// Cards arrive from the renderer; keep only the fields Monday needs, bounded.
function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length > MAX_CARDS) throw new Error(`Sync up to ${MAX_CARDS} trends at a time.`);
  return cards.map((card) => {
    const key = clean(card?.key, 400);
    if (!key || !STAGE_LABELS[card?.stage]) throw new Error('A trend card is missing its board position.');
    return { key, stage: card.stage, name: clean(card.name, 255) || 'Untitled trend', description: clean(card.description, 2000), evidenceCount: Math.max(0, Number(card.evidenceCount) || 0), platforms: (Array.isArray(card.platforms) ? card.platforms : []).map((p) => clean(p, 40)).slice(0, 8), programName: clean(card.programName, 160) };
  });
}

function itemNotes(card) {
  const sources = card.platforms.length ? ` from ${card.platforms.join(', ')}` : '';
  return [card.description, `${card.evidenceCount} source${card.evidenceCount === 1 ? '' : 's'}${sources}.`, card.programName && `Research program: ${card.programName}.`].filter(Boolean).join('\n\n');
}

function columnValues(card, { statusColumnId, notesColumnId }) {
  const values = {};
  if (statusColumnId) values[statusColumnId] = { label: STAGE_LABELS[card.stage] };
  if (notesColumnId) values[notesColumnId] = { text: itemNotes(card) };
  return JSON.stringify(values);
}

function createMondayClient({ token, fetchImpl = globalThis.fetch, apiVersion = '' }) {
  if (!token) throw new Error('Connect Monday.com in Settings first.');
  return async function request(query, variables = {}) {
    const response = await fetchImpl(MONDAY_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token, ...(apiVersion ? { 'API-Version': apiVersion } : {}) }, body: JSON.stringify({ query, variables }) });
    let body = {};
    try { body = await response.json(); } catch { /* handled below */ }
    if (response.status === 401 || response.status === 403) throw new Error('Monday.com rejected the token. Paste a fresh personal API token in Settings.');
    if (response.status === 429) throw new Error('Monday.com asked for a short break. Try the sync again in a minute.');
    const message = body.errors?.[0]?.message || body.error_message;
    if (!response.ok || message) throw new Error(`Monday.com: ${message || `request failed (${response.status})`}`);
    return body.data;
  };
}

// Reads the board and picks the first Status and Long text columns so setup is just a board ID.
async function describeBoard(request, boardId) {
  const data = await request('query ($ids: [ID!]) { boards(ids: $ids) { id name columns { id title type } } }', { ids: [validateBoardId(boardId)] });
  const board = data?.boards?.[0];
  if (!board) throw new Error('No Monday.com board with that ID is visible to this token.');
  const columns = Array.isArray(board.columns) ? board.columns : [];
  const statusColumn = columns.find((column) => column.type === 'status');
  const notesColumn = columns.find((column) => column.type === 'long_text');
  return { boardId: String(board.id), boardName: board.name, statusColumnId: statusColumn?.id || '', notesColumnId: notesColumn?.id || '', warnings: statusColumn ? [] : ['Add a Status column to this board so trends show their stage.'] };
}

// Creates missing items and updates existing ones. Returns the item ID map to persist for next time.
async function syncTrendCards(request, { boardId, statusColumnId = '', notesColumnId = '', itemIds = {} }, cards) {
  const board = validateBoardId(boardId);
  const nextIds = { ...itemIds };
  const results = { created: 0, updated: 0, failed: [] };
  for (const card of validateCards(cards)) {
    const values = columnValues(card, { statusColumnId, notesColumnId });
    try {
      if (nextIds[card.key]) {
        try {
          await request('mutation ($board: ID!, $item: ID!, $values: JSON!) { change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values, create_labels_if_missing: true) { id } }', { board, item: nextIds[card.key], values });
          results.updated++;
          continue;
        } catch (error) {
          if (FATAL.test(error.message)) throw error;
          delete nextIds[card.key]; // the item was deleted or moved on Monday; recreate it below
        }
      }
      const data = await request('mutation ($board: ID!, $name: String!, $values: JSON) { create_item(board_id: $board, item_name: $name, column_values: $values, create_labels_if_missing: true) { id } }', { board, name: card.name, values });
      nextIds[card.key] = String(data?.create_item?.id || '');
      results.created++;
    } catch (error) {
      results.failed.push({ key: card.key, name: card.name, error: error.message });
      if (FATAL.test(error.message)) break; // the rest would fail the same way
    }
  }
  return { itemIds: nextIds, ...results };
}

module.exports = { MONDAY_API_URL, STAGE_LABELS, validateBoardId, validateCards, itemNotes, columnValues, createMondayClient, describeBoard, syncTrendCards };
