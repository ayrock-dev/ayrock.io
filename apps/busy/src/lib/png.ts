/*
 * Minimal PNG encoder for tiny (icon-sized) RGBA bitmaps. Uses stored
 * (uncompressed) zlib blocks so we carry no compression dependency; icons are
 * a few hundred bytes, so size is irrelevant. Runs in the Workers runtime with
 * only Uint8Array.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crc_table: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (crc_table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function chunk(type: string, data: number[]): number[] {
  const type_bytes = [...type].map((ch) => ch.charCodeAt(0));
  const body = [...type_bytes, ...data];
  return [...u32(data.length), ...body, ...u32(crc32(new Uint8Array(body)))];
}

function zlib_stored(raw: Uint8Array): number[] {
  const out: number[] = [0x78, 0x01];
  const len = raw.length;
  out.push(0x01); // final stored block
  out.push(len & 0xff, (len >>> 8) & 0xff);
  const nlen = ~len & 0xffff;
  out.push(nlen & 0xff, (nlen >>> 8) & 0xff);
  out.push(...raw);
  out.push(...u32(adler32(raw)));
  return out;
}

/*
 * `rgba` must hold width * height * 4 bytes in row-major order.
 */
export function encode_png(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(
      rgba.subarray(y * stride, y * stride + stride),
      y * (stride + 1) + 1,
    );
  }
  const ihdr = [
    ...u32(width),
    ...u32(height),
    8, // bit depth
    6, // color type: RGBA
    0, // compression
    0, // filter
    0, // interlace
  ];
  const bytes = [
    ...PNG_SIGNATURE,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlib_stored(raw)),
    ...chunk('IEND', []),
  ];
  return new Uint8Array(bytes);
}
