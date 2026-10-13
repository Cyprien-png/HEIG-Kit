# HEIG-Kit

Auto-login and scraping tool for the HEIG-VD / HES-SO student platforms:

- [GAPS](https://gaps.heig-vd.ch/consultation/horaires/): schedule (supported)
- [Cyberlearn](https://cyberlearn.hes-so.ch/my/courses.php): courses (planned)

Both platforms log in through SWITCH edu-ID, so a single email + password is enough.

The repository is also a Claude Code plugin named `heig`, whose skills answer questions in natural language:

- `heig:planning`: "what do I have tomorrow?", "when is my next PRG lab?"

## Setup

Requires Node.js 20+.

```sh
npm install
cp .env.example .env   # then fill in HEIG_EMAIL and HEIG_PASSWORD
```

Accounts with edu-ID two-factor authentication enabled are not supported yet.

## Install the Claude Code plugin

The plugin reads `.env` and `node_modules` from this folder, so install it from the local clone
(edits to the folder are picked up with `/reload-plugins`, no reinstall needed):

```sh
claude plugin marketplace add /path/to/HEIG-Kit
claude plugin install heig@heig-kit
```

To try it without installing: `claude --plugin-dir /path/to/HEIG-Kit`.

## CLI usage

```sh
npm run schedule                                    # next 7 days
npm run schedule -- --from 2026-10-19 --to 2026-10-23
npm run schedule -- --all --json                    # whole academic year as JSON
npm run schedule -- --refresh                       # bypass the 12h cache
```

The schedule is cached in `.cache/schedule.json`. If the login fails, rerun with
`--debug` and inspect the pages saved in `.cache/debug/`.
