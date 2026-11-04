# Remote server

Runs HEIG-Kit on a machine of yours as an MCP server, so that everything but the AI's reasoning happens there: GAPS and
Cyberlearn access, the knowledge base, documents and videos. It is for **one person**: one account, your edu-ID
credentials, your data.

## What protects what

| Risk | Protection |
|---|---|
| Someone calls the server | Every MCP request needs a signed JWT, obtained with the account of `.env`. Login attempts are limited (5 failures per client, 20 overall, per 15 minutes) |
| A token leaks | Change `HEIG_JWT_VERSION`: every token and link stops working |
| Traffic is read | Node only listens on `127.0.0.1`; the public address must be HTTPS, or the server refuses to start |
| Code written by the AI (a manim scene, HTML in a document) is malicious, for instance after reading a trapped course page | It runs in the `render` container: no network, no `.env`, no data, read-only system, no capabilities, memory and process limits, and a fresh container per job |
| The worker sends back something harmful | Only regular files with an expected name and type come back; links are refused |
| A download link leaks | It gives one file, for 15 minutes, and cannot be used as an access token |
| A browser page reaches the server (DNS rebinding) | Requests for another host name are refused |

Limits: whoever holds a valid token reads everything HEIG-Kit can read, including grades. Jobs share one folder, so a
malicious scene can read or alter another job *waiting in the queue* (never the secrets), or keep the worker busy until
its 45-minute limit. The edu-ID password stays in
clear in `.env`: protect the machine and keep `.env` readable by you only (`chmod 600 .env`).

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
```

In `.env`: `HEIG_AUTH_USERNAME`, `HEIG_AUTH_PASSWORD` (12 characters at least), `HEIG_JWT_SECRET`
(`openssl rand -hex 32`), `HEIG_PUBLIC_URL` and `HEIG_TRUST_PROXY=1`.

Check first, from the machine, that GAPS and edu-ID accept its address: `npm run schedule`. The first login may ask for a
two-step code: `npm run schedule -- --mfa-code 123456`.

Then HTTPS, for instance with [Caddy](https://caddyserver.com):

```
heig.example.org {
  reverse_proxy 127.0.0.1:8766
}
```

## The web application

The same address serves a web application ([app.md](app.md)): log in with the account of `.env` to see your
calendar (GAPS lessons, Cyberlearn deadlines, exams, with your own changes), grades, study plan, courses and documents,
the generated library, your flashcards, the corrections of your photographed work, your learning profile, and a status
page (services, edu-ID session with a reconnect button for the two-step code, syncs, ingestion, last requests). It
works on a phone as on a wide screen. The server fetches GAPS and Cyberlearn every `HEIG_SYNC_MINUTES` (60).

## Connect a client

A computer with its own HEIG-Kit installation uses the server for its knowledge base, calendar, flashcards, corrections
and library with `HEIG_REMOTE_URL=https://heig.example.org` in its `.env` and `npm run remote -- login`
(`npm run setup -- remote`): nothing to index on the computer, and `npm run library -- push|pull` syncs the generated
documents and videos. Any MCP client:

```sh
curl -s https://heig.example.org/auth/login -H 'Content-Type: application/json' \
  -d '{"username": "me", "password": "…"}'
# {"access_token":"…","token_type":"Bearer","expires_at":"…"}

claude mcp add --transport http heig-kit https://heig.example.org/mcp --header "Authorization: Bearer <access_token>"
```

The token lasts 90 days (`HEIG_JWT_DAYS`); log in again and update the client afterwards. This is a bearer token, so
clients that only support OAuth, such as web connectors, cannot use this server.

## Endpoints

| | |
|---|---|
| `GET /health` | No authentication; used by Docker |
| `POST /auth/login` | `{"username", "password"}`, gives the access token |
| `/mcp` | MCP over Streamable HTTP, `Authorization: Bearer <token>` |
| `GET /files?token=…` | Signed link given by `get_job` or `get_download_link` |
| `/api/*` | The web application's API ([app.md](app.md)): session cookie (`POST /api/auth/login`) or `Authorization: Bearer <token>` |
| `/` and every other path | The web application |

## What differs from a local installation

- `render_document` and `render_animation` return a job id, followed with `get_job`; results are download links.
- `open_generated` is replaced by `get_download_link`.
- Repository tools are absent: use `npm run repos` and `npm run ingest` on the machine (`git` must be able to read them).
- A PDF embedding a video shows its image, but its link points inside the worker: send the video link separately.
- Skills of the Claude Code plugin call the local command line: on another computer, use the MCP tools.
