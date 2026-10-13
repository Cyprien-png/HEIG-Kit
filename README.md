# HEIG-dumper

Auto-login and scraping tool for the HEIG-VD / HES-SO student platforms:

- [GAPS](https://gaps.heig-vd.ch/consultation/horaires/): schedule (supported)
- [Cyberlearn](https://cyberlearn.hes-so.ch/my/courses.php): courses (planned)

Both platforms log in through SWITCH edu-ID, so a single email + password is enough.

## Setup

Requires Node.js 20+.

```sh
npm install
cp .env.example .env   # then fill in HEIG_EMAIL and HEIG_PASSWORD
```

Accounts with edu-ID two-factor authentication enabled are not supported yet.

## Usage

```sh
npm run schedule                                    # next 7 days
npm run schedule -- --from 2026-10-19 --to 2026-10-23
npm run schedule -- --all --json                    # whole academic year as JSON
npm run schedule -- --refresh                       # bypass the 12h cache
```

The schedule is cached in `.cache/schedule.json`. If the login fails, rerun with
`--debug` and inspect the pages saved in `.cache/debug/`.
