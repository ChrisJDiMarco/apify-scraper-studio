// ProseMirror measures text through Range rects and elementFromPoint, which jsdom doesn't have. Suites that mount the
// report editor import this first.
if (typeof window !== 'undefined') {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return this; } });
  const rects = () => Object.assign([], { item: () => null });
  if (typeof Range !== 'undefined') {
    if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
    if (!Range.prototype.getClientRects) Range.prototype.getClientRects = rects;
  }
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
}
