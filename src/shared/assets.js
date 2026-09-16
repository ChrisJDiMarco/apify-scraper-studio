export function cardFromAsset(asset = {}) {
  const tags = [...new Set([asset.channel, asset.assetType].filter(Boolean).map(String))];
  const markdown = String(asset.markdown || asset.error || '').replace(/\s+/g, ' ').trim();
  return {
    title: String(asset.title || asset.assetType || 'Asset follow-up').trim(),
    description: markdown.slice(0, 500),
    column: 'ready',
    tags,
    signalCount: Array.isArray(asset.evidenceIds) ? String(asset.evidenceIds.length) : '',
    signalChange: 'Asset',
    priority: asset.status || 'asset',
  };
}

export function cardDraftFromInput(input = {}, dataset = null) {
  const tags = [...new Set(String(input.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean))];
  const title = String(input.title || dataset?.name || '').trim();
  if (!title) throw new Error('Card title is required.');
  return {
    id: input.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description: String(input.description || '').trim(),
    column: 'detected',
    tags,
    datasetId: dataset?.id || '',
    signalCount: dataset?.itemCount || '',
    signalChange: dataset ? 'Apify' : 'Manual',
    priority: 'manual',
  };
}
