# HEIG-Kit

Your HEIG-VD timetable, homework and courses, in the terminal and in [Claude Code](https://claude.com/claude-code):
an AI teacher that knows your course material, exports clean PDFs and animates mathematical concepts.

> HEIG-Kit is an independent student project, not affiliated with HEIG-VD, HES-SO or SWITCH. See [Disclaimer](#disclaimer).

## Modules

Install only what you need. Each module installs its own dependencies automatically, on macOS, Linux and Windows.

| Module | What you get | Installed for you |
|---|---|---|
| [`campus`](docs/campus.md) | Timetable (GAPS), deadlines and course contents (Cyberlearn), homework for a given day | — (asks for your edu-ID login) |
| [`knowledge`](docs/knowledge.md) | A local search engine over your course documents, and a teacher that explains, cites the course and writes exercises and practice exams | Docker, the services, the embedding model |
| [`documents`](docs/documents.md) | PDF, Word and HTML from Markdown, with LaTeX math, Mermaid diagrams and videos | Renderer, headless Chromium, pandoc |
| [`visuals`](docs/visuals.md) | Mathematical animations with [3b1b/manim](https://github.com/3b1b/manim), embeddable in documents | manim, Python, FFmpeg, LaTeX (TinyTeX) |
| [`shortcuts`](docs/shortcuts.md) | `heig:planning`, `heig:deadlines`… from any terminal | — |
| `claude` | The `heig:*` skills in Claude Code (and the knowledge base server) | — (needs Claude Code) |

## Installation

You need [Node.js](https://nodejs.org) 20 or later and [git](https://git-scm.com). On macOS, the setup uses
[Homebrew](https://brew.sh); on Windows, winget (built into Windows 10 and 11); on Linux, apt, dnf or pacman.

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git
cd HEIG-Kit
npm install
npm run setup -- campus knowledge documents claude   # the modules you want
```

- `npm run setup -- --all` installs every module.
- `npm run setup -- knowledge --ingest` also indexes your Cyberlearn courses now, then every day (a few hours the first
  time; only the courses of your GAPS timetable).
- `npm run setup -- --status` shows what is installed and working; `--dry-run` shows what would be installed.

## Usage

In Claude Code (after installing the `claude` module), just ask:

- *"show my planning"*, *"what homework do I have for Friday?"*, *"what are my deadlines?"*
- *"explique-moi les relations d'équivalence"*, *"génère-moi 5 exercices avec les corrigés"*, *"prépare-moi un TE blanc de
  MAD en PDF"*, *"montre-moi visuellement pourquoi…"*

Generated documents and videos go to `~/Documents/HEIG-Kit` and open automatically. Terminal commands are described in
each module's page.

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
- HEIG-Kit collects no telemetry and sends your data to no third party. When used through an AI assistant, what you ask
  is processed by that assistant according to its own terms and privacy policy.

## Acceptable use

By using HEIG-Kit, you agree to:

- use it only with your own account and for personal, non-commercial study purposes;
- comply with the IT usage policies of HEIG-VD and HES-SO and with the terms of use of the platforms accessed;
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
