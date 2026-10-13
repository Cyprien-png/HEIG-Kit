# HEIG-Kit

TypeScript toolkit giving HEIG-VD students access to their own GAPS (and later Cyberlearn) data, logging in through SWITCH edu-ID
with the credentials in `.env`. edu-ID two-step login (authenticator app) is supported, and the login session is saved in
`.cache/session.json` so codes are rarely needed.
The repository is also the `heig` Claude Code plugin (`.claude-plugin/`), each skill in `skills/<name>/SKILL.md`, invoked as `heig:<name>`.

## Answering questions about the user's planning

Follow the `heig:planning` skill (`skills/planning/SKILL.md`). Never print or commit the content of `.env`.

## Layout

- `src/http.ts`: cookie-aware session saved to disk between runs, and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow with two-step login codes, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login (reusing valid sessions, resuming a login waiting for a code) and iCalendar schedule export
- `src/cli.ts`: `schedule` command, schedule cache, saved session and `--mfa-code` handling
- `src/table.ts`: weekly timetable rendering (ANSI, emoji or plain)
- `src/dates.ts`: Europe/Zurich date helpers
- `src/paths.ts`: project root, so the CLI runs from any directory
- `skills/`: plugin skills; run `claude plugin validate .` after changing them or `.claude-plugin/`
