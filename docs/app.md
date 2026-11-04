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

`GET /api/calendar/events/<key>/history` shows every version. Kinds: `lesson`, `deadline`, `exam`, `event`; exams are
deadlines or lessons whose title says TE, examen, test or contrôle, lessons whose course page announces an evaluation
that day, or manual events of kind `exam`.

### Calendars (layers)

Every version belongs to a calendar (`calendars`): the built-in **Horaires** (GAPS lessons), **Examens** and **Rendus**
(Cyberlearn deadlines) receive the source events according to their kind; the user's own calendars (a revision plan
before an exam, created on the page, by the agent with `set_calendar`, or with `npm run calendar -- import`) hold the
rest. A calendar can be hidden, renamed and recolored; deleting one of the user's own deletes its versions, so a source
event moved into it falls back to its previous version. An event changed by hand into another kind follows its kind
into the matching built-in calendar unless it was placed elsewhere on purpose. `GET /api/calendars`,
`POST /api/calendars`, `PATCH|DELETE /api/calendars/<id>`; `GET /api/calendar?calendars=1,4&visible=true`.

### Programme of a lesson

The Cyberlearn sync also stores the contents of every curriculum course page (snapshot `contents`) and reads the
plannings teachers post there ("Lundi 9 novembre — Cours : … — Exercices : …", `src/app/lessons.ts`): each GAPS lesson
gets the programme announced for its day in its details, shown when the lesson is clicked, and a lesson announced as an
evaluation becomes an exam named after the announcement. The lessons are refreshed from the saved schedule after every
Cyberlearn sync, so a planning posted later still reaches the calendar.

## Courses and documents

The Courses page lists the indexed material of each curriculum course and searches it. A document opens as the original
PDF, as Markdown (the extracted text rendered, with the figures the extraction saved in place of their `[figure n : …]`
markers, served by `GET /api/kb/documents/<id>/figures/<n>`, and the raw text of unreadable formulas marked) or as plain
text, page by page with a filter; the Markdown view is the default on phones.

## Library

Generated documents and videos are the files of the output folder, on the server (`outputs` volume, or the folder named by `HEIG_LIBRARY_DIR` in `rag/.env`). The API lists
them, streams them (videos with HTTP range requests, so they seek in the browser) and accepts uploads. A local
installation syncs with `npm run library -- push|pull`: the server is the place where everything ends up, whether the
agent rendered it there or on the user's computer.

Each item carries a course code and tags (`library_tags`): a type among `explication`, `révision`, `exercices`,
`corrigé`, `te blanc`, `vidéo`, and free topics such as `calcul matriciel`. The agent sets them with the
`tag_library_item` MCP tool (`npm run library -- tag <item> --course MAD --tags "exercices,calcul matriciel"`); an item
without saved tags is classified from its name and title (the course codes come from the GAPS snapshots). The web app
lists the library by course then by type, and filters it by course, type and tags; `list_library` gives the same view.

## Flashcards

Decks (`decks`) of cards (`cards`, Markdown with LaTeX on both faces) per course. Studying follows a small spaced
repetition scheme (`card_state`: due date, interval, ease, four grades), on the web (keyboard and touch) and through
`GET /api/study`. The agent creates decks from the course material (`create_deck`, `add_flashcards`), the
`heig:flashcards` skill explains how.

A review on the web is a **session** kept on the server (`study_sessions`, `study_session_answers`): the cards of the
study queue in order (shuffled on request), the grade given at each slot, and the position reached. Leaving the page
keeps it; opening the deck again resumes it (`POST /api/study/sessions` returns the session in progress, or starts
one; `discard: true` drops it first, which the deck page asks for with « Recommencer »). Arrows and the strip above the
card move between the slots, each showing the answer given, and a card can be answered again. A card graded « à
revoir » is appended once to the session. « Terminer » closes the session (`PATCH … {finished: true}`); every grade
updates the card's spaced repetition state at once, whether the session is finished or not.

## Quizzes

True/false quizzes (`quizzes`, `quiz_questions`): the agent writes them from the course material (`create_quiz`,
`heig:quiz` skill), the student answers them one statement at a time: full-screen cards swiped right (true) or left (false) on the
web app's Quiz page (LaTeX between `$…$` is rendered), aloud with a voice assistant through `start_quiz` / `answer_quiz` (each call records an answer
and returns the next question, the last one returns the result as lines to read), or `npm run quiz -- play` in the
terminal. An attempt may shuffle the questions (the « Mélanger » switch of the Quiz page, `shuffle` of `start_quiz`,
`--shuffle` of `play`): the order is kept with the attempt (`question_order`) and the questions are numbered in that order.
Every attempt (`quiz_attempts`, `quiz_answers`) ends with a score and the mistakes with their explanation
and source; an attempt stopped early counts the rest as wrong.

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
