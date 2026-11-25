import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { sanitizeContent, convertUpload, ConversionError, MAX_UPLOAD_BYTES } from './convert.js';

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 2_000_000; // characters of HTML
const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };
const SHARE_ROLES = ['viewer', 'editor'];
const SESSION_COOKIE = 'uid';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function validateTitle(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Title must be a string.');
  const title = value.trim();
  if (!title) throw new HttpError(400, 'Title cannot be empty.');
  if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, `Title must be at most ${MAX_TITLE_LENGTH} characters.`);
  return title;
}

function validateContent(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Content must be an HTML string.');
  if (value.length > MAX_CONTENT_LENGTH) throw new HttpError(413, 'Document is too large to save.');
  return sanitizeContent(value);
}

/**
 * Builds the Express app. The database is injected so tests can use an
 * in-memory SQLite instance and the server can use a file.
 */
export function createApp({ db, secret = 'dev-only-secret', secureCookies = false, staticDir } = {}) {
  if (!db) throw new Error('createApp requires a db');

  const q = {
    userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT id, email, name FROM users WHERE email = ?'),
    allUsers: db.prepare('SELECT id, email, name FROM users ORDER BY name'),
    docById: db.prepare('SELECT * FROM documents WHERE id = ?'),
    ownedDocs: db.prepare(`
      SELECT d.id, d.title, d.updated_at, d.created_at,
             (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id) AS share_count
      FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`),
    sharedDocs: db.prepare(`
      SELECT d.id, d.title, d.updated_at, d.created_at, s.role, u.name AS owner_name, u.email AS owner_email
      FROM shares s
      JOIN documents d ON d.id = s.document_id
      JOIN users u ON u.id = d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC`),
    insertDoc: db.prepare(`
      INSERT INTO documents (id, owner_id, title, content, version, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`),
    // Optimistic concurrency: the update only applies if the caller saw the latest version.
    updateDoc: db.prepare(`
      UPDATE documents SET title = ?, content = ?, version = version + 1, updated_at = ?, updated_by = ?
      WHERE id = ? AND version = ?`),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    shareFor: db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?'),
    sharesForDoc: db.prepare(`
      SELECT u.id AS user_id, u.name, u.email, s.role
      FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.document_id = ? ORDER BY u.name`),
    upsertShare: db.prepare(`
      INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?'),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser(secret));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // ---------- helpers ----------

  function requireUser(req, _res, next) {
    const id = req.signedCookies?.[SESSION_COOKIE];
    const user = id ? q.userById.get(id) : undefined;
    if (!user) return next(new HttpError(401, 'Please sign in.'));
    req.user = user;
    next();
  }

  /** Returns the doc and the caller's role, or throws 404 (no existence leak) / 403. */
  function requireAccess(req, minRole) {
    const doc = q.docById.get(req.params.id);
    let role = null;
    if (doc) {
      if (doc.owner_id === req.user.id) role = 'owner';
      else role = q.shareFor.get(doc.id, req.user.id)?.role ?? null;
    }
    if (!doc || !role) throw new HttpError(404, 'Document not found.');
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      throw new HttpError(403, minRole === 'owner' ? 'Only the owner can do that.' : 'You have view-only access to this document.');
    }
    return { doc, role };
  }

  function serializeShares(docId) {
    return q.sharesForDoc.all(docId).map((s) => ({ userId: s.user_id, name: s.name, email: s.email, role: s.role }));
  }

  function serializeDoc(doc, role) {
    const owner = q.userById.get(doc.owner_id);
    const updatedBy = doc.updated_by ? q.userById.get(doc.updated_by) : null;
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      updatedBy: updatedBy ? { id: updatedBy.id, name: updatedBy.name } : null,
      owner: { id: owner.id, name: owner.name, email: owner.email },
      role,
      shares: role === 'owner' ? serializeShares(doc.id) : undefined,
    };
  }

  function createDocument(ownerId, title, content) {
    const id = randomUUID();
    const now = new Date().toISOString();
    q.insertDoc.run(id, ownerId, title, content, now, now, ownerId);
    return q.docById.get(id);
  }

  // ---------- routes ----------

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.post('/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) throw new HttpError(400, 'Email is required.');
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(401, 'Unknown account. Use one of the seeded demo users.');
    res.cookie(SESSION_COOKIE, user.id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ user });
  });

  api.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  // Public list so the login screen can offer the seeded accounts.
  api.get('/users', (_req, res) => res.json({ users: q.allUsers.all() }));

  api.use(requireUser);

  api.get('/auth/me', (req, res) => res.json({ user: req.user }));

  api.get('/documents', (req, res) => {
    const owned = q.ownedDocs.all(req.user.id).map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updated_at,
      createdAt: d.created_at,
      shareCount: d.share_count,
      role: 'owner',
    }));
    const shared = q.sharedDocs.all(req.user.id).map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updated_at,
      createdAt: d.created_at,
      role: d.role,
      owner: { name: d.owner_name, email: d.owner_email },
    }));
    res.json({ owned, shared });
  });

  api.post('/documents', (req, res) => {
    const body = req.body ?? {};
    const title = body.title === undefined ? 'Untitled document' : validateTitle(body.title);
    const content = body.content === undefined ? '' : validateContent(body.content);
    const doc = createDocument(req.user.id, title, content);
    res.status(201).json(serializeDoc(doc, 'owner'));
  });

  // Upload a .txt/.md/.docx file and turn it into a new editable document.
  api.post('/documents/import', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
    const { title, html } = await convertUpload(req.file);
    const doc = createDocument(req.user.id, title, html);
    res.status(201).json(serializeDoc(doc, 'owner'));
  });

  // Convert a file to editor HTML without creating a document (used for "Insert from file").
  api.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
    res.json(await convertUpload(req.file));
  });

  api.get('/documents/:id', (req, res) => {
    const { doc, role } = requireAccess(req, 'viewer');
    res.json(serializeDoc(doc, role));
  });

  api.patch('/documents/:id', (req, res) => {
    const { doc, role } = requireAccess(req, 'editor');
    const body = req.body ?? {};
    if (!Number.isInteger(body.baseVersion)) throw new HttpError(400, 'baseVersion (integer) is required.');
    if (body.title === undefined && body.content === undefined) throw new HttpError(400, 'Nothing to update.');

    const title = body.title === undefined ? doc.title : validateTitle(body.title);
    const content = body.content === undefined ? doc.content : validateContent(body.content);

    const result = q.updateDoc.run(title, content, new Date().toISOString(), req.user.id, doc.id, body.baseVersion);
    if (result.changes === 0) {
      const current = q.docById.get(doc.id);
      throw new HttpError(409, 'This document was changed by someone else since you opened it.', {
        current: serializeDoc(current, role),
      });
    }
    res.json(serializeDoc(q.docById.get(doc.id), role));
  });

  api.delete('/documents/:id', (req, res) => {
    const { doc } = requireAccess(req, 'owner');
    q.deleteDoc.run(doc.id);
    res.status(204).end();
  });

  api.put('/documents/:id/shares', (req, res) => {
    const { doc } = requireAccess(req, 'owner');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role ?? 'editor';
    if (!email) throw new HttpError(400, 'Email is required.');
    if (!SHARE_ROLES.includes(role)) throw new HttpError(400, 'Role must be "viewer" or "editor".');
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user with email ${email}.`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document.');
    q.upsertShare.run(doc.id, target.id, role, new Date().toISOString());
    res.json({ shares: serializeShares(doc.id) });
  });

  api.delete('/documents/:id/shares/:userId', (req, res) => {
    const { doc } = requireAccess(req, 'owner');
    q.deleteShare.run(doc.id, req.params.userId);
    res.json({ shares: serializeShares(doc.id) });
  });

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // ---------- static frontend (production build) ----------
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message;
    } else if (err.type === 'entity.too.large') {
      message = 'Request is too large.';
    } else if (err.type === 'entity.parse.failed') {
      message = 'Malformed JSON body.';
    } else if (!(err instanceof HttpError) && !(err instanceof ConversionError) && status >= 500) {
      console.error(err);
      message = 'Something went wrong on our side.';
    }
    res.status(status).json({ error: message, ...(err.extra ?? {}) });
  });

  return app;
}
