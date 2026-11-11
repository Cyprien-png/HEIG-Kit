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

1. The person logs in with the address and the password they received, and **must choose a new password** (12
   characters at least).
2. The server then **asks for their edu-ID credentials**, tries them on GAPS at once, and asks for the two-step code
   if edu-ID wants one. Nothing is stored before GAPS accepted the login.

Until both are done the server refuses everything else for this account (`403` with `setup`), on the web app, the API
and MCP alike; an application waiting for an authorization (Claude, the CLI) is sent through the same two steps.

## Passwords and edu-ID credentials

- Passwords: Argon2id (64 MiB, 3 passes); the database holds a verifier only. Login attempts are limited (5 failures per client,
  20 overall, per 15 minutes).
- edu-ID credentials are **sealed with a key derived from the account's password** (AES-256-GCM) and that key is never
  stored: the database, a backup, or the administrator cannot read them. The API only writes them; no route returns
  them. The key stays in the server's memory for 30 minutes after the person typed their password.
- Consequence: the server keeps the edu-ID *session* (cookies, a few weeks) of each account in `.cache/users/<id>/`
  to fetch GAPS and Cyberlearn. When it ends, the account shows "edu-ID à reconnecter": the person types their
  HEIG-Kit password on the page **Mon compte** (and the two-step code if asked). Changing the password re-seals the
  credentials; a `reset` by the administrator drops them.

## Roles

`student`, or `admin`, who also sees the **status page** of the server, the **journal** (the accounts, and for each
one the latest requests: time, action, route or tool, answer; never their content; kept 30 days), may change or delete
any shared item, is the only one who deletes them, and runs the housekeeping. Roles are set with `npm run users`.

## Housekeeping

`npm run housekeeping` (daily on a running server; `-- --dry-run` to see, `--after <days>`; MCP `run_housekeeping`
and `POST /api/admin/housekeeping` for administrators) compresses the photos of corrections finished for 3 days
(2000 px, JPEG, without their metadata), and removes what nobody will read again: old journals, finished jobs,
abandoned captures, expired tokens, files of interrupted uploads.

## Limits to know

- The course material is indexed by `npm run ingest` on the machine with the edu-ID account of `.env`: the shared
  knowledge base covers the courses of **that** account (plus `RAG_EXTRA_COURSES`).
- Deleting a shared deck or quiz removes the progress of everyone who studied it, which is why only administrators
  delete.
- Syncs with GAPS and Cyberlearn run one account at a time.
- The administrator of the machine can read the personal data in the database (not the edu-ID credentials): row level
  security protects accounts from each other, not from whoever owns the server.
