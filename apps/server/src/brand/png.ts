// @effect-diagnostics nodeBuiltinImport:off -- zlib inflates and deflates PNG image data; Effect has no codec for it.
/**
 * Just enough PNG to downscale a rendered icon: the headless browser cannot capture below
 * 240 CSS pixels, so small icon sizes are resampled from a larger render.
 */
import * as NodeZlib from "node:zlib";

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  readonly data: Uint8Array;
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export const isPng = (bytes: Uint8Array) =>
  bytes.length >= SIGNATURE.length && SIGNATURE.every((byte, index) => bytes[index] === byte);

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodes 8-bit RGB or RGBA, non-interlaced PNGs, the kind the headless browser writes. */
export const decodePng = (bytes: Uint8Array): RgbaImage | undefined => {
  if (!isPng(bytes)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Array<Uint8Array> = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        return undefined;
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0 || channels === 0) return undefined;
  let raw: Uint8Array;
  try {
    raw = NodeZlib.inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return undefined;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
      const value = line[x]!;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : -1;
      if (predicted < 0) return undefined;
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = pixels[index * 3]!;
    data[index * 4 + 1] = pixels[index * 3 + 1]!;
    data[index * 4 + 2] = pixels[index * 3 + 2]!;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
};

const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
};

/** Encodes RGBA as an 8-bit PNG with no row filters; the output is deterministic. */
export const encodePng = (image: RgbaImage): Uint8Array => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = image.width * 4;
  const raw = new Uint8Array(image.height * (stride + 1));
  for (let y = 0; y < image.height; y += 1) {
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", NodeZlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  return Uint8Array.from(Buffer.concat(parts));
};

/** Area-averaged downscale with premultiplied alpha, so edges do not pick up dark fringes. */
export const downscale = (image: RgbaImage, width: number): RgbaImage => {
  const targetWidth = Math.max(1, Math.min(image.width, Math.round(width)));
  const targetHeight = Math.max(1, Math.round((image.height * targetWidth) / image.width));
  const data = new Uint8Array(targetWidth * targetHeight * 4);
  const scaleX = image.width / targetWidth;
  const scaleY = image.height / targetHeight;
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = ty * scaleY;
    const y1 = y0 + scaleY;
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = tx * scaleX;
      const x1 = x0 + scaleX;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(image.height, Math.ceil(y1)); sy += 1) {
        const coverY = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(image.width, Math.ceil(x1)); sx += 1) {
          const weight = coverY * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const index = (sy * image.width + sx) * 4;
          const alpha = image.data[index + 3]! / 255;
          r += image.data[index]! * alpha * weight;
          g += image.data[index + 1]! * alpha * weight;
          b += image.data[index + 2]! * alpha * weight;
          a += alpha * weight;
          area += weight;
        }
      }
      const out = (ty * targetWidth + tx) * 4;
      data[out] = a === 0 ? 0 : Math.round(r / a);
      data[out + 1] = a === 0 ? 0 : Math.round(g / a);
      data[out + 2] = a === 0 ? 0 : Math.round(b / a);
      data[out + 3] = area === 0 ? 0 : Math.round((a / area) * 255);
    }
  }
  return { width: targetWidth, height: targetHeight, data };
};
