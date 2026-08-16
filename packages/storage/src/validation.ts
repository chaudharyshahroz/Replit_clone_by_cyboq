/**
 * Upload validation (spec §59, §84).
 *
 * The governing rule: **never trust the client's Content-Type**. A browser can
 * claim any MIME type for any bytes, so an "image/png" that is actually an HTML
 * document becomes stored XSS the moment it is served back. Every upload is
 * sniffed from its own magic bytes, and the sniffed type is what gets stored.
 */
import { StorageError } from './types';

export type AllowedCategory = 'document' | 'spreadsheet' | 'image' | 'text' | 'code' | 'archive';

export interface DetectedType {
  readonly mimeType: string;
  readonly extension: string;
  readonly category: AllowedCategory;
}

/**
 * Magic-byte signatures. Offset-aware because several formats do not start at
 * byte 0 (notably RIFF-based WEBP).
 */
interface Signature {
  readonly bytes: readonly number[];
  readonly offset: number;
  readonly type: DetectedType;
  /** Extra confirmation bytes elsewhere in the header. */
  readonly also?: { readonly bytes: readonly number[]; readonly offset: number };
}

const SIGNATURES: readonly Signature[] = [
  {
    bytes: [0x25, 0x50, 0x44, 0x46], // %PDF
    offset: 0,
    type: { mimeType: 'application/pdf', extension: 'pdf', category: 'document' },
  },
  {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    offset: 0,
    type: { mimeType: 'image/png', extension: 'png', category: 'image' },
  },
  {
    bytes: [0xff, 0xd8, 0xff],
    offset: 0,
    type: { mimeType: 'image/jpeg', extension: 'jpg', category: 'image' },
  },
  {
    bytes: [0x47, 0x49, 0x46, 0x38], // GIF8
    offset: 0,
    type: { mimeType: 'image/gif', extension: 'gif', category: 'image' },
  },
  {
    bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
    offset: 0,
    also: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // WEBP
    type: { mimeType: 'image/webp', extension: 'webp', category: 'image' },
  },
];

/** ZIP container magic — used by docx/xlsx/pptx as well as plain archives. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const OOXML_BY_MARKER: readonly { marker: string; type: DetectedType }[] = [
  {
    marker: 'word/',
    type: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      category: 'document',
    },
  },
  {
    marker: 'xl/',
    type: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      category: 'spreadsheet',
    },
  },
  {
    marker: 'ppt/',
    type: {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
      category: 'document',
    },
  },
];

function matches(buffer: Buffer, bytes: readonly number[], offset: number): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/** True when the buffer is valid UTF-8 with no NUL or unexpected control bytes. */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_192);
  if (sample.includes(0x00)) return false;

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  if (decoded.includes('�')) return false;

  let controls = 0;
  for (const char of decoded) {
    const code = char.codePointAt(0)!;
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (code < 0x20 && !isAllowedWhitespace) controls++;
  }
  return controls / Math.max(1, decoded.length) < 0.01;
}

/**
 * Content that a browser would execute or render as markup if it were ever
 * served inline. Detected so it can be forced to download rather than render.
 */
const MARKUP_PATTERN = /^\s*(<!doctype html|<html|<\?xml|<svg|<script)/i;

export interface SniffResult {
  readonly detected: DetectedType;
  /** True when the client's claim disagreed with the bytes. */
  readonly mismatch: boolean;
  /** True when the content could render as markup and must never be inline. */
  readonly renderRisk: boolean;
}

export function sniffContentType(buffer: Buffer, declaredType?: string): SniffResult {
  let detected: DetectedType | undefined;

  for (const signature of SIGNATURES) {
    if (!matches(buffer, signature.bytes, signature.offset)) continue;
    if (signature.also && !matches(buffer, signature.also.bytes, signature.also.offset)) continue;
    detected = signature.type;
    break;
  }

  if (!detected && matches(buffer, ZIP_MAGIC, 0)) {
    // OOXML files are ZIPs; the entry names identify which kind.
    const header = buffer.subarray(0, 4_096).toString('latin1');
    detected =
      OOXML_BY_MARKER.find((candidate) => header.includes(candidate.marker))?.type ?? {
        mimeType: 'application/zip',
        extension: 'zip',
        category: 'archive',
      };
  }

  let renderRisk = false;

  if (!detected) {
    if (looksLikeText(buffer)) {
      const head = buffer.subarray(0, 1_024).toString('utf8');
      renderRisk = MARKUP_PATTERN.test(head);
      detected = renderRisk
        ? // Never store markup under a type a browser will render.
          { mimeType: 'text/plain', extension: 'txt', category: 'text' }
        : { mimeType: 'text/plain', extension: 'txt', category: 'text' };
    } else {
      throw new StorageError(
        'DRIVER_ERROR',
        'This file type is not supported. Reklu accepts PDF, Word, Excel, PowerPoint, images, text, and code files.',
      );
    }
  }

  const mismatch = Boolean(
    declaredType && declaredType.split(';')[0]!.trim().toLowerCase() !== detected.mimeType,
  );

  return { detected, mismatch, renderRisk };
}

export interface ValidateUploadOptions {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly declaredType?: string | undefined;
  readonly maxBytes: number;
}

export interface ValidatedUpload {
  readonly contentType: string;
  readonly extension: string;
  readonly category: AllowedCategory;
  readonly sizeBytes: number;
  readonly mismatch: boolean;
  /** Set when the file must be forced to download rather than rendered inline. */
  readonly forceDownload: boolean;
}

export function validateUpload(options: ValidateUploadOptions): ValidatedUpload {
  const { buffer, maxBytes } = options;

  if (buffer.byteLength === 0) {
    throw new StorageError('DRIVER_ERROR', 'That file is empty.');
  }
  if (buffer.byteLength > maxBytes) {
    throw new StorageError(
      'TOO_LARGE',
      `That file is ${(buffer.byteLength / 1_048_576).toFixed(1)}MB, over the ${(
        maxBytes / 1_048_576
      ).toFixed(0)}MB limit.`,
    );
  }

  const { detected, mismatch, renderRisk } = sniffContentType(buffer, options.declaredType);

  return {
    contentType: detected.mimeType,
    extension: detected.extension,
    category: detected.category,
    sizeBytes: buffer.byteLength,
    mismatch,
    // Archives and anything markup-shaped are never rendered inline.
    forceDownload: renderRisk || detected.category === 'archive',
  };
}
