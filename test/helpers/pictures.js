// Small real picture files for brand reference image tests: a valid grayscale PNG of any size (shade makes
// otherwise identical pictures differ byte for byte), and the smallest JPEG header the size check reads.
import { deflateSync } from 'node:zlib';
function crc32(buffer) { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, checksum]); }
export function picture(width = 48, height = 32, shade = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height, shade); for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
// An APP0 segment, then a baseline frame header (SOF0) with the size.
export const jpeg = (width, height) => Buffer.concat([Buffer.from('ffd8ffe000104a46494600010101004800480000', 'hex'), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03]), Buffer.alloc(12), Buffer.from('ffd9', 'hex')]);
