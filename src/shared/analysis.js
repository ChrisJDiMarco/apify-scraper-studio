export function sortAnalysesLatestFirst(analyses = []) {
  return [...analyses].sort((a, b) => String(b?.finishedAt || b?.startedAt || '').localeCompare(String(a?.finishedAt || a?.startedAt || '')));
}

export function analysesForDataset(analyses = [], datasetId = '', kind = '') {
  return sortAnalysesLatestFirst(analyses)
    .filter((analysis) => (!datasetId || analysis?.datasetId === datasetId) && (!kind || analysis?.kind === kind));
}

export function latestAnalysisForDataset(analyses = [], datasetId = '', kind = '') {
  return analysesForDataset(analyses, datasetId, kind)[0] || null;
}

export function codexEventLabel(event = {}) {
  const type = String(event?.type || event?.event || 'event');
  const detail = [event.message, event.text, event.delta, event.error, event.item?.text].find((value) => value);
  return detail ? `${type}: ${String(detail)}` : type;
}

export function codexEventLabels(events = [], limit = 8) {
  return events.slice(-limit).map(codexEventLabel);
}
