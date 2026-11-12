# Accounts of a shared server

A [remote server](server.md) serves a whole class: one account per person, each with its own edu-ID connection. The
server is not open: nobody creates an account over the network.

## What is shared, what is not

| Shared with every account (each item keeps its author) | Personal, closed to the others |
|---|---|
| The indexed course material (knowledge base), past written tests | Timetable, calendars and their events, deadlines |
| The library: generated documents and videos | Grades, absences, study plan, profile and its notes |
| Flashcard decks and their cards | Corrections, their photos, work copies |
| Quizzes and their questions | Study progress on the cards, quiz attempts and scores |
| | The edu-ID session and credentials, the rendering jobs |

- A shared item is **changed only by its author or an administrator**, and **deleted only by an administrator**, its
  author included (a deck, a card, a quiz, a document or a video): a deletion takes it, and the progress made on it,
  away from the whole class. Everyone else gets `403`; the database enforces it too (`019_admin_delete.sql`). Personal
  things (calendar events, corrections, profile notes) stay deletable by their owner.
- **A similar item is never created twice.** Creating a deck, a quiz, a document or a video close to an existing one is
  refused (`409`, with the list of similar items). The call is accepted only with `checked` (the references of the
  items that were read) and `new_because` (what is needed that each of them lacks). The MCP instructions and the skills
  order agents to list what exists first; the web app shows the similar decks and asks to confirm.
- **The past written tests and the GitHub repositories of courses are the administrators' alone**: everyone reads
  the tests and searches the indexed repositories, only an administrator adds, changes or deletes a test file, and
  adds, removes or refreshes a repository (they are read with the server's own git token). Everyone else gets `403`.
- The lists (`list_library`, `list_decks`, `list_quizzes`, and the pages of the web app) have a "created by me" filter.

## How accounts are kept apart

Every request runs as the account named **inside its signed token** (`sub`), and nothing in a request can name another
one: no tool, route or parameter takes a user id. Behind that, each connection to the database carries the account of
the request and PostgreSQL row level security (`rag/migrations/016_accounts.sql`) filters every personal table, so a
query that forgot its `WHERE` still returns nothing of someone else. A token of a disabled, deleted or reset account,
or one issued before its password changed, is refused (`401`). An agent that tries the credentials or the token of
another student gets a plain error.

## Managing accounts: on the server only

There is no administration page for accounts on purpose: it is a command of the machine, run in the HEIG-Kit folder.

```sh
npm run users -- add prenom.nom@heig-vd.ch              # names read from the address
npm run users -- add j.dupont@heig-vd.ch --first-name Jeanne --last-name Dupont --role admin
npm run users -- list
npm run users -- set <account> [--email …] [--first-name …] [--last-name …] [--role admin|student]
npm run users -- role <account> admin|student
npm run users -- reset <account>          # new first password; tokens revoked, sealed edu-ID credentials dropped
npm run users -- disable <account>        # and enable
npm run users -- delete <account> --yes   # the account and everything personal; what it shared stays
```

`<account>` is an address or the number shown by `list`. `add` and `reset` print a random password of 18 characters
**once**: give it through a private channel. The first account is an administrator and takes over the data of a
former single-user server.

## First login

1. The person logs in with the address and the password they received, and **must read and accept the conditions of
   use** (box « J'ai lu et j'accepte les conditions d'utilisation »). The text is `src/accounts/terms.ts`: the server
   only runs the code published on GitHub, everything is open source, how passwords and credentials are protected
   (Argon2id, HKDF-SHA-256, AES-256-GCM), why an administrator cannot enter an account and where that stops (whoever
   hosts the machine), shared content and prompt injection, no liability. Only the person accepts, in a browser: the
   token of an agent or of the CLI is refused. Changing the text means changing `TERMS_VERSION`, and every account is
   asked again at its next request. The page « Mon compte » shows the text at any time.
2. They then **must choose a new password** (12 characters at least).
3. The server then **asks for their edu-ID credentials**, tries them on GAPS at once, and asks for the two-step code
   if edu-ID wants one. Nothing is stored before GAPS accepted the login.

Until all three are done the server refuses everything else for this account (`403` with `setup`), on the web app, the
API and MCP alike; an application waiting for an authorization (Claude, the CLI) is sent through the same steps.

## Passwords and edu-ID credentials

- Passwords: Argon2id (64 MiB, 3 passes); the database holds a verifier only. Login attempts are limited (5 failures per client,
  20 overall, per 15 minutes).
- edu-ID credentials are **sealed with a key derived from the account's password** (AES-256-GCM) and that key is never
  stored by the server. The API only writes them; no route returns them.
- **The key travels in the account's own tokens**, encrypted for the server alone (a key derived from
  `HEIG_JWT_SECRET`): the session cookie, the access tokens and the refresh tokens of OAuth carry it; the database
  keeps only the hash of a refresh token. Opening someone's credentials therefore takes three things together: the
  database, the server's secret, and a token that person holds. A copy of the database, or of the database and `.env`,
  opens nothing; a token alone neither.
- So any request of the account (the web app, an agent, the CLI) lets the server read its credentials for a moment
  (kept in memory 15 minutes): when the edu-ID *session* (cookies in `.cache/users/<id>/`, a few weeks) has ended, the
  server **logs in again by itself** at the account's next request, without asking anything. Only when edu-ID wants a
  two-step code does the account show "edu-ID à reconnecter", for the code to be typed on the page **Mon compte**.
  Automatic logins are tried at most every 30 minutes, and not again for 12 hours once a code is asked.
- **Logging out ends every session of the account**: this browser, the others, the agents and the CLI all have to log
  in again, so a token copied somewhere dies with the rest.
- **What the server keeps on its disk to act for an account is encrypted**: the cookies of the edu-ID session, the
  Cyberlearn token (which works like a password and does not expire), a login waiting for its code and the cached
  timetable, in `.cache/users/<id>/`, with a key derived from `HEIG_JWT_SECRET` (AES-256-GCM, `src/secretfile.ts`). A
  copy or a backup of `.cache` gives nothing without `.env`; whoever has both, or the running server, reads them. This
  key is the server's and not each person's, so that syncs keep running while nobody is connected. Files written
  before are encrypted the first time they are read. Changing `HEIG_JWT_SECRET` makes them unreadable: every account
  then reconnects edu-ID once.
- While nobody uses an account, the server holds no way to its credentials: background syncs then stop with the edu-ID
  session and resume at the next request. Changing the password re-seals the credentials and revokes the tokens; a
  `reset` by the administrator drops them.
- Whoever controls the running server (its administrator, on the machine) can observe the tokens that reach it, hence
  the credentials of the accounts that use it meanwhile: the sealing protects against leaks of the stored data and
  against the other accounts, not against the machine's owner.

## Roles

`student`, or `admin`, who also sees the **status page** of the server (and starts the indexation of the courses there), the **journal** (the accounts, and for each
one the latest requests: time, action, route or tool, answer; never their content; kept 30 days), may change or delete
any shared item, is the only one who deletes them, manages the past written tests and the course repositories, and
runs the housekeeping. Roles are set with `npm run users`.

## Housekeeping

`npm run housekeeping` (daily on a running server; `-- --dry-run` to see, `--after <days>`; MCP `run_housekeeping`
and `POST /api/admin/housekeeping` for administrators) compresses the photos of corrections finished for 3 days
(2000 px, JPEG, without their metadata), and removes what nobody will read again: old journals, finished jobs,
abandoned captures, expired tokens, files of interrupted uploads.

## Limits to know

- No edu-ID credentials live in `.env`. The course material is indexed by the server itself, as an administrator:
  **Indexer mes cours** on the status page (MCP `run_ingestion`, `npm run remote -- ingest`) reads Cyberlearn with
  the edu-ID connection of the administrator who asks, and the server does it again on its own when it sees Cyberlearn
  change, with the saved session of its first administrator. The shared knowledge base thus covers the courses of the
  **administrators'** timetables (plus `RAG_EXTRA_COURSES`); an administrator of another class adds theirs by
  indexing too.
- Deleting a shared deck or quiz removes the progress of everyone who studied it, which is why only administrators
  delete.
- Syncs with GAPS and Cyberlearn run one account at a time.
- The administrator of the machine can read the personal data in the database (not the edu-ID credentials): row level
  security protects accounts from each other, not from whoever owns the server.
