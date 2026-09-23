/**
 * Central error handling.
 *
 * Two rules drive this file:
 *  1. The client only ever receives a message a church administrator could act
 *     on. Database text, stack traces and constraint names stay server-side.
 *  2. Unexpected errors are logged in full so they can actually be fixed.
 */
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError, translatePgError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No API route matches ${req.method} ${req.originalUrl}.` },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // --- Validation ---------------------------------------------------------
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || 'form';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Please check the highlighted fields and try again.',
        fields: fieldErrors,
      },
    });
    return;
  }

  // --- Request body could not be read (body-parser / http-errors) ----------
  // A malformed JSON body or an oversized payload is the client's mistake, not
  // a server fault: answer 400 / 413 without logging a stack trace.
  const bodyError = err as { type?: string; status?: number } | null;
  if (bodyError && typeof bodyError.type === 'string' && bodyError.type.startsWith('entity.')) {
    const tooLarge = bodyError.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'payload_too_large' : 'bad_request',
        message: tooLarge
          ? 'The request is too large. Please send less data at once.'
          : 'The request could not be read. Please refresh the page and try again.',
      },
    });
    return;
  }

  // --- File uploads -------------------------------------------------------
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'upload_failed',
          message: `That image is too large. Please upload a file under ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        },
      });
      return;
    }
    // Wrong field name, too many files, etc. - a malformed upload, not an oversized one.
    res.status(400).json({
      error: { code: 'upload_failed', message: 'The file could not be uploaded. Please try again with a JPG or PNG image.' },
    });
    return;
  }

  // --- Deliberate application errors --------------------------------------
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  // --- Known PostgreSQL constraint violations ------------------------------
  const translated = translatePgError(err);
  if (translated) {
    res.status(translated.status).json({ error: { code: translated.code, message: translated.message } });
    return;
  }

  // --- Anything else is a bug -------------------------------------------
  const id = Math.random().toString(36).slice(2, 10);
  console.error(`[error ${id}] ${req.method} ${req.originalUrl}`, err);

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. Please try again, and quote reference ' + id + ' if it persists.',
      reference: id,
      ...(env.isProd ? {} : { debug: (err as Error)?.message }),
    },
  });
}
