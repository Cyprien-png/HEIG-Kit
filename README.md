# HEIG-Kit

HEIG-Kit is an open-source toolkit and Claude Code plugin that allows students of HEIG-VD to access their own
academic information from the command line or through an AI assistant, using their personal SWITCH edu-ID account.

> HEIG-Kit is an independent student project. It is not affiliated with, endorsed by or sponsored by HEIG-VD,
> HES-SO or SWITCH. See [Disclaimer](#disclaimer).

## Features

| Feature | Source | Status |
|---|---|---|
| Personal timetable (weekly view, date ranges, JSON export) | GAPS | Available |
| Natural-language timetable assistant (`heig:planning`) | GAPS | Available |
| Course material synchronisation | Cyberlearn | Planned |
| Local knowledge base and study assistant (explanations, exercises, tailored course summaries) | Cyberlearn | Planned |

## Requirements

- Node.js 20 or later
- A SWITCH edu-ID account linked to HES-SO, with access to GAPS
- Multi-factor authentication **disabled** on that edu-ID account (see below)
- [Claude Code](https://claude.com/claude-code), only for the assistant features

## Installation

### 1. Install the toolkit

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git
cd HEIG-Kit
npm install
```

### 2. Configure your credentials

```sh
cp .env.example .env
```

Fill in `HEIG_EMAIL` and `HEIG_PASSWORD` in `.env` with your SWITCH edu-ID credentials. This file is excluded from version
control and must never be shared or committed.

### 3. Multi-factor authentication

> [!IMPORTANT]
> HEIG-Kit signs in to SWITCH edu-ID without user interaction and cannot complete a second authentication factor.
> Multi-factor authentication must therefore be **disabled** in the security settings of your
> [SWITCH edu-ID account](https://eduid.ch) for HEIG-Kit to connect.

Disabling multi-factor authentication reduces the protection of your account. By doing so you accept this risk. We
recommend using a strong, unique password and re-enabling multi-factor authentication when you no longer use HEIG-Kit.
If your institution enforces multi-factor authentication on your account, HEIG-Kit cannot be used.

### 4. Install the Claude Code plugin (optional)

The plugin uses the configuration and dependencies of your local copy, and must therefore be installed from it:

```sh
claude plugin marketplace add /path/to/HEIG-Kit
claude plugin install heig@heig-kit
```

To evaluate the plugin without installing it, start Claude Code with `claude --plugin-dir /path/to/HEIG-Kit`.

## Usage

### Command line

```sh
npm run schedule -- --table                         # current week as a colored timetable
npm run schedule -- --table --from 2026-11-02       # week containing a given date
npm run schedule                                    # next 7 days as a list
npm run schedule -- --from 2026-10-19 --to 2026-10-23
npm run schedule -- --all --json                    # full academic year in JSON format
npm run schedule -- --refresh                       # retrieve the latest data from GAPS
```

Run `npm run schedule -- --help` for the full list of options.

### Claude Code assistant

Once the plugin is installed, ask Claude Code about your timetable in natural language, for instance
*"show my planning"*, *"when is my next PRG lab?"* or *"am I free on Friday afternoon?"*, or invoke the skill explicitly
with `/heig:planning`. Ask for *"up-to-date"* information to bypass the local cache.

### Troubleshooting

If authentication fails, verify your credentials and multi-factor authentication settings, then run
`npm run schedule -- --refresh --debug`: the pages visited during authentication are saved to `.cache/debug/` for
inspection. These files may contain personal information and must not be shared publicly.

## Data handling and privacy

- Credentials are stored exclusively in your local `.env` file and are transmitted only to SWITCH edu-ID during
  authentication.
- Retrieved data is stored locally in the `.cache/` directory, which is excluded from version control. Timetable data
  is refreshed at most every 12 hours unless an update is explicitly requested.
- HEIG-Kit does not collect telemetry and does not transmit your data to any third party. When used through an AI
  assistant, the information you request is processed by that assistant according to its own terms and privacy policy.

## Acceptable use

By using HEIG-Kit, you agree to:

- use it only with your own account and for personal, non-commercial study purposes;
- comply with the IT usage policies of HEIG-VD and HES-SO and with the terms of use of the platforms accessed;
- refrain from redistributing course materials or any other content retrieved with HEIG-Kit, which remain the property of
  their respective authors and institutions;
- refrain from any use that could impair the availability or security of the platforms accessed.

## Disclaimer

HEIG-Kit is an independent project developed by students. It is not affiliated with, endorsed by or sponsored by HEIG-VD,
HES-SO, SWITCH or Anthropic. All product names, logos and trademarks are the property of their respective owners.

HEIG-Kit is provided "as is", without warranty of any kind, express or implied. The authors shall not be held liable for
any damage, data loss, account restriction or other consequence arising from its use. The information it displays may be
incomplete or outdated; the official platforms remain the sole authoritative source.

## License

No license has been granted yet. Until a license file is added to this repository, all rights are reserved by the authors.
