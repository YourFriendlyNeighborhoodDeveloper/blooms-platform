import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

const MAGIC: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

/** Identifies a file by its contents. The client's filename and declared type are never trusted. */
export function sniffType(buf: Buffer): string | null {
  for (const m of MAGIC) {
    const offset = m.offset ?? 0;
    if (buf.length >= offset + m.bytes.length && m.bytes.every((b, i) => buf[offset + i] === b)) return m.mime;
  }
  return null;
}

export const safeFilename = (name: string) =>
  (name.split(/[\\/]/).pop() ?? 'file')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120) || 'file';

export type ProcessedUpload = { body: Buffer; mime: string; size: number; sha256: string; extension: string; width?: number; height?: number };

/**
 * Re-encodes images, which strips EXIF (including GPS location) and destroys anything hidden inside
 * a crafted file. Only genuine JPEG, PNG and WebP images come out the other side.
 */
export async function processImage(input: Buffer, opts: { maxWidth?: number; maxBytes?: number } = {}): Promise<ProcessedUpload> {
  if (input.length === 0) throw badRequest('That file is empty.');
  if (input.length > (opts.maxBytes ?? MAX_IMAGE_BYTES)) throw badRequest('Images must be 10 MB or smaller.');
  const type = sniffType(input);
  if (!type || !type.startsWith('image/')) throw badRequest('Please upload a JPEG, PNG or WebP image.');
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(input, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: opts.maxWidth ?? 2400, height: opts.maxWidth ?? 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw badRequest('That image could not be read. Please try a different file.');
  }
  return {
    body: output.data,
    mime: 'image/webp',
    size: output.data.length,
    sha256: createHash('sha256').update(output.data).digest('hex'),
    extension: 'webp',
    width: output.info.width,
    height: output.info.height,
  };
}

export function processDocument(input: Buffer): ProcessedUpload {
  if (input.length === 0) throw badRequest('That file is empty.');
  if (input.length > MAX_DOCUMENT_BYTES) throw badRequest('Documents must be 15 MB or smaller.');
  if (sniffType(input) !== 'application/pdf') throw badRequest('Please upload a PDF.');
  return { body: input, mime: 'application/pdf', size: input.length, sha256: createHash('sha256').update(input).digest('hex'), extension: 'pdf' };
}

export const privateKey = (kind: string, extension: string) => `private/${kind}/${randomUUID()}.${extension}`;
export const catalogKey = (extension: string) => `catalog/${randomUUID()}.${extension}`;
