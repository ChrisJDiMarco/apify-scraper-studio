'use strict';
// Brand reference images for the pictures a channel asset kit draws. Golden Thread v2 (n8n) sent the image model
// approved style examples and the exact logo with every picture; Settings → Brand reference images keeps them per
// workspace, one set per kind of picture, and each kit run sends the set it started with. Pure; no I/O.
const BRAND_IMAGE_ROLES = Object.freeze(['style', 'logo']);
// n8n's Search Engine Land hero sent the most: five style examples and the logo.
const MAX_BRAND_IMAGES = 6;
const MAX_BRAND_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_BRAND_IMAGE_SIDE = 16;
const MAX_BRAND_IMAGE_SIDE = 8192;
const BRAND_IMAGE_FAMILIES = Object.freeze([
  { id: 'campaign', deliverableId: 'brand-image', editions: ['general', 'semrush'], labels: { semrush: 'Semrush campaign graphics', general: 'Campaign graphics' }, hints: { semrush: 'Social Team — Hero Graphic. Campaign style examples and the approved Semrush lockup.', general: 'The brand campaign graphic. Style examples and your approved logo.' } },
  { id: 'sel-editorial', deliverableId: 'sel-image', editions: ['semrush'], labels: { semrush: 'Search Engine Land editorial heroes' }, hints: { semrush: 'Search Engine Land — Editorial Hero. n8n sent five SEL style examples and the 2026 SEL logo.' } },
  { id: 'sel-social', deliverableId: 'sel-social-image', editions: ['semrush'], labels: { semrush: 'Search Engine Land social graphics' }, hints: { semrush: 'Search Engine Land — Social Hero. n8n sent the SEL style example, the brand sheet and the SEL lockup.' } },
].map((family) => Object.freeze(family)));

function brandImageFamilies(editionId = 'general') {
  return BRAND_IMAGE_FAMILIES.filter((family) => family.editions.includes(editionId)).map((family) => ({ id: family.id, deliverableId: family.deliverableId, label: family.labels[editionId], hint: family.hints[editionId], max: MAX_BRAND_IMAGES }));
}
function brandImageFamily(familyId, editionId = 'general') {
  const family = brandImageFamilies(editionId).find((entry) => entry.id === familyId);
  if (!family) throw new Error('Choose a picture set from this workspace.');
  return family;
}
const familyForDeliverable = (deliverableId) => BRAND_IMAGE_FAMILIES.find((family) => family.deliverableId === deliverableId) || null;
// The order the image model receives them: style examples as added, then the approved logo (n8n's SEL hero sent
// references 1–5 as style examples and reference 6 as the exact logo).
function orderedReferences(images = []) {
  return [...images].sort((a, b) => (a.role === 'logo') - (b.role === 'logo') || String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
}
function referenceSummary(images = []) {
  return { style: images.filter((image) => image.role === 'style').length, logo: images.filter((image) => image.role === 'logo').length };
}

// What a picture file really is, read from its bytes, not its name: PNG, JPEG or WebP, with its size in pixels.
// Anything else, including animated WebP, returns null.
function sniffImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
  const at = (index) => bytes[index] ?? 0;
  const u16be = (index) => (at(index) << 8) | at(index + 1);
  const u32be = (index) => u16be(index) * 65536 + u16be(index + 2);
  const u16le = (index) => at(index) | (at(index + 1) << 8);
  const u24le = (index) => at(index) | (at(index + 1) << 8) | (at(index + 2) << 16);
  const ascii = (index, length) => String.fromCharCode(...bytes.subarray(index, index + length));
  let found = null;
  if (bytes.length >= 24 && u32be(0) === 0x89504e47 && u32be(4) === 0x0d0a1a0a && ascii(12, 4) === 'IHDR') found = { mime: 'image/png', extension: 'png', width: u32be(16), height: u32be(20) };
  else if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    // The size is in the first frame header (SOF0–SOF15, except the DHT, JPG and DAC markers that share the range).
    for (let index = 2; index + 9 < bytes.length;) {
      if (at(index) !== 0xff) break;
      const marker = at(index + 1);
      if (marker === 0xff) { index += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { index += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = u16be(index + 2); if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { found = { mime: 'image/jpeg', extension: 'jpg', width: u16be(index + 7), height: u16be(index + 5) }; break; }
      index += 2 + length;
    }
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4); let size = null;
    if (chunk === 'VP8 ' && at(23) === 0x9d && at(24) === 0x01 && at(25) === 0x2a) size = { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    else if (chunk === 'VP8L' && at(20) === 0x2f) size = { width: 1 + (((at(22) & 0x3f) << 8) | at(21)), height: 1 + (((at(24) & 0x0f) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)) };
    else if (chunk === 'VP8X' && !(at(20) & 0x02)) size = { width: 1 + u24le(24), height: 1 + u24le(27) }; // 0x02 marks an animation
    if (size) found = { mime: 'image/webp', extension: 'webp', ...size };
  }
  return found && found.width >= 1 && found.height >= 1 ? found : null;
}
// A picture fit to send: a real PNG, JPEG or WebP under 10 MB, 16–8,192 pixels a side.
function checkBrandImage(bytes) {
  const info = sniffImage(bytes);
  if (!info) throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (bytes.length > MAX_BRAND_IMAGE_BYTES) throw new Error('Choose a picture under 10 MB.');
  if (Math.min(info.width, info.height) < MIN_BRAND_IMAGE_SIDE || Math.max(info.width, info.height) > MAX_BRAND_IMAGE_SIDE) throw new Error(`Choose a picture between ${MIN_BRAND_IMAGE_SIDE} and ${MAX_BRAND_IMAGE_SIDE.toLocaleString('en-US')} pixels on each side.`);
  return info;
}

module.exports = { BRAND_IMAGE_ROLES, BRAND_IMAGE_FAMILIES, MAX_BRAND_IMAGES, MAX_BRAND_IMAGE_BYTES, brandImageFamilies, brandImageFamily, familyForDeliverable, orderedReferences, referenceSummary, sniffImage, checkBrandImage };
