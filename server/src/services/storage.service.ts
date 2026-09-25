/**
 * Member photo storage.
 *
 * Two backends behind one small interface:
 *
 *   - Supabase Storage, when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 *     set. A private bucket, created on first boot. Files survive restarts and
 *     redeploys of the API and live next to the database that indexes them.
 *   - Local disk under UPLOAD_DIR otherwise, which keeps development and
 *     self-hosted deployments working with no configuration.
 *
 * In both cases the bytes are served through the API's own authenticated
 * route, never from a public URL, so the session check and the Content-Type
 * pinning in members.routes.ts apply regardless of where the file lives.
 *
 * Upload hardening, in order of application:
 *  1. multer memoryStorage with a hard byte limit - nothing oversized ever
 *     reaches storage.
 *  2. MIME allow-list on the declared type (cheap early rejection).
 *  3. sharp re-encodes the buffer. This is the important one: the file that is
 *     stored is a *new* image produced by a decoder, so a polyglot file with
 *     a JPEG header and script payload appended cannot survive the round trip.
 *  4. A random filename with a fixed extension. The client's filename is never
 *     used in a path, so `../../etc/passwd` is not expressible.
 */
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MEMBER_PHOTO_DIR = path.join(env.uploadDir, 'members');

export type PhotoStorageMode = 'supabase' | 'local';
export const photoStorageMode: PhotoStorageMode = env.supabaseStorageEnabled ? 'supabase' : 'local';

/** Only paths this module itself generated are ever read back. */
const STORAGE_PATH = /^members\/[a-f0-9]{32}\.jpg$/;

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
  storagePath: string; // relative, e.g. members/ab12....jpg - same shape on both backends
  mimeType: 'image/jpeg';
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

let supabase: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

const bucket = () => client().storage.from(env.SUPABASE_STORAGE_BUCKET);

/**
 * Create the bucket if the project does not have it yet. Private: nothing in
 * it is reachable without the service key, which only this server holds.
 */
async function ensureBucket(): Promise<void> {
  const { data, error } = await client().storage.listBuckets();
  if (error) throw new Error(`Supabase Storage is not reachable: ${error.message}`);
  if (data.some((b) => b.name === env.SUPABASE_STORAGE_BUCKET)) return;

  const created = await client().storage.createBucket(env.SUPABASE_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: env.MAX_UPLOAD_BYTES,
    allowedMimeTypes: ['image/jpeg'],
  });
  if (created.error) throw new Error(`Could not create the photo bucket: ${created.error.message}`);
  console.log(`[storage] created private bucket "${env.SUPABASE_STORAGE_BUCKET}"`);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export async function ensureStorageReady(): Promise<void> {
  if (photoStorageMode === 'supabase') {
    await ensureBucket();
    return;
  }
  await fs.mkdir(MEMBER_PHOTO_DIR, { recursive: true });
}

/** Where photographs are going, for the boot banner and the health check. */
export function describeStorage(): string {
  return photoStorageMode === 'supabase'
    ? `Supabase Storage, bucket "${env.SUPABASE_STORAGE_BUCKET}"`
    : `local disk, ${MEMBER_PHOTO_DIR}`;
}

/**
 * Validate, normalise and persist a member photo.
 * Output is always a square 512px JPEG at quality 82 - roughly 40-60 KB,
 * which keeps member list pages fast even on a slow connection.
 */
export async function storeMemberPhoto(buffer: Buffer, declaredMime: string): Promise<StoredPhoto> {
  if (!ALLOWED_MIME.has(declaredMime)) {
    throw badRequest('Only JPG, JPEG and PNG images are accepted.');
  }

  try {
    const meta = await sharp(buffer, { failOn: 'error' }).metadata();
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
  const storagePath = path.posix.join('members', fileName);

  const output = await sharp(buffer)
    .rotate() // honour EXIF orientation, then discard metadata
    .resize(512, 512, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (photoStorageMode === 'supabase') {
    const { error } = await bucket().upload(storagePath, output, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error(`Photo upload to Supabase Storage failed: ${error.message}`);
  } else {
    await ensureStorageReady();
    await fs.writeFile(path.join(MEMBER_PHOTO_DIR, fileName), output, { mode: 0o640 });
  }

  return { fileName, storagePath, mimeType: 'image/jpeg', sizeBytes: output.byteLength };
}

/**
 * The bytes of a stored photo, or null when the file is gone (for instance a
 * row written while photos still lived on a disk that has since been wiped).
 * Callers turn null into a 404 and the client falls back to initials.
 */
export async function readStoredPhoto(storagePath: string): Promise<Buffer | null> {
  if (!STORAGE_PATH.test(storagePath)) return null;

  if (photoStorageMode === 'supabase') {
    const { data, error } = await bucket().download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  try {
    return await fs.readFile(resolveStoredPath(storagePath));
  } catch {
    return null;
  }
}

/** Resolve a stored relative path to an absolute one on disk, refusing traversal. */
export function resolveStoredPath(storagePath: string): string {
  const absolute = path.resolve(env.uploadDir, storagePath);
  if (!absolute.startsWith(path.resolve(env.uploadDir) + path.sep)) {
    throw badRequest('Invalid file reference.');
  }
  return absolute;
}

export async function deleteStoredPhoto(storagePath: string): Promise<void> {
  if (!STORAGE_PATH.test(storagePath)) return;

  if (photoStorageMode === 'supabase') {
    // A missing object is not an error worth failing the request over.
    await bucket().remove([storagePath]).catch(() => undefined);
    return;
  }
  try {
    await fs.unlink(resolveStoredPath(storagePath));
  } catch {
    // Same reasoning for the disk.
  }
}
