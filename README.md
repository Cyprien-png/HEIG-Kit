# HEIG-Kit

HEIG-Kit is an open-source toolkit and Claude Code plugin that allows students of HEIG-VD to access their own
academic information from the command line or through an AI assistant, using their personal SWITCH edu-ID account.

> HEIG-Kit is an independent student project. It is not affiliated with, endorsed by or sponsored by HEIG-VD,
> HES-SO or SWITCH. See [Disclaimer](#disclaimer).

## Features

| Feature | Source | Status |
|---|---|---|
| Personal timetable (weekly view, date ranges, JSON export) | GAPS | Available |
| Natural-language timetable assistant (`heig:planning`) | GAPS | Available |
| Pending activities and deadlines (assignments, quizzes, overdue work) | Cyberlearn | Available |
| Natural-language deadline assistant (`heig:deadlines`) | Cyberlearn | Available |
| Course contents as text (plannings, resources, activities) | Cyberlearn | Available |
| Course and homework assistant (`heig:courses`), combining timetable, course plannings and deadlines | GAPS, Cyberlearn | Available |
| Local course knowledge base (RAG): incremental indexing of course documents with course, teacher and chapter | Cyberlearn, local folders | Available |
| MCP server giving AI assistants search access to the knowledge base (explanations, exercises, exam preparation) | Knowledge base | Available |
| GitHub repositories as a source, scanned documents (OCR), teacher prompt templates | | Planned |

## Requirements

- Node.js 20 or later
- A SWITCH edu-ID account linked to HES-SO, with access to GAPS and Cyberlearn
- An authenticator app, if two-step login is enabled on that edu-ID account (see below)
- [Claude Code](https://claude.com/claude-code), only for the assistant features
- [Docker](https://www.docker.com/products/docker-desktop/) with at least 8 GB of memory allocated, only for the knowledge
  base (about 6 GB of disk space for the services, plus your documents)

## Installation

### 1. Install the toolkit

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git
cd HEIG-Kit
npm install
```

### 2. Configure your credentials

```sh
cp .env.example .env
```

Fill in `HEIG_EMAIL` and `HEIG_PASSWORD` in `.env` with your SWITCH edu-ID credentials. This file is excluded from version
control and must never be shared or committed.

### 3. Two-step login (multi-factor authentication)

HEIG-Kit supports SWITCH edu-ID two-step login with an authenticator app (TOTP). Codes are requested only when needed:

- **In a terminal**, HEIG-Kit prompts for the current code of your authenticator app.
- **Through an AI assistant or any non-interactive environment**, the command stops with exit code `2` and the message
  *"edu-ID two-step login code required"*. Rerun it with `--mfa-code <code>` to complete the pending login. The
  `heig:planning` skill handles this automatically by asking you for the code.

After a successful login, the session is saved and edu-ID is instructed to remember the device, so that subsequent runs,
including password re-authentication, do not require a code until edu-ID asks for one again (typically several weeks).

> [!NOTE]
> Passkeys and hardware security keys require a web browser and are not supported. Your authenticator secret is never
> requested nor stored by HEIG-Kit: only the short-lived codes you enter are transmitted to SWITCH edu-ID.

### 4. Install the Claude Code plugin (optional)

The plugin uses the configuration and dependencies of your local copy, and must therefore be installed from it:

```sh
claude plugin marketplace add /path/to/HEIG-Kit
claude plugin install heig@heig-kit
```

To evaluate the plugin without installing it, start Claude Code with `claude --plugin-dir /path/to/HEIG-Kit`.

### 5. Install the terminal shortcuts (optional)

```sh
npm run aliases
```

This adds shortcuts to your shell configuration, so the main commands can be used from any directory:

| macOS / Linux (zsh, bash) | Windows (PowerShell) | Equivalent to |
|---|---|---|
| `heig:planning` | `heig-planning` | `npm run schedule -- --table` |
| `heig:deadlines` | `heig-deadlines` | `npm run deadlines` |
| `heig:courses` | `heig-courses` | `npm run courses` |
| `heig:course MAD` | `heig-course MAD` | `npm run course -- MAD` |

Options are added directly after the shortcut, without `--`, e.g. `heig:planning --from 2026-10-26`. Open a new terminal
after the installation for the shortcuts to be available.

- On macOS and Linux, the shortcuts are written to `~/.zshrc` and/or `~/.bashrc` (`~/.bash_profile` on macOS).
- On Windows, PowerShell does not allow `:` in command names, hence the `heig-` prefix. The shortcuts are written to
  the PowerShell profile; if PowerShell reports that running scripts is disabled, allow local scripts once with
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- The shortcuts point to the current location of your HEIG-Kit copy: run `npm run aliases` again after moving it.
  Run `npm run aliases -- --uninstall` to remove them (on Windows: `npm.cmd run aliases -- --uninstall`).

## Usage

### Command line

```sh
npm run schedule -- --table                         # current week as a colored timetable
npm run schedule -- --table --from 2026-11-02       # week containing a given date
npm run schedule                                    # next 7 days as a list
npm run schedule -- --from 2026-10-19 --to 2026-10-23
npm run schedule -- --all --json                    # full academic year in JSON format
npm run schedule -- --refresh                       # retrieve the latest data from GAPS
```

```sh
npm run deadlines                                   # Cyberlearn activities still to do, including overdue ones
npm run deadlines -- --days 7                       # activities due within the next 7 days
npm run deadlines -- --json                         # details in JSON format, including links
npm run courses                                     # your Cyberlearn courses
npm run course -- MAD                               # a course's content as text (timetable code, id or name)
```

Run `npm run schedule -- --help` for the full list of options.

Cyberlearn data is retrieved through the official Moodle web services, using the access token Moodle issues to its
mobile application. Deadlines are always retrieved live and reflect the Cyberlearn timeline: submitted or completed
activities are not listed.

### Claude Code assistant

Once the plugin is installed, ask Claude Code in natural language:

- **Timetable** (`heig:planning`): *"show my planning"*, *"when is my next PRG lab?"*, *"am I free on Friday afternoon?"*.
  Ask for *"up-to-date"* information to bypass the local cache.
- **Deadlines** (`heig:deadlines`): *"what are my deadlines?"*, *"do I have homework for RXI?"*, *"what's due this week?"*.
- **Courses and homework** (`heig:courses`): *"what homework do I have for Friday?"*, *"what MAD exercises did we do
  yesterday?"*, *"when is the ANA1 written exam?"*. The assistant reads the lessons of the day, then the planning of each
  course on Cyberlearn, and adapts to each teacher's convention ("to do for next time" or exercises listed on the day
  they are started). Plannings published by teachers are indicative; the assistant states its sources.

Skills can also be invoked explicitly, e.g. `/heig:planning` or `/heig:deadlines`.

### Troubleshooting

If authentication fails, verify your credentials, delete `.cache/session.json` to start a new session, then run
`npm run schedule -- --refresh --debug`: the pages visited during authentication are saved to `.cache/debug/` for
inspection. These files may contain personal information and must not be shared publicly.

## Course knowledge base (RAG) and MCP server

HEIG-Kit can build a local knowledge base from your course documents and expose it to AI assistants through an
[MCP](https://modelcontextprotocol.io) server, so that an assistant can explain lectures, find and correct exercises, or
prepare exam questions based on the actual course material, with references to the source documents.

Everything runs on your computer: documents are converted to text with [Docling](https://github.com/docling-project/docling),
embedded with the multilingual [bge-m3](https://huggingface.co/BAAI/bge-m3) model through [Ollama](https://ollama.com),
and stored in PostgreSQL with [pgvector](https://github.com/pgvector/pgvector). No local language model is needed: the
reasoning is done by the assistant you connect (e.g. Claude).

### 1. Start the services

```sh
npm run rag:start      # database, embedding model and MCP server (Docker); creates data/mcp-token
npm run rag:stop       # stops every service; indexed data is kept
```

### 2. Index your documents

```sh
npm run ingest                          # every Cyberlearn course (and local folders, see below)
npm run ingest -- --course MAD          # a single course
npm run ingest -- --dry-run             # only lists what is new or changed
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

### 3. Connect an assistant

```sh
npm run mcp:token      # prints the command registering the server in Claude Code
```

The server listens on `http://127.0.0.1:8765/mcp` (Streamable HTTP) and requires the token stored in `data/mcp-token`
as a `Bearer` authorization header. Other MCP clients (Claude Desktop, n8n…) can use the same address and header.

| Tool | Purpose |
|---|---|
| `search_course_material` | Searches by meaning and keywords, optionally filtered by course and document type |
| `get_exercise` | Statement and solution of a numbered exercise, e.g. `2.22` in `MAD` |
| `get_document` | Extracted text of a document or of a page range |
| `list_courses`, `list_documents` | What is indexed |

### Limitations

- Mathematical formulas that cannot be extracted appear as `[formule]`; the original document is linked in every result.
- Scanned documents (images without text) are not supported yet.
- Videos, archives and other non-document files are not indexed.

### Resetting the knowledge base

```sh
docker compose -f rag/compose.yml --profile ingest down -v   # deletes the database and the downloaded models
rm -rf data/                                                  # deletes downloaded documents, extracted text and the token
```

## Data handling and privacy

- Credentials are stored exclusively in your local `.env` file and are transmitted only to SWITCH edu-ID during
  authentication.
- Retrieved data is stored locally in the `.cache/` directory, which is excluded from version control. Timetable data
  is refreshed at most every 12 hours unless an update is explicitly requested.
- The login session is stored in `.cache/session.json`, readable by your user account only. Anyone obtaining this file
  could access your accounts until the session expires: never share it, and delete it to sign out.
- The Cyberlearn access token is stored in `.cache/cyberlearn-token.json`, readable by your user account only. It grants
  access to your Cyberlearn account until it expires or is revoked: never share it, and delete it to revoke local access.
- While a login waits for a two-step login code, its state is kept in `.cache/mfa-pending.json`, readable by your user
  account only, and deleted as soon as the login completes.
- Course documents downloaded for the knowledge base, their extracted text and the MCP token are stored in the `data/`
  directory, which is excluded from version control and from Docker images. The database and the models are stored in
  local Docker volumes. Every service listens on `127.0.0.1` only, and the MCP server requires its token.
- HEIG-Kit does not collect telemetry and does not transmit your data to any third party. When used through an AI
  assistant, the information you request is processed by that assistant according to its own terms and privacy policy.

## Acceptable use

By using HEIG-Kit, you agree to:

- use it only with your own account and for personal, non-commercial study purposes;
- comply with the IT usage policies of HEIG-VD and HES-SO and with the terms of use of the platforms accessed;
- refrain from redistributing course materials or any other content retrieved with HEIG-Kit, which remain the property of
  their respective authors and institutions, including the `data/` directory and the knowledge base built from them;
- refrain from any use that could impair the availability or security of the platforms accessed.

## Disclaimer

HEIG-Kit is an independent project developed by students. It is not affiliated with, endorsed by or sponsored by HEIG-VD,
HES-SO, SWITCH or Anthropic. All product names, logos and trademarks are the property of their respective owners.

HEIG-Kit is provided "as is", without warranty of any kind, express or implied. The authors shall not be held liable for
any damage, data loss, account restriction or other consequence arising from its use. The information it displays may be
incomplete or outdated; the official platforms remain the sole authoritative source.

## License

No license has been granted yet. Until a license file is added to this repository, all rights are reserved by the authors.
