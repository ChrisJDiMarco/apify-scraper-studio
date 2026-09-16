export function datasetItemKey(item, index = 0) {
  const value = item?.id || item?.postId || item?.commentId || item?.externalId;
  return value ? String(value) : `row-${index}`;
}

export function datasetItemSearchText(item, rawMode = false) {
  if (rawMode) {
    try {
      return JSON.stringify(item);
    } catch (_) {
      return String(item);
    }
  }
  return `${item?.type || ''} ${item?.author || ''} ${item?.text || ''} ${item?.url || ''} ${item?.externalId || ''}`;
}
