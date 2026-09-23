/**
 * Member photo storage.
 *
 * Upload hardening, in order of application:
 *  1. multer memoryStorage with a hard byte limit - nothing oversized ever
 *     reaches disk.
 *  2. MIME allow-list on the declared type (cheap early rejection).
 *  3. sharp re-encodes the buffer. This is the important one: the file written
 *     to disk is a *new* image produced by a decoder, so a polyglot file with
 *     a JPEG header and script payload appended cannot survive the round trip.
 *  4. A random filename with a fixed extension. The client's filename is never
 *     used in a path, so `../../etc/passwd` is not expressible.
 *  5. Files are served by an explicit route (not express.static over an upload
 *     directory) with Content-Type pinned and Content-Disposition attachment
 *     semantics disabled only for known image types.
 *
 * The interface is deliberately thin so swapping local disk for S3 / Cloudinary
 * later means replacing this one file (see docs/ARCHITECTURE.md).
 */
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MEMBER_PHOTO_DIR = path.join(env.uploadDir, 'members');

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(badRequest('Only JPG, JPEG and PNG images are accepted.'));
      return;
    }
    cb(null, true);
  },
});

export interface StoredPhoto {
  fileName: string;
  storagePath: string; // relative to the upload dir, e.g. members/ab12....jpg
  mimeType: 'image/jpeg';
  sizeBytes: number;
}

export async function ensureStorageReady(): Promise<void> {
  await fs.mkdir(MEMBER_PHOTO_DIR, { recursive: true });
}

/**
 * Validate, normalise and persist a member photo.
 * Output is always a square-ish 512px JPEG at quality 82 - roughly 40-60 KB,
 * which keeps member list pages fast even on a slow connection.
 */
export async function storeMemberPhoto(buffer: Buffer, declaredMime: string): Promise<StoredPhoto> {
  if (!ALLOWED_MIME.has(declaredMime)) {
    throw badRequest('Only JPG, JPEG and PNG images are accepted.');
  }

  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(buffer, { failOn: 'error' });
    const meta = await pipeline.metadata();
    // sharp refuses to identify a file that is not really an image.
    if (!meta.format || !['jpeg', 'png'].includes(meta.format)) {
      throw badRequest('That file does not appear to be a valid JPG or PNG image.');
    }
    if ((meta.width ?? 0) < 64 || (meta.height ?? 0) < 64) {
      throw badRequest('That image is too small. Please use a photo at least 64x64 pixels.');
    }
  } catch (err) {
    if ((err as any)?.status) throw err;
    throw badRequest('That file could not be read as an image. Please try another photo.');
  }

  const fileName = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  const absolute = path.join(MEMBER_PHOTO_DIR, fileName);

  await ensureStorageReady();
  const output = await sharp(buffer)
    .rotate() // honour EXIF orientation, then discard metadata
    .resize(512, 512, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  await fs.writeFile(absolute, output, { mode: 0o640 });

  return {
    fileName,
    storagePath: path.posix.join('members', fileName),
    mimeType: 'image/jpeg',
    sizeBytes: output.byteLength,
  };
}

/** Resolve a stored relative path to an absolute one, refusing traversal. */
export function resolveStoredPath(storagePath: string): string {
  const absolute = path.resolve(env.uploadDir, storagePath);
  if (!absolute.startsWith(path.resolve(env.uploadDir) + path.sep)) {
    throw badRequest('Invalid file reference.');
  }
  return absolute;
}

export async function deleteStoredPhoto(storagePath: string): Promise<void> {
  try {
    await fs.unlink(resolveStoredPath(storagePath));
  } catch {
    // A missing file is not an error worth failing the request over.
  }
}
