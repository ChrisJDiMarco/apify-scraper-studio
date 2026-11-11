// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetThumbs, rememberThumb, thumbSnapshot, thumbnailOf } from '../src/renderer/src/thumb-cache.js';

afterEach(() => { forgetThumbs(); vi.unstubAllGlobals(); });
const png = `data:image/png;base64,${'A'.repeat(600000)}`;

describe('the thumbnail cache', () => {
  it('keeps thumbnails for the session, newest last, and drops the oldest past its limit', () => {
    rememberThumb('a', 'data:image/webp;base64,1'); rememberThumb('b', 'data:image/webp;base64,2'); rememberThumb('a', 'data:image/webp;base64,3');
    expect(Object.keys(thumbSnapshot())).toEqual(['b', 'a']);
    expect(thumbSnapshot().a).toBe('data:image/webp;base64,3');
    for (let index = 0; index < 700; index += 1) rememberThumb(`k${index}`, 'data:image/webp;base64,x');
    const keys = Object.keys(thumbSnapshot());
    expect(keys).toHaveLength(600);
    expect(keys).not.toContain('a'); expect(keys.at(-1)).toBe('k699');
    rememberThumb('', 'x'); rememberThumb('z', null);
    expect(Object.keys(thumbSnapshot())).toHaveLength(600);
  });
  it('shrinks a large picture to a small copy', async () => {
    const drawImage = vi.fn(); const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 1024, close })));
    const canvas = { getContext: () => ({ drawImage }), toDataURL: vi.fn(() => 'data:image/webp;base64,small'), width: 0, height: 0 };
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag)));
    expect(await thumbnailOf(png)).toBe('data:image/webp;base64,small');
    expect([canvas.width, canvas.height]).toEqual([520, 260]);
    expect(drawImage).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('returns the picture itself where it can’t be shrunk, and anything that isn’t a picture untouched', async () => {
    expect(await thumbnailOf(png)).toBe(png); // no createImageBitmap here
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('unsupported'); }));
    expect(await thumbnailOf(png)).toBe(png);
    expect(await thumbnailOf('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(await thumbnailOf(null)).toBeNull();
  });
});
