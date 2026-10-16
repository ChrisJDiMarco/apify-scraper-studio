import { describe, expect, it } from 'vitest';
import brandImages from '../src/shared/brand-images.js';
import { jpeg, picture } from './helpers/pictures.js';
const { brandImageFamilies, brandImageFamily, familyForDeliverable, orderedReferences, referenceSummary, sniffImage, checkBrandImage, MAX_BRAND_IMAGE_BYTES } = brandImages;

const riff = (kind, body) => { const size = Buffer.alloc(4); size.writeUInt32LE(body.length + 12); return Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), Buffer.from(kind), Buffer.alloc(4), body, Buffer.alloc(8)]); };

describe('brand reference images', () => {
  it('offers one picture set per kit picture, with the Search Engine Land sets only in the Semrush workspace', () => {
    expect(brandImageFamilies('semrush').map(family => [family.id, family.deliverableId, family.label, family.max])).toEqual([
      ['campaign', 'brand-image', 'Semrush campaign graphics', 6],
      ['sel-editorial', 'sel-image', 'Search Engine Land editorial heroes', 6],
      ['sel-social', 'sel-social-image', 'Search Engine Land social graphics', 6],
    ]);
    expect(brandImageFamilies('general').map(family => [family.id, family.label])).toEqual([['campaign', 'Campaign graphics']]);
    expect(() => brandImageFamily('sel-editorial', 'general')).toThrow('Choose a picture set from this workspace.');
    expect(familyForDeliverable('sel-image').id).toBe('sel-editorial'); expect(familyForDeliverable('blogshort')).toBeNull();
  });
  it('reads what a picture really is from its bytes, not its name', () => {
    expect(sniffImage(picture(1536, 1024))).toEqual({ mime: 'image/png', extension: 'png', width: 1536, height: 1024 });
    expect(sniffImage(jpeg(1200, 630))).toEqual({ mime: 'image/jpeg', extension: 'jpg', width: 1200, height: 630 });
    expect(sniffImage(riff('VP8 ', Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00])))).toEqual({ mime: 'image/webp', extension: 'webp', width: 320, height: 240 });
    expect(sniffImage(riff('VP8L', Buffer.from([0x2f, 0x3f, 0xc0, 0x3b, 0x00])))).toMatchObject({ mime: 'image/webp', width: 64, height: 240 });
    expect(sniffImage(riff('VP8X', Buffer.from([0x10, 0, 0, 0, 0x7f, 0x02, 0x00, 0xef, 0x01, 0x00])))).toMatchObject({ mime: 'image/webp', width: 640, height: 496 });
    expect(sniffImage(riff('VP8X', Buffer.from([0x12, 0, 0, 0, 0x7f, 0x02, 0x00, 0xef, 0x01, 0x00])))).toBeNull(); // animated
    for (const bytes of [Buffer.from('GIF89a0123456789abcdef'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(64), Buffer.from('89504e47', 'hex'), 'not bytes']) expect(sniffImage(bytes)).toBeNull();
  });
  it('accepts PNG, JPEG and WebP under 10 MB between 16 and 8,192 pixels a side', () => {
    expect(checkBrandImage(picture(48, 32))).toMatchObject({ mime: 'image/png', width: 48, height: 32 });
    expect(() => checkBrandImage(Buffer.from('GIF89a0123456789abcdef'))).toThrow('Choose a PNG, JPEG or WebP picture.');
    expect(() => checkBrandImage(picture(8, 8))).toThrow('between 16 and 8,192 pixels');
    expect(() => checkBrandImage(jpeg(9000, 400))).toThrow('between 16 and 8,192 pixels');
    expect(() => checkBrandImage(Buffer.concat([jpeg(400, 400), Buffer.alloc(MAX_BRAND_IMAGE_BYTES)]))).toThrow('Choose a picture under 10 MB.');
  });
  it('sends style examples in the order they were added, then the approved logo', () => {
    const images = [{ id: 'logo', role: 'logo', addedAt: '2026-10-16T10:00:00Z' }, { id: 'second', role: 'style', addedAt: '2026-10-16T10:02:00Z' }, { id: 'first', role: 'style', addedAt: '2026-10-16T10:01:00Z' }];
    expect(orderedReferences(images).map(image => image.id)).toEqual(['first', 'second', 'logo']);
    expect(referenceSummary(images)).toEqual({ style: 2, logo: 1 }); expect(referenceSummary([])).toEqual({ style: 0, logo: 0 });
  });
});
