# Remote server

Runs HEIG-Kit on a machine of yours as an MCP server, so that everything but the AI's reasoning happens there: GAPS and
Cyberlearn access, the knowledge base, documents and videos. It serves **several people**, a class for instance: one
account each, created by you on the machine, each with its own edu-ID connection. Course material, library, decks and
quizzes are shared; everything personal is closed: [accounts.md](accounts.md).

## What protects what

| Risk | Protection |
|---|---|
| Someone calls the server | Every request needs a signed token of an account, obtained through OAuth 2.1 (authorization code with PKCE) after a login. Accounts only exist if you created them. Login attempts are limited (5 failures per client, 20 overall, per 15 minutes) |
| An account (or its agent) goes after another one's data | The account is the one named in the token; no request can name another. Row level security in the database filters every personal table |
| A token leaks | `npm run users -- reset <account>` (or a password change) revokes the tokens of that account; `HEIG_JWT_VERSION` revokes everyone's |
| The database or a backup leaks | Passwords are Argon2id verifiers; edu-ID credentials are sealed with a key derived from each password and never stored |
| Traffic is read | Node only listens on `127.0.0.1`; the public address must be HTTPS, or the server refuses to start |
| Code written by the AI (a manim scene, HTML in a document) is malicious, for instance after reading a trapped course page | It runs in the `render` container: no network, no `.env`, no data, read-only system, no capabilities, memory and process limits, and a fresh container per job |
| The worker sends back something harmful | Only regular files with an expected name and type come back; links are refused |
| A download link leaks | It gives one file, for 15 minutes, and cannot be used as an access token |
| A browser page reaches the server (DNS rebinding) | Requests for another host name are refused |

Limits: whoever holds a valid token reads everything of **its** account, including grades. Jobs share one folder, so a
malicious scene can read or alter another job *waiting in the queue* (never the secrets), or keep the worker busy until
its 45-minute limit (6 jobs at most, 2 per account). The edu-ID password of `.env` (used by `npm run ingest`) stays in
clear: protect the machine and keep `.env` readable by you only (`chmod 600 .env`).

## Install

Step by step on Debian: [install-debian.md](install-debian.md). In short, it needs Docker, Node.js 22, about 8 GB of
RAM and 15 GB of disk (estimate). `server:start` downloads the `server` and `render` images published by GitHub Actions
on `ghcr.io` (`npm run server:build` builds them locally instead); `npm run server:update` updates everything.

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git && cd HEIG-Kit
npm install
cp .env.example .env && chmod 600 .env    # edu-ID credentials, then the "Remote server" section
mkdir -p data .cache && sudo chown -R 1000:1000 data .cache    # the container's user, Linux only
npm run rag:start                         # database and embedding model
npm run ingest                            # indexes the courses, on the machine itself
npm run server:start
npm run users -- add prenom.nom@heig-vd.ch    # the first account, an administrator; prints its first password once
```

In `.env`: `HEIG_JWT_SECRET` (`openssl rand -hex 32`), `HEIG_PUBLIC_URL` and `HEIG_TRUST_PROXY=1`. The edu-ID
credentials of `.env` only serve `npm run ingest`, which builds the shared knowledge base from the courses of that
account. Each person then logs in, replaces their password and connects their own edu-ID
([accounts.md](accounts.md)).

Check first, from the machine, that GAPS and edu-ID accept its address: `npm run schedule`. The first login may ask for a
two-step code: `npm run schedule -- --mfa-code 123456`.

Then HTTPS in front of it. The server is published on `127.0.0.1:8766` for a reverse proxy on the same machine, for
instance [Caddy](https://caddyserver.com):

```
heig.example.org {
  reverse_proxy 127.0.0.1:8766
}
```

With a reverse proxy elsewhere on your network (which already holds the certificate), publish the server on the
network instead: `echo HEIG_BIND=0.0.0.0 > rag/.env`, then `npm run server:start` again, and point the proxy to
`http://<machine>:8766`, forwarding the `Host` header unchanged (the server refuses other host names).

## The web application

The same address serves a web application ([app.md](app.md)): log in with your account to see your calendar (GAPS
lessons, Cyberlearn deadlines, exams, with your own changes), grades, study plan, courses and documents, the shared
library, decks and quizzes, the corrections of your photographed work, your learning profile and your account (password,
edu-ID connection). Administrators also get a status page (services, syncs, ingestion, last requests) and the journal
of the accounts. It works on a phone as on a wide screen. The server fetches GAPS and Cyberlearn for each account every
`HEIG_SYNC_MINUTES` (60).

## Connect a client

A computer with its own HEIG-Kit installation uses the server for its knowledge base, calendar, flashcards, corrections
and library with `HEIG_REMOTE_URL=https://heig.example.org` in its `.env` and `npm run remote -- login`
(`npm run setup -- remote`): nothing to index on the computer, and `npm run library -- push|pull` syncs the generated
documents and videos. `remote -- login` opens the browser on the server's login page and receives the token on a local
port; nothing is typed in the terminal.

Every client gets its token the same way, from the server's own OAuth 2.1 authorization server
(`src/server/oauth.ts`: metadata discovery, dynamic client registration, authorization code with PKCE, refresh tokens);
there is no endpoint that trades a password for a token.

```sh
claude mcp add --transport http heig-kit https://heig.example.org/mcp    # then /mcp → Authenticate
```

On claude.ai: Settings → Connectors → Add custom connector with `https://heig.example.org/mcp`; the connector then
appears in the phone app too. The login page asks for the account's address and password, then shows which
application asks for access. Access tokens last 7 days and are renewed with a refresh token (`HEIG_JWT_DAYS`, 90);
each token names its account, and a password change or a `reset` revokes those of that account.

## Endpoints

| | |
|---|---|
| `GET /health` | No authentication; used by Docker |
| `/mcp` | MCP over Streamable HTTP, `Authorization: Bearer <token>`; the tools run as the account of the token |
| `/.well-known/oauth-*`, `/oauth/register`, `/oauth/authorize`, `/oauth/token` | OAuth 2.1 (metadata, dynamic registration, login and consent page with PKCE, tokens) for every client |
| `GET /files?token=…` | Signed link given by `get_job` or `get_download_link` |
| `/api/*` | The web application's API ([app.md](app.md)): session cookie (`POST /api/auth/login`) or `Authorization: Bearer <token>`; `/api/status*` and `/api/admin/*` for administrators only |
| `/` and every other path | The web application |

## Moving a single-user server to accounts

Remove `HEIG_AUTH_USERNAME` and `HEIG_AUTH_PASSWORD` from `.env`, update (`npm run server:update`), then
`npm run users -- add <your address>`: this first account is an administrator and takes over the calendar, cards,
corrections, profile and library already there. Every client logs in again (`npm run remote -- login`, the connector
of claude.ai, `/mcp` in Claude Code), and you connect your edu-ID on the web application.

## What differs from a local installation

- `render_document` and `render_animation` return a job id, followed with `get_job`; results are download links.
- `open_generated` is replaced by `get_download_link`.
- The GitHub repositories of courses (`add_course_repo`, `update_course_repos`, `npm run repos` from a computer with
  `HEIG_REMOTE_URL`, the GitHub row of the status page) are fetched and indexed by the server itself, every sync and on
  demand, with the token `HEIG_GITHUB_TOKEN` of `.env` (its container has no git account). Their PDFs and DOCX wait for
  the extraction service, which the daily `npm run ingest` on the machine starts; code, Markdown and text are indexed at
  once.
- A PDF embedding a video shows its image, but its link points inside the worker: send the video link separately.
- Skills of the Claude Code plugin call the local command line: on another computer, use the MCP tools.
