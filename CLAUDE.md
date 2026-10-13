# HEIG-Kit

TypeScript scraper for GAPS (HEIG-VD) and Cyberlearn (HES-SO), logging in through SWITCH edu-ID with the credentials in `.env`.
The repository is also the `heig` Claude Code plugin (`.claude-plugin/`), each skill in `skills/<name>/SKILL.md`, invoked as `heig:<name>`.

## Answering questions about the user's planning

Follow the `heig:planning` skill (`skills/planning/SKILL.md`). Never print or commit the content of `.env`.

## Layout

- `src/http.ts`: cookie-aware session and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login and iCalendar schedule export
- `src/cli.ts`: `schedule` command and cache
- `src/paths.ts`: project root, so the CLI runs from any directory
- `skills/`: plugin skills; run `claude plugin validate .` after changing them or `.claude-plugin/`
