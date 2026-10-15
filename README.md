# HEIG-Kit

Your HEIG-VD school life in the terminal and in [Claude Code](https://claude.com/claude-code): timetable, grades, course
sheets, homework, and an AI teacher that knows your course material, exports clean PDFs and animates mathematical
concepts.

> HEIG-Kit is an independent student project, not affiliated with HEIG-VD, HES-SO or SWITCH. See [Disclaimer](#disclaimer).

## Modules

Install only what you need. Each module installs its own dependencies automatically, on macOS, Linux and Windows.

| Module | What you get | Installed for you |
|---|---|---|
| [`campus`](docs/campus.md) | **GAPS**: your timetable and anyone's (student, teacher, room, class), grades, absences, study plan, unit and module sheets. **Cyberlearn**: deadlines, course contents, homework for a given day | — |
| [`knowledge`](docs/knowledge.md) | The **teacher**: explains, cites the course, writes exercises and practice exams from your course documents | Docker, the database, the embedding model |
| [`documents`](docs/documents.md) | PDF, Word and HTML from Markdown, with LaTeX math, Mermaid diagrams and videos | Renderer, Chromium, pandoc |
| [`visuals`](docs/visuals.md) | Mathematical animations with [3b1b/manim](https://github.com/3b1b/manim), embeddable in documents | manim, Python, FFmpeg, LaTeX |
| [`shortcuts`](docs/shortcuts.md) | `heig:planning`, `heig:deadlines`… from any terminal | — |
| `claude` | The `heig:*` skills in Claude Code, and the knowledge base server | — |

**The teacher is a RAG** (retrieval-augmented generation): HEIG-Kit downloads the documents of your Cyberlearn courses
through Cyberlearn's official Moodle API (lectures, exercise sheets, solutions, past exams, plannings), converts them to
text, and indexes them in a local search engine that keeps their course, teacher, chapter, pages and exercise numbers.
The AI assistant searches it to answer from your actual courses and cite them. You can add other sources, such as your
own folders of PDFs, Word files or notes ([details](docs/knowledge.md)).

## Prerequisites

- [Node.js](https://nodejs.org) 20 or later and [git](https://git-scm.com);
- a package manager for the automatic installation of the other dependencies: [Homebrew](https://brew.sh) on macOS,
  winget on Windows 10 and 11 (built in), apt, dnf or pacman on Linux;
- a SWITCH edu-ID account with access to GAPS and Cyberlearn (`campus`, and `knowledge` to index Cyberlearn);
- [Docker](https://www.docker.com/products/docker-desktop/) with 8 GB of memory for `knowledge` (installed by the setup on
  macOS and Windows);
- [Claude Code](https://claude.com/claude-code) for the AI assistant (`claude` module).

## Installation

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git
cd HEIG-Kit
npm install
npm run setup -- campus knowledge documents visuals claude   # the modules you want, or: --all
```

The setup installs every dependency **locally**, on your computer: programs go to your system's package manager or to the
`vendor/` folder, services run in Docker on your machine, and the indexed courses stay in `data/`. Internet is needed
for the installation, and afterwards only to update what HEIG-Kit retrieves from GAPS and Cyberlearn and for the AI
assistant itself; the knowledge base, document rendering and animations work offline.

- `npm run setup -- knowledge --ingest` also indexes your Cyberlearn courses now and then every day (a couple of hours
  the first time; only the courses of your GAPS timetable).
- `npm run setup -- --status` shows what is installed and working; `--dry-run` shows what would be installed.

## Usage

**1. Credentials.** The `campus` setup asks for your SWITCH edu-ID email and password and writes them to `.env`. You can
also fill it yourself from the template:

```sh
cp .env.example .env    # then set HEIG_EMAIL and HEIG_PASSWORD
```

**2. In Claude Code** (after `npm run setup -- claude`, then `/reload-plugins` or a new session), just ask:

| You ask | Skill |
|---|---|
| *"montre mon planning"*, *"quand ai-je labo de PRG ?"*, *"l'horaire de la salle C23"* | `heig:planning` |
| *"quelles sont mes notes ?"*, *"combien d'absences en PRG ?"* | `heig:grades` |
| *"montre-moi la fiche de MAD"*, *"quelles unités font partie de MAI1 ?"* | `heig:studies` |
| *"quels devoirs pour vendredi ?"*, *"mes deadlines"* | `heig:courses`, `heig:deadlines` |
| *"explique-moi les relations d'équivalence"*, *"prépare-moi un TE blanc de MAD"* | `heig:teacher` |
| *"exporte en PDF"*, *"montre-moi visuellement pourquoi…"* | `heig:documents`, `heig:visuals` |

Generated documents and videos go to `~/Documents/HEIG-Kit` and open automatically; the assistant reuses what it already
generated before creating anything new.

**3. In the terminal**, every feature has a command, e.g. `npm run schedule -- --table`, `npm run gaps -- grades`,
`npm run deadlines`: see each module's page.

**Other AI assistants.** Every feature is also exposed by an [MCP](https://modelcontextprotocol.io) server running on
your computer (`npm run -s mcp`), usable by Claude Desktop, Open WebUI, n8n or any MCP client: see [docs/mcp.md](docs/mcp.md).

## How your credentials are used

The `campus` module, and the `knowledge` module when it indexes Cyberlearn, sign in to GAPS and Cyberlearn with your
SWITCH edu-ID, as you would in a browser:

- your email and password are stored in `.env` in your HEIG-Kit folder only, readable by your user account only, and
  never committed;
- they are sent to SWITCH edu-ID only, when a session must be opened;
- the session cookies (`.cache/session.json`) and the Cyberlearn access token (`.cache/cyberlearn-token.json`) are kept
  locally so that you rarely log in again; delete `.cache/` to sign out;
- with two-step login enabled, you are asked for the code of your authenticator app when needed; your authenticator
  secret is never requested nor stored.

## Data and privacy

- Everything runs on your computer. Course documents, extracted text and the knowledge base stay in `data/`,
  `vendor/`, `.cache/` and local Docker volumes, all excluded from version control and Docker images. Services listen on
  `127.0.0.1` only, and the knowledge base server requires an access token.
- HEIG-Kit collects no telemetry and sends your data to no third party. When used through an AI assistant, what you ask,
  and the data the assistant reads to answer you (grades, course excerpts…), is processed by that assistant according to
  its own terms and privacy policy; with a local model, nothing leaves your computer.

## Acceptable use

By using HEIG-Kit, you agree to:

- use it only with your own account and for personal, non-commercial study purposes;
- comply with the IT usage policies of HEIG-VD and HES-SO and with the terms of use of the platforms accessed;
- consult other people's schedules only for legitimate purposes, as GAPS itself allows;
- refrain from redistributing course materials or any content retrieved with HEIG-Kit (including `data/` and the
  knowledge base), which remain the property of their authors and institutions;
- refrain from any use that could impair the availability or security of the platforms accessed.

## Disclaimer

HEIG-Kit is an independent project developed by students. It is not affiliated with, endorsed by or sponsored by HEIG-VD,
HES-SO, SWITCH or Anthropic. All product names, logos and trademarks are the property of their respective owners.

HEIG-Kit is provided "as is", without warranty of any kind, express or implied. The authors shall not be held liable for
any damage, data loss, account restriction or other consequence arising from its use. The information it displays may be
incomplete or outdated; the official platforms remain the sole authoritative source.

## License

[MIT](LICENSE). Installed third-party software (manim, TinyTeX, Docling, Ollama…) keeps its own license.
