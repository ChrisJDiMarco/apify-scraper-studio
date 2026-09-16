export function readinessItems(state = {}, meta = {}, codex = null) {
  return [
    {
      id: 'apify',
      label: 'Apify token',
      tone: state.keys?.APIFY_API_TOKEN ? 'ready' : 'warning',
      detail: state.keys?.APIFY_API_TOKEN ? 'Saved in keychain' : 'Paste APIFY_API_TOKEN to run Actors.',
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      tone: codex?.ok ? 'ready' : codex?.error ? 'warning' : 'neutral',
      detail: codex?.ok ? codex.version || 'Codex available' : codex?.error || 'Not checked yet.',
    },
    {
      id: 'workspace',
      label: 'Local workspace',
      tone: meta?.dataRoot ? 'ready' : 'neutral',
      detail: meta?.dataRoot || 'Loading app data folder.',
    },
  ];
}
