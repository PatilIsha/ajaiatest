# Architecture note

## Shape

```
Browser (React + TipTap)  ──JSON / multipart──▶  Express API  ──▶  SQLite (node:sqlite)
          ▲                                          │
          └──────── static build served by the same Node process
```

One deployable service. The React app is built by Vite into `dist/`, and Express serves it alongside `/api`. One process and one URL keep deployment trivial and avoid CORS and cross-site cookies entirely.

## Data model

| Table       | Key columns                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `users`     | `id`, `email` (unique), `name`. Seeded; there is no sign-up.                |
| `documents` | `id`, `owner_id`, `title`, `content` (sanitized HTML), `version`, `updated_at`, `updated_by` |
| `shares`    | (`document_id`, `user_id`) PK, `role` ∈ {`viewer`, `editor`}, cascade on document delete |

Ownership is a column, not a share row, so a document always has exactly one owner and the owner can never be "unshared".

## Key decisions and why

1. **The editor is TipTap (ProseMirror), and content is stored as HTML.** ProseMirror gives a real document model, reliable lists and headings, undo, and keyboard shortcuts with very little code. HTML is the editor's native output, is easy to inspect, and is the format the importers already produce. The tradeoff is that HTML is harder to diff or merge than ProseMirror JSON. That only matters once real-time merging exists (see below).

2. **The server sanitizes HTML to the editor's own schema.** Saves and imports both go through one `sanitize-html` allowlist (p, h1–h3, strong, em, u, s, lists, blockquote, code, links). Stored content is therefore always something the editor can render, and a malicious client can't store script for another user to open. h4–h6 collapse to h3, and table cells become paragraphs.

3. **Concurrency is optimistic, not real-time.** Real-time co-editing (CRDT/OT, websockets, presence) is the "Google Docs" feature, and also the one most likely to eat the whole timebox and ship half-working. I chose a smaller guarantee that is correct: **no silent overwrites.** Each save sends `baseVersion`, and the update is a single `UPDATE … WHERE id = ? AND version = ?`. If zero rows change, the server returns 409 with the current document, and the UI stops autosaving and offers to load the latest version. The client sends saves strictly one at a time and merges pending changes, so a user's own rapid edits never conflict with each other.

4. **Access control lives in one function.** Every document route calls `requireAccess(req, minRole)` with a role ranking of viewer < editor < owner. Users with no access get **404, not 403**, so document IDs don't leak existence. Editors can edit and rename; only owners can share, change roles, or delete. The share list is only returned to owners.

5. **Auth is mocked deliberately.** The login screen lists seeded users and sets a **signed, httpOnly** cookie. A hand-crafted `uid=u_alice` cookie is rejected, and there's a test for that. This makes the sharing flow testable in seconds without building identity, which wasn't the point of the exercise. Swapping in real auth (OAuth or magic link) only changes `requireUser`.

6. **Uploads are converted server-side.** Multer keeps files in memory (5 MB cap), and `convert.js` turns `.txt` (paragraphs and line breaks, HTML-escaped), `.md` (marked), and `.docx` (mammoth) into sanitized HTML. The same converter powers both "Import as new document" and "Insert file at cursor", so I built two product flows for the price of one. Uploads aren't stored as attachments. That would need blob storage and is a separate feature.

7. **Storage is SQLite via Node's built-in `node:sqlite`.** There's no native module to compile, it's zero-config locally, and tests run against `:memory:`. The DB is injected into `createApp`, so the tests exercise the real HTTP stack.

## Testing

`tests/api.test.js` contains 13 tests that run against the real Express app and an in-memory DB. They cover auth (including a forged cookie), create, rename, edit, reopen with formatting intact, HTML sanitization, title validation, stale-version 409s, the full owner/editor/viewer/revoke lifecycle, share validation, Markdown and text import, unsupported type (415), and oversize upload (413). I picked the API layer because that's where the access-control and data-integrity rules live, so a regression there matters most.

I also checked `.docx` conversion with a generated Word file and ran a production-build smoke test (SPA deep links, the shared-editor save, stale-save 409). There are no automated UI tests. See "next steps".

## Deliberately cut

- Real-time co-editing, presence, and cursors (replaced by conflict detection)
- Comments, suggestions, and version history
- Images, tables, and fonts/colours in the editor
- Real authentication, sign-up, and sharing with people who have no account
- Storing original uploaded files as attachments

## What I'd build next (2–4 h)

1. **Durable hosting:** a Render disk or libSQL/Postgres, so reviewer data survives restarts.
2. **Version history:** a `document_versions` table written on each save (throttled), plus a restore UI. It builds directly on the existing `version` column and makes conflicts recoverable rather than just detected.
3. **"Someone is editing" indicator:** poll `GET /documents/:id` (or use SSE) for the `version` and `updated_by`, and warn before a conflict happens instead of after.
4. **Playwright end-to-end test** of the share flow across two browser contexts.
5. **Export to Markdown/PDF.**
