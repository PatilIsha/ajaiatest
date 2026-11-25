# Ajaia Docs

A lightweight collaborative document editor: create and format documents, import files, share with teammates as editors or viewers, and never silently lose an edit.

**Live demo:** https://ajaiatest.onrender.com/ (free Render instance: the first load after idle can take ~30–50 s to wake up)
**Source:** https://github.com/PatilIsha/ajaiatest
**Walkthrough video:** https://drive.google.com/file/d/14HrNXnpKyFakVoMVklgRRZx1oOkj1crk/view?usp=sharing

## Demo accounts

Sign-in is mocked: pick a seeded account on the login screen (no password).

| User        | Email              | In the seeded data                                   |
| ----------- | ------------------ | ---------------------------------------------------- |
| Alice Chen  | `alice@ajaia.test` | Owns "Q3 planning notes"                             |
| Bob Rivera  | `bob@ajaia.test`   | Has **edit** access to "Q3 planning notes"           |
| Carol Singh | `carol@ajaia.test` | Has **view** access to "Q3 planning notes"           |

To try sharing, use two browser windows (for example one normal and one private), signed in as different users.

## What works

- **Documents:** create, rename (click the title), edit, and delete (owner only). Changes autosave about 0.8 s after you stop typing, with a visible "Saving… / All changes saved" status. Reopening a document restores its formatting.
- **Rich text (TipTap / ProseMirror):** bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quotes, and undo/redo. Standard keyboard shortcuts (Ctrl/Cmd+B, I, U, Z) work.
- **File upload** (supported types: **.txt, .md, .docx**, up to 5 MB):
  - *Import file* on the documents page turns a file into a new editable document, titled after the filename.
  - *Insert file* in the editor toolbar inserts a file's content at the cursor.
  - Markdown and Word headings, bold, italic, and lists are preserved. Images and tables are not: table cells become paragraphs.
- **Sharing:** the owner shares by email as **Can edit** or **Can view**, and can change roles or revoke access later. The home page splits documents into **My documents** and **Shared with me** (with the owner's name and your role). Viewers get a read-only editor.
- **Safe concurrent edits:** every save carries the document version it was based on. If someone else saved first, the server rejects the save (409) and the UI shows a banner offering to load the latest version. Nobody's work is overwritten silently.
- **Persistence:** SQLite. Stored HTML is sanitized against an allowlist that matches what the editor can produce.

## Run locally

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite` module; developed on Node 24).

```bash
npm install
npm run dev        # API on http://localhost:3001, app on http://localhost:5173
```

Production-style run (one process serves the API and the built frontend):

```bash
npm run build
npm start          # http://localhost:3001
```

Tests:

```bash
npm test           # 13 API tests (node:test + supertest, in-memory SQLite)
```

| Env var          | Default                | Purpose                       |
| ---------------- | ---------------------- | ----------------------------- |
| `PORT`           | `3001`                 | HTTP port                     |
| `DATABASE_PATH`  | `./data/ajaia.db`      | SQLite file (created on boot) |
| `SESSION_SECRET` | dev default            | Signs the session cookie      |
| `NODE_ENV`       | –                      | `production` sets secure cookies |

The database is created and seeded with the demo users (plus one shared document) on first start. To reset, delete `data/`.

## Deploy (Render, free)

`render.yaml` is a Render Blueprint. Push the repo to GitHub, then in Render choose **New → Blueprint** and select the repo. That's all: it builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and generates `SESSION_SECRET`.

**Persistence caveat:** Render's free tier has an ephemeral disk, so the SQLite file resets when the instance restarts or redeploys (for example after it sleeps). Seed data is recreated on boot, so the sharing demo always works, but documents reviewers create may not survive a restart. For durable storage, attach a Render disk and set `DATABASE_PATH` to a path on it, or move to hosted Postgres or libSQL (see `ARCHITECTURE.md`).

## Project layout

```
server/
  app.js       Express app: auth, documents, sharing, upload, error handling
  convert.js   .txt/.md/.docx → sanitized HTML
  db.js        Schema, seeded users, demo content
  index.js     Process entry: opens DB, serves API + built client
client/src/
  pages/       Login, DocList, EditorPage (autosave + conflict handling)
  components/  Toolbar, ShareDialog
  api.js       Fetch wrapper
tests/api.test.js
```

## Note on the build tooling

`package.json` overrides `rollup` and `esbuild` with their WebAssembly builds. The development machine's Windows Application Control policy blocks unsigned native `.node`/`.exe` binaries, so Vite's native bundlers could not load there. The WASM builds behave the same, work everywhere, and cost a few seconds of build time.
