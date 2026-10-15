# Knowledge base and teacher (`knowledge` module)

HEIG-Kit can build a local knowledge base from your course documents and expose it to AI assistants through an
[MCP](https://modelcontextprotocol.io) server, so that an assistant can explain lectures, find and correct exercises, or
prepare exam questions based on the actual course material, with references to the source documents.

Everything runs on your computer: documents are converted to text with [Docling](https://github.com/docling-project/docling),
embedded with the multilingual [bge-m3](https://huggingface.co/BAAI/bge-m3) model through [Ollama](https://ollama.com),
and stored in PostgreSQL with [pgvector](https://github.com/pgvector/pgvector). No local language model is needed: the
reasoning is done by the assistant you connect (e.g. Claude).

## How it works

HEIG-Kit retrieves your course documents from Cyberlearn through its official Moodle web services (with the access token
Moodle gives its mobile app), and optionally from your own folders. Each document is converted to text (Docling), split
along its structure (one passage per exercise for exercise sheets), embedded with a multilingual model (bge-m3, on your
CPU) and stored in PostgreSQL with pgvector. Searches combine meaning, keywords and exact exercise numbers. No local
language model is needed: the AI assistant you connect does the reasoning, and cites the passages it used.

## 1. Start the services

`npm run setup -- knowledge` installs Docker if needed and starts everything. Afterwards:

```sh
npm run rag:start      # database, embedding model and MCP server (Docker); creates data/mcp-token
npm run rag:stop       # stops every service; indexed data is kept
```

## 2. Index your documents

```sh
npm run ingest                          # the courses of your curriculum (and local folders, see below)
npm run ingest -- --course MAD          # a single course
npm run ingest -- --all-courses         # every Cyberlearn course you are enrolled in
npm run ingest -- --dry-run             # only lists what is new or changed
```

**Only the courses of your curriculum are indexed:** the Cyberlearn courses whose code appears in your GAPS timetable.
The timetable is refreshed at each indexing, so the courses of a new semester are added as soon as GAPS publishes them.
Courses you no longer follow keep their documents, for revisions. To adjust the selection, list course codes, ids or
parts of names in `.env`:

```sh
RAG_EXTRA_COURSES=PHY          # also index these courses
RAG_EXCLUDE_COURSES=49168      # never index these ones
```

The first run downloads the embedding model (about 1.2 GB) and the document extraction service (about 2 GB), which is
started for the duration of the indexing only. Indexing is CPU-intensive: allow one to three seconds per PDF page, so the
first run may take an hour or more. **On macOS, prevent the computer from sleeping during long runs** with
`caffeinate -i npm run ingest`.

Indexing can be run as often as needed: unchanged documents are skipped without being downloaded, updated documents
replace their previous version, identical files published in several places are indexed once, and documents removed from
Cyberlearn are removed from the index. A document that fails (e.g. a network error) is simply retried on the next run.

Each passage keeps its course, teachers, chapter (the Cyberlearn section), document type (lecture, exercises, solutions,
exam, lab, planning), pages and, for exercise sheets, the exercise number.

**Local folders.** To index your own documents (PDF, DOCX, PPTX, Markdown…), list their folders in `.env`, separated by
`:` (`;` on Windows), and organize them as `<folder>/<COURSE>/<chapter>/<file>`:

```sh
RAG_LOCAL_DIRS=/Users/me/Documents/HEIG
```

## 3. Keep it up to date automatically

```sh
npm run autoupdate                      # daily update at 08:00 (or: npm run autoupdate -- --time 12:30)
npm run autoupdate -- --uninstall       # removes the daily update
npm run rag:update                      # runs an update now: starts Docker and the services, then indexes
```

The daily update is a LaunchAgent on macOS, a systemd user timer (or a cron job) on Linux and a scheduled task on
Windows; on macOS and Linux, an update missed while the computer was asleep runs when it wakes up. Docker Desktop is
started if needed on macOS. Progress is logged in `data/logs/update.log`, and on macOS a notification reports failures,
for instance when edu-ID asks for a two-step login code: run `npm run rag:update` in a terminal to enter it.

## 4. Connect an assistant

`npm run setup -- claude` registers the MCP server in Claude Code. For other clients:

```sh
npm run mcp:token      # prints the token and the claude mcp add command
```

The server listens on `http://127.0.0.1:8765/mcp` (Streamable HTTP) and requires the token stored in `data/mcp-token`
as a `Bearer` authorization header. Other MCP clients (Claude Desktop, n8n…) can use the same address and header.

| Tool | Purpose |
|---|---|
| `search_course_material` | Searches by meaning and keywords, optionally filtered by course and document type |
| `get_exercise` | Statement and solution of a numbered exercise, e.g. `2.22` in `MAD` |
| `get_document` | Extracted text of a document or of a page range |
| `list_courses`, `list_documents` | What is indexed |

The same queries are available from the terminal, and are used by the Claude Code skills when the MCP server is not
registered:

```sh
npm run kb -- search "diagramme de Hasse" --course MAD
npm run kb -- exercise 2.22 --course MAD
npm run kb -- document 3 --pages 41-42
npm run kb -- documents MAD --type exam
```

## Limitations

- Mathematical formulas that cannot be extracted appear as `[formule]`; the original document is linked in every result.
- Scanned documents (images without text) are not supported yet.
- Videos, archives and other non-document files are not indexed.

## Resetting the knowledge base

```sh
docker compose -f rag/compose.yml --profile ingest down -v   # deletes the database and the downloaded models
rm -rf data/                                                  # deletes downloaded documents, extracted text and the token
```

## The teacher (`heig:teacher`)

In Claude Code, ask about your courses in natural language: *"explique-moi les diagrammes de Hasse"*, *"génère-moi 5
exercices sur les relations d'équivalence avec les corrigés"*, *"prépare-moi un TE blanc de MAD"*, *"corrige ma réponse à
l'exercice 2.22"*. Answers are complete, illustrated with concrete examples and cite the course documents (document,
pages, link). Practice exams follow the format of the course's past exams. With the `documents` and `visuals` modules, the
teacher can also export PDFs and create animations.
