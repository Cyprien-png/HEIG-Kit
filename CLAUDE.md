# HEIG-dumper

TypeScript scraper for GAPS (HEIG-VD) and Cyberlearn (HES-SO), logging in through SWITCH edu-ID with the credentials in `.env`.

## Answering questions about the user's planning

1. Run `npm run -s schedule -- --all --json` to get every lesson of the academic year
   (served from `.cache/schedule.json` when it is less than 12 hours old; add `--refresh` if the user asks for fresh data).
   For a narrower window use `--from YYYY-MM-DD --to YYYY-MM-DD`.
2. Lesson times are ISO UTC timestamps: convert them to Europe/Zurich before answering.
3. Never print or commit the content of `.env`.

## Layout

- `src/http.ts`: cookie-aware session and HTML form parsing
- `src/auth/eduid.ts`: edu-ID SAML login flow, reusable for any HES-SO service provider
- `src/gaps/client.ts`: GAPS login and iCalendar schedule export
- `src/cli.ts`: `schedule` command and cache
