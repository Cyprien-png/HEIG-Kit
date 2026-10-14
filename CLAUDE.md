# HEIG-Kit

TypeScript toolkit giving HEIG-VD students access to their own GAPS and Cyberlearn data, logging in through SWITCH edu-ID
with the credentials in `.env`. edu-ID two-step login (authenticator app) is supported, and the login session is saved in
`.cache/session.json` so codes are rarely needed.
The repository is also the `heig` Claude Code plugin (`.claude-plugin/`), each skill in `skills/<name>/SKILL.md`, invoked as `heig:<name>`.

## Answering questions about the user's planning, deadlines, courses or homework

Follow the `heig:planning` (`skills/planning/SKILL.md`), `heig:deadlines` (`skills/deadlines/SKILL.md`) and
`heig:courses` (`skills/courses/SKILL.md`) skills.
Never print or commit the content of `.env` or `.cache/`.

## Layout

- `src/http.ts`: cookie-aware session saved to disk between runs, and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow with two-step login codes, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login (reusing valid sessions, resuming a login waiting for a code) and iCalendar schedule export
- `src/cyberlearn/client.ts`: Cyberlearn Moodle web services, authenticated with the mobile app token obtained via edu-ID
- `src/cli.ts`: `schedule`, `deadlines`, `courses` and `course` commands, schedule cache, saved session and token, `--mfa-code` handling
- `src/deadlines.ts`: deadlines table rendering
- `src/courses.ts`: course list and course contents as text (HTML of labels and pages converted to text)
- `src/render.ts`: shared box-drawing grid and course colors
- `src/table.ts`: weekly timetable rendering
- `src/dates.ts`: Europe/Zurich date helpers
- `src/paths.ts`: project root, so the CLI runs from any directory
- `src/rag/`: knowledge base: `db.ts` (pgvector, migrations in `rag/migrations/`), `extract.ts` (docling), `chunk.ts`
  (structure-aware chunking, one chunk per exercise), `embed.ts` (Ollama bge-m3), `sources/` (Cyberlearn, local folders),
  `ingest.ts` (incremental, deduplicated by content hash), `search.ts` (hybrid vector + French full-text + exercise numbers)
- `src/mcp/server.ts`: MCP server (Streamable HTTP, token in `data/mcp-token`) over the knowledge base
- `rag/compose.yml`: Docker services (db, embedder, docling for ingestion only, mcp); kept out of the root so Compose
  does not read the root `.env`
- `data/`: downloaded documents, extracted text and MCP token; never commit it
- `scripts/mcp-token.ts`: creates the MCP token and prints the `claude mcp add` command
- `scripts/aliases.ts`: installs the `heig:*` terminal shortcuts (`heig-*` on Windows) in the user's shell configuration
- `skills/`: plugin skills; run `claude plugin validate .` after changing them or `.claude-plugin/`

Run `npm test` (node:test) and `npx tsc --noEmit` after changes.
