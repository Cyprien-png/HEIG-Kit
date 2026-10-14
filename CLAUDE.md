# HEIG-Kit

TypeScript toolkit giving HEIG-VD students access to their own GAPS and Cyberlearn data, logging in through SWITCH edu-ID
with the credentials in `.env`. edu-ID two-step login (authenticator app) is supported, and the login session is saved in
`.cache/session.json` so codes are rarely needed.
The repository is also the `heig` Claude Code plugin (`.claude-plugin/`), each skill in `skills/<name>/SKILL.md`, invoked as `heig:<name>`.

## Answering questions about the user's planning, deadlines, courses or homework

Follow the `heig:planning` (`skills/planning/SKILL.md`), `heig:deadlines` (`skills/deadlines/SKILL.md`) and
`heig:courses` (`skills/courses/SKILL.md`) skills.
Never print or commit the content of `.env` or `.cache/`.

## Layout

- `src/http.ts`: cookie-aware session saved to disk between runs, and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow with two-step login codes, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login (reusing valid sessions, resuming a login waiting for a code) and iCalendar schedule export
- `src/cyberlearn/client.ts`: Cyberlearn Moodle web services, authenticated with the mobile app token obtained via edu-ID
- `src/cli.ts`: `schedule`, `deadlines`, `courses` and `course` commands, schedule cache, saved session and token, `--mfa-code` handling
- `src/deadlines.ts`: deadlines table rendering
- `src/courses.ts`: course list and course contents as text (HTML of labels and pages converted to text)
- `src/render.ts`: shared box-drawing grid and course colors
- `src/table.ts`: weekly timetable rendering
- `src/dates.ts`: Europe/Zurich date helpers
- `src/paths.ts`: project root, so the CLI runs from any directory
- `scripts/aliases.ts`: installs the `heig:*` terminal shortcuts (`heig-*` on Windows) in the user's shell configuration
- `skills/`: plugin skills; run `claude plugin validate .` after changing them or `.claude-plugin/`
