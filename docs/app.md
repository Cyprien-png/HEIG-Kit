# Web app, calendar, flashcards, corrections and profile

The remote server ([server.md](server.md)) also serves a web application at the public address: a dashboard for
one student, usable from a phone, a laptop or a wide screen. This page describes how the pieces fit together; the
installation does not change (`npm run server:start`), the web application is built into the `server` image.

## Pieces

| Piece | Where | What |
|---|---|---|
| REST API | `src/server/api/` | `/api/*`, JSON, one route module per domain. Cookie session for the browser, bearer token for agents |
| Web app | `web/` (Vite, React, Tailwind) | Served by the server at `/`, built into the image |
| Domain logic | `src/app/` | Calendar, library, flashcards, corrections, profile, status: plain functions on the database, shared by the API, the MCP tools and the CLI |
| Snapshots and sync | `src/app/sync.ts` | Fetches GAPS and Cyberlearn regularly, keeps the latest state in the database, feeds the calendar |
| MCP tools | `src/mcp/tools/app.ts` | The same features for the agent (remote server and local host) |
| Remote client | `src/remote/` | A local installation talks to the server: remote knowledge base, library push and pull, calendar, cards, corrections |
| Skills | `skills/calendar`, `skills/flashcards`, `skills/correct`, `skills/profile` | Claude Code plugin |

Everything lives in the existing Postgres database (`rag/migrations/003_app.sql` and later).

## Authentication

- Browser: `POST /api/auth/login` with the account of `.env` sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
  holding the same JWT as the MCP access token. State-changing requests with a cookie must also carry the header
  `X-Requested-With: heig-kit` (no cross-site form can add it).
- Agents and the CLI: `Authorization: Bearer <access token>` from `POST /auth/login`, as for MCP.
- Capture pages (phone): a JWT limited to one correction, for a few hours, in the link of the QR code. It can only
  read and add photos of that correction.

## Calendar: versions and overrides

Every event of the calendar is a row of `calendar_versions`, identified by a stable `key`:

- GAPS lessons: `gaps:<summary>|<start>`; Cyberlearn deadlines: `cyberlearn:<event id>`; manual events: `manual:<uuid>`.
- A sync inserts a new row for a key only when the event differs from the latest row of that source for that key
  (title, times, place…), stamped `fetched_at`, the moment the change was observed. An event missing from the source
  gets a row with `deleted = true`.
- An override by the user or the agent (`source = manual`) is another row for the same key.
- The displayed version of a key is simply its **most recent row**. So an override wins until the source changes
  again after it, at which point the source wins back, as asked.
- Manual events have their own keys and are only changed by the user.

`GET /api/calendar/history/<key>` shows every version. Kinds: `lesson`, `deadline`, `exam`, `event`; exams are deadlines
or lessons whose title says TE, examen, test or contrôle, or manual events of kind `exam`.

## Library

Generated documents and videos are the files of the output folder, on the server (`outputs` volume). The API lists
them, streams them (videos with HTTP range requests, so they seek in the browser) and accepts uploads. A local
installation syncs with `npm run library -- push|pull` (or the `sync_library` MCP tool): the server is the place where
everything ends up, whether the agent rendered it there or on the user's computer.

## Flashcards

Decks (`decks`) of cards (`cards`, Markdown with LaTeX on both faces) per course. Studying follows a small spaced
repetition scheme (`card_state`: due date, interval, ease, four grades), on the web (keyboard and touch) and through
`GET /api/decks/<id>/study`. The agent creates decks from the course material (`create_deck`, `add_flashcards`), the
`heig:flashcards` skill explains how.

## Corrections

1. The agent creates a correction (`create_correction`), which gives a capture link; the `heig:correct` skill prints it
   as a QR code in the terminal.
2. The phone opens the capture page: camera or gallery, rotate, crop, reorder, delete, then **send**. Photos are
   stored under `data/corrections/<id>/`.
3. The agent reads the photos (`get_correction` returns them as images), transcribes each exercise and corrects it
   following the `correct_exercises` prompt: statement, the student's answer as written, verdict (correct, partial,
   wrong), what is wrong and the right way, the probable cause, topics. `submit_correction` stores the result.
4. The web page shows the digital version with two toggles: verdicts only (to find one's mistake first), then the
   full correction. Mistakes are recorded in the profile.

## Profile

`profile_notes`: observations about the student per course and topic (`weakness`, `strength`, `mistake`, `note`),
with an embedding so the agent can search them. The profile page aggregates them: weak and strong topics per course,
frequent mistakes, what to revise. `revise_weaknesses` is the prompt that turns them into a revision session.

## Status

`/api/status` reports what the server can check without Docker access: database, embedding service, extraction
service, render worker (last job), edu-ID session and Cyberlearn token, last syncs (`sync_runs`), ingestion (last run,
documents changed on Cyberlearn but not indexed yet), and the last requests (`request_log`: route, status, tool,
whether the token was refused). **Reconnect** runs the edu-ID login again, with a two-step code typed on the page.
