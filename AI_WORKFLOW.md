# AI workflow note

> **Before you submit:** sections marked ✏️ should be checked against your own experience and edited. Everything else records what actually happened while this project was built.

## Tools used

- **Claude Code** (Anthropic, running in VS Code): scaffolding, implementation, tests, running builds and smoke tests, and drafting docs.
- ✏️ *Add any others you used (ChatGPT, Copilot, etc.), or remove this line.*

## Where AI materially sped things up

- **Boilerplate across many surfaces at once:** the Express routes, the SQLite schema, the React pages, and the CSS for a clean Docs-style layout. This would have been several hours of typing.
- **Library integration details:** TipTap toolbar wiring, multer limits, mammoth/marked conversion, and the sanitize-html allowlist.
- **Test authoring:** the 13 supertest cases that walk through the owner → viewer → editor → revoked lifecycle.
- **Diagnosing environment failures quickly** (see below) instead of losing an hour to them.

## What AI-generated output was changed or rejected

These came up during this build:

- **Toolchain choice, revised twice.** The first scaffold used Vite 8 and Vitest. On the dev machine, Windows Application Control blocked Vite 8's native Rust bundler binary, and its WASM fallback couldn't resolve Windows drive paths. I rejected "just retry the install" and changed course:
  - Tests moved to Node's built-in `node:test`, which needs no extra tooling.
  - The build moved to Vite 6, with `rollup`/`esbuild` overridden to their WASM packages so it builds the same on Windows and on Linux hosts.
- **TipTap version pinned to v2.** I avoided the latest major (v3) because its package layout for Underline and Placeholder changed. I chose stable, known APIs over the newest version under time pressure.
- **Autosave logic restructured.** The first draft of the save queue retried by calling itself recursively inside a `try/finally`. That would have cleared the "request in flight" flag while a request was still running, allowing overlapping saves and false conflicts. I rewrote it as a single loop that drains pending changes one request at a time.
- **Calls that would have triggered spurious saves.** `editor.setEditable()` and `setContent()` emit update events by default. Both calls pass `emitUpdate: false`, so loading a document never saves it back.
- **A re-render bug in the share dialog.** Its effect depended on an inline `onClose` prop, so it re-ran (refetching users and stealing focus) on every parent render. I fixed it with a ref.
- **Scope pushback.** I explicitly chose not to attempt real-time CRDT collaboration and built version-checked saves instead. See `ARCHITECTURE.md`, decision 3.
- ✏️ *Add any changes you made yourself after reviewing the code or using the app.*

## How correctness, UX, and reliability were verified

- **Automated:** `npm test`. 13 API tests against the real Express stack, all passing. They focus on access control, sanitization, conflicts, and upload validation, because that's where bugs would be costly.
- **Production smoke test:** I built the app, ran `npm start` against a fresh DB, and checked over HTTP that:
  - the SPA and deep links are served
  - the seeded editor (Bob) sees Alice's document under "Shared with me"
  - a save bumps the version
  - a stale save returns 409
- **`.docx` import:** checked with a generated Word file (heading, bold, and italic preserved) and with a corrupt file (clean 422 error).
- **Code review:** read every generated file. Several of the fixes above came from that review, not from test failures.
- ✏️ **Manual UX pass:** *describe what you clicked through yourself, e.g. two windows as Alice and Bob, editing, sharing, viewer read-only, the conflict banner, import/insert file, mobile width.*
