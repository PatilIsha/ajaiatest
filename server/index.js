import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, seedDemoContent } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'ajaia.db');
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET is not set; using an insecure default.');
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
seedDemoContent(db);

const app = createApp({
  db,
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  secureCookies: isProd,
  staticDir: path.join(root, 'dist'),
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Ajaia Docs listening on http://localhost:${port} (db: ${dbPath})`);
});
