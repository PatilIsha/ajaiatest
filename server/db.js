import { DatabaseSync } from 'node:sqlite';

/**
 * Seeded accounts. Auth is intentionally mocked (pick a user, no password):
 * the assignment is about documents and sharing, not identity.
 */
export const SEED_USERS = [
  { id: 'u_alice', email: 'alice@ajaia.test', name: 'Alice Chen' },
  { id: 'u_bob', email: 'bob@ajaia.test', name: 'Bob Rivera' },
  { id: 'u_carol', email: 'carol@ajaia.test', name: 'Carol Singh' },
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id    TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

  CREATE TABLE IF NOT EXISTS shares (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at  TEXT NOT NULL,
    PRIMARY KEY (document_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)');
  for (const u of SEED_USERS) insertUser.run(u.id, u.email, u.name);
  return db;
}

/** Seeds one shared document so reviewers can see the sharing flow immediately. */
export function seedDemoContent(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM documents').get();
  if (count > 0) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents (id, owner_id, title, content, version, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    'd_welcome',
    'u_alice',
    'Q3 planning notes',
    '<h1>Q3 planning notes</h1><p>This document is <strong>owned by Alice</strong> and shared with ' +
      '<em>Bob (editor)</em> and <u>Carol (viewer)</u>.</p><h2>Goals</h2><ul><li>Ship the editor MVP</li>' +
      '<li>Collect feedback from two teams</li></ul><h2>Next steps</h2><ol><li>Sign in as Bob and make an edit</li>' +
      '<li>Sign in as Carol and confirm the document is read-only</li></ol>',
    now,
    now,
    'u_alice'
  );
  const share = db.prepare('INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
  share.run('d_welcome', 'u_bob', 'editor', now);
  share.run('d_welcome', 'u_carol', 'viewer', now);
}
