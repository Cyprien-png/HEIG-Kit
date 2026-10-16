# HEIG-Kit

TypeScript toolkit giving HEIG-VD students access to their own GAPS and Cyberlearn data, logging in through SWITCH edu-ID
with the credentials in `.env`. edu-ID two-step login (authenticator app) is supported, and the login session is saved in
`.cache/session.json` so codes are rarely needed.
The repository is also the `heig` Claude Code plugin (`.claude-plugin/`), each skill in `skills/<name>/SKILL.md`, invoked as `heig:<name>`.

## Answering questions about the user's planning, deadlines, courses or homework

Follow the `heig:planning` (`skills/planning/SKILL.md`), `heig:deadlines` (`skills/deadlines/SKILL.md`),
`heig:courses` (`skills/courses/SKILL.md`), `heig:teacher` (`skills/teacher/SKILL.md`, course knowledge base),
`heig:documents` (`skills/documents/SKILL.md`, PDF/DOCX/HTML), `heig:visuals` (`skills/visuals/SKILL.md`, manim),
`heig:studies` (`skills/studies/SKILL.md`, study plan and course sheets) and `heig:grades` (`skills/grades/SKILL.md`,
grades and absences) skills.

## Modules

HEIG-Kit is a template made of optional modules (campus, knowledge, documents, visuals, shortcuts, claude), installed with
`npm run setup -- <module…>` (`--status` to check them). Each module is defined in `src/setup/modules/<id>.ts` (install and
check functions) and registered in `src/setup/registry.ts`; system packages go through `src/setup/system.ts` (Homebrew,
winget, apt, dnf, pacman) so that every module installs on macOS, Linux and Windows. User documentation is in `docs/`;
keep `README.md` short.
Never print or commit the content of `.env` or `.cache/`.

## Layout

- `src/http.ts`: cookie-aware session saved to disk between runs, and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow with two-step login codes, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login (reusing valid sessions, resuming a login waiting for a code), iCalendar schedules of any
  entity, and `sajax()`: many GAPS pages load their content with SAJAX calls (POST rs=<function>&rsargs=<JSON> to the
  page, answer "+:" then JSON); find the function and arguments by watching the page's requests in a browser
- `src/gaps/entities.ts` (people, teachers, rooms, classes of the schedule menu), `student.ts` (study plan and absences
  of "Détails étudiant"), `sheets.ts` (unit and module sheets as Markdown), `grades.ts` (continuous assessment and
  transcript), `render.ts` (Markdown output of `npm run gaps`)
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
  `ingest.ts` (incremental, deduplicated by content hash, curriculum courses = GAPS timetable codes, one run at a time), `search.ts` (hybrid vector + French full-text + exercise numbers)
- `src/services.ts`: logic shared by the CLI and the MCP server; `src/mcp/host.ts`: complete MCP server on the host
  (stdio or `--http` 8766), tools in `src/mcp/tools/`; `src/mcp/server.ts`: knowledge-only MCP server in Docker (8765).
  Add every new feature both as a CLI command and as an MCP tool
- `rag/compose.yml`: Docker services (db, embedder, docling for ingestion only, mcp); kept out of the root so Compose
  does not read the root `.env`
- `data/`: downloaded documents, extracted text and MCP token; `vendor/`: installed programs; never commit them, nor any
  capture of a GAPS or Cyberlearn page (they contain personal data): keep experiments in `.cache/`
- `modules/documents/`: Markdown → PDF/HTML/DOCX renderer (own package.json: markdown-it, KaTeX, Mermaid, puppeteer;
  pandoc for DOCX), `npm run doc`
- `modules/visuals/render.ts`: ManimGL wrapper (`npm run video`): dry run (`plan.py`: durations of the animations, each
  animation computed halfway, layout check of `layout.py`), parts rendered in parallel (`parts.ts`) and joined with
  FFmpeg, key frames sheet; `heigkit_manim.py`: `CourseScene` template and ready-made scene pieces;
  manim and TinyTeX live in `vendor/` (see `src/vendor.ts`)
- `scripts/setup.ts`: module installer (`npm run setup`)
- `scripts/generated.ts`: lists and reopens generated documents and videos (`npm run generated`), checked by the skills
  before creating anything new
- `scripts/update.ts` (`npm run rag:update`) and `scripts/autoupdate.ts` (daily task: launchd, systemd/cron, schtasks)
- `scripts/mcp-token.ts`: creates the MCP token and prints the `claude mcp add` command
- `scripts/aliases.ts`: installs the `heig:*` terminal shortcuts (`heig-*` on Windows) in the user's shell configuration
- `skills/`: plugin skills; run `claude plugin validate .` after changing them or `.claude-plugin/`

Run `npm test` (node:test) and `npx tsc --noEmit` after changes.
