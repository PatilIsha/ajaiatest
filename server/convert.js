import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class ConversionError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/**
 * The allowlist mirrors what the editor can produce (TipTap StarterKit + Underline),
 * so stored HTML is always something the editor can round-trip. Everything else
 * (scripts, event handlers, styles, images) is dropped while its text is kept.
 */
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'], ol: ['start'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    // Tables are out of scope: keep each cell's text as its own paragraph.
    td: 'p',
    th: 'p',
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS).trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Blank lines separate paragraphs; single newlines become line breaks. */
export function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function decodeText(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  if (text.includes('\u0000')) {
    throw new ConversionError('This file does not look like plain text.');
  }
  return text;
}

/**
 * Converts an uploaded file into sanitized editor HTML.
 * @returns {Promise<{ title: string, html: string }>}
 */
export async function convertUpload({ originalname, buffer }) {
  // Multer decodes multipart filenames as latin1; recover UTF-8 names.
  const name = Buffer.from(originalname || '', 'latin1').toString('utf8');
  const ext = path.extname(name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ConversionError(
      `Unsupported file type "${ext || 'unknown'}". Supported: .txt, .md, .docx.`,
      415
    );
  }

  let raw;
  if (ext === '.txt') {
    raw = textToHtml(decodeText(buffer));
  } else if (ext === '.md' || ext === '.markdown') {
    raw = await marked.parse(decodeText(buffer));
  } else {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      raw = result.value;
    } catch {
      throw new ConversionError('Could not read this .docx file. Is it a valid Word document?');
    }
  }

  const html = sanitizeContent(raw);
  if (!html) throw new ConversionError('The file has no readable text content.');

  const title = path.basename(name, path.extname(name)).trim().slice(0, 200) || 'Imported document';
  return { title, html };
}
