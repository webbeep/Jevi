/** A 1200×630 PNG card with one line of text. Solid background, so the file stays small. */

const GLYPH: Record<string, string> = {
  ' ': '00000',
  A: '0E11110E',
  B: '1E111E11',
  C: '0E111111',
  D: '1E11111E',
  E: '1F101F10',
  F: '1F101F10',
  G: '0E11171E',
  H: '11111F11',
  I: '1F041F',
  J: '0F01091E',
  K: '12141C12',
  L: '1010101F',
  M: '111B1511',
  N: '11191511',
  O: '0E11110E',
  P: '1E111E10',
  Q: '0E11150A',
  R: '1E111E12',
  S: '0F101E01',
  T: '1F041F',
  U: '1111110E',
  V: '1111110A',
  W: '1115151B',
  X: '11100A11',
  Y: '110A041F',
  Z: '1F02041F',
  '0': '0E15110E',
  '1': '041F04',
  '2': '1D130D1F',
  '3': '1D011D',
  '4': '091F11',
  '5': '1F101E01',
  '6': '0E101E11',
  '7': '1F0204',
  '8': '0E110E11',
  '9': '0E111E01',
  '-': '001C00',
  '.': '00001',
  ',': '00002',
  ':': '00100',
  '?': '1D0404',
};

function bits(ch: string): number[][] {
  const raw = GLYPH[ch] ?? GLYPH[' '];
  const rows: number[][] = [];
  for (const hex of raw) {
    const n = parseInt(hex, 16);
    rows.push([16, 8, 4, 2, 1].map((bit) => (n & bit ? 1 : 0)));
  }
  while (rows.length < 7) rows.push([0, 0, 0, 0, 0]);
  return rows.slice(0, 7);
}

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

/** Draw `title` on a dark card and return a PNG. */
export async function cardPng(title: string): Promise<Uint8Array> {
  const width = 1200;
  const height = 630;
  const scale = 8;
  const line = title.toUpperCase().replace(/[^A-Z0-9 ?.,:-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32) || 'ZO';
  const glyphW = 5 * scale;
  const gap = scale;
  const textW = [...line].reduce((n) => n + glyphW + gap, 0);
  let x0 = Math.max(48, Math.floor((width - textW) / 2));
  const y0 = 250;
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = 0x14;
      raw[i + 1] = 0x14;
      raw[i + 2] = 0x14;
    }
  }
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * (1 + width * 3) + 1 + x * 3;
    raw[i] = 255;
    raw[i + 1] = 255;
    raw[i + 2] = 255;
  };
  for (const ch of line) {
    const rows = bits(ch);
    for (let gy = 0; gy < rows.length; gy++) {
      for (let gx = 0; gx < rows[gy]!.length; gx++) {
        if (!rows[gy]![gx]) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) paint(x0 + gx * scale + dx, y0 + gy * scale + dy);
      }
    }
    x0 += glyphW + gap;
  }
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', new Uint8Array())];
  const size = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}
