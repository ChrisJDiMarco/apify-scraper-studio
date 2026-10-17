// Settings → Connection diagnostics. The third argument is either the AI connections status (getAiConnections: one row
// per connection) or, from older screens, a Codex CLI check result.
const AI_TONE = { ready: 'ready', 'sign-in': 'warning', update: 'warning', 'key-unreadable': 'warning', 'not-installed': 'neutral', 'no-key': 'neutral' };
export function readinessItems(state = {}, meta = {}, ai = null) {
  const connections = Array.isArray(ai?.connections) ? ai.connections : null;
  const aiRows = connections
    ? connections.map((row) => ({ id: `ai-${row.id}`, label: row.label || row.id, tone: AI_TONE[row.status] || 'neutral', detail: row.detail || (row.status === 'ready' ? 'Ready' : 'Not set up yet.') }))
    : [{
      id: 'codex',
      label: 'Codex CLI',
      tone: ai?.ok ? 'ready' : ai?.error ? 'warning' : 'neutral',
      detail: ai?.ok ? ai.version || 'Codex available' : ai?.error || 'Not checked yet.',
    }];
  return [
    {
      id: 'apify',
      label: 'Apify token',
      tone: state.keys?.APIFY_API_TOKEN ? 'ready' : 'warning',
      detail: state.keys?.APIFY_API_TOKEN ? 'Saved in keychain' : 'Paste APIFY_API_TOKEN to run Actors.',
    },
    ...aiRows,
    {
      id: 'workspace',
      label: 'Local workspace',
      tone: meta?.dataRoot ? 'ready' : 'neutral',
      detail: meta?.dataRoot || 'Loading app data folder.',
    },
  ];
}
