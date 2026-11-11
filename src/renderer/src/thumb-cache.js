// Thumbnails for Assets. The studio returns a picture as the whole PNG in a data URL (1.5 to 3 MB of text each); the
// grid shows it at a few hundred pixels. Each picture is shrunk once to a small WebP data URL (a few tens of KB) and
// kept here, outside any component, for the session: opening a Workbench page and coming back no longer reads every
// picture again, and a hundred pictures hold a few MB instead of a few hundred. The lightbox reads the full picture
// itself when one is opened (simple-assets.jsx).
const MAX_ENTRIES = 600;
const MAX_SIDE = 520;
const store = new Map(); // key → data URL, oldest first

export const thumbSnapshot = () => Object.fromEntries(store);
export function rememberThumb(key, url) {
  if (!key || typeof url !== 'string') return;
  store.delete(key); store.set(key, url);
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}
export const forgetThumbs = () => store.clear();

function blobOf(dataUrl) {
  const comma = dataUrl.indexOf(','); const head = dataUrl.slice(5, comma);
  const bytes = atob(dataUrl.slice(comma + 1)); const out = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) out[index] = bytes.charCodeAt(index);
  return new Blob([out], { type: head.split(';')[0] || 'image/png' });
}

// A small copy of a picture's data URL, or the picture itself where the browser can't make one (or it is already small).
export async function thumbnailOf(dataUrl, maxSide = MAX_SIDE) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || !dataUrl.includes(';base64,')) return dataUrl;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return dataUrl;
  try {
    const bitmap = await createImageBitmap(blobOf(dataUrl));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && dataUrl.length < 400000) { bitmap.close?.(); return dataUrl; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) { bitmap.close?.(); return dataUrl; }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
    const small = canvas.toDataURL('image/webp', 0.82);
    return small.startsWith('data:image/') && small.length < dataUrl.length ? small : dataUrl;
  } catch { return dataUrl; }
}
