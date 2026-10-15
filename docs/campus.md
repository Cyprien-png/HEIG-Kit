# GAPS and Cyberlearn (`campus` module)

From GAPS: your timetable and anyone's (student, teacher, room, class, course group), your grades and absences, your
study plan and the description of every unit and module. From Cyberlearn: your deadlines, course contents and homework.
In the terminal and in Claude Code.

## Setup

```sh
npm run setup -- campus
```

The setup asks for your SWITCH edu-ID email and password, saves them in `.env` (see
[How your credentials are used](../README.md#how-your-credentials-are-used)) and checks the login by downloading your
timetable.

## Two-step login (MFA)

SWITCH edu-ID two-step login with an authenticator app is supported. Codes are requested only when needed:

- **In a terminal**, HEIG-Kit prompts for the current code of your authenticator app.
- **Through an AI assistant or any non-interactive environment**, the command stops with exit code `2` and the message
  *"edu-ID two-step login code required"*. Rerun it with `--mfa-code <code>` to complete the pending login; the Claude
  Code skills ask you for the code automatically.

After a successful login, the session is saved and edu-ID remembers the device, so that codes are rarely needed
(typically every few weeks). Passkeys and hardware security keys are not supported.

## Commands

```sh
npm run schedule -- --table                   # current week as a timetable
npm run schedule -- --table --from 2026-11-02 # week containing a date
npm run schedule -- --from 2026-10-19 --to 2026-10-23
npm run schedule -- --refresh                 # latest data from GAPS (otherwise cached for 12 hours)
npm run schedule -- --who C23 --table         # someone else's schedule: a room, a class (HE41), a teacher
npm run schedule -- --who "Dupont Marie"      #   (acronym, e.g. JHH), a student or a course group (MAD-E)
npm run gaps -- find dupont                   # find the exact name of a student, teacher, room or class
npm run gaps -- plan                          # study plan of the year: modules, units, credits, status (--all)
npm run gaps -- unit MAD                      # unit sheet: objectives, content, assessment, bibliography…
npm run gaps -- module MAI1                   # module sheet: units, credits, how the grade is computed
npm run gaps -- grades                        # continuous assessment grades and transcript
npm run gaps -- absences                      # absences per unit
npm run deadlines                             # Cyberlearn activities still to do, overdue ones included
npm run deadlines -- --days 7                 # due within 7 days
npm run courses                               # your Cyberlearn courses
npm run course -- MAD                         # a course's content as text (timetable code, id or name)
```

Add `--json` for machine-readable output. `npm run schedule -- --help` lists every option.

## In Claude Code

| Skill | Ask for instance |
|---|---|
| `heig:planning` | *"show my planning"*, *"when is my next PRG lab?"*, *"what's the schedule of room C23?"* |
| `heig:grades` | *"what are my grades?"*, *"my RXI average?"*, *"how many absences in PRG?"* |
| `heig:studies` | *"show me the MAD sheet"*, *"which units are in MAI1?"*, *"how many credits this year?"* |
| `heig:deadlines` | *"what are my deadlines?"*, *"what's due this week?"* |
| `heig:courses` | *"what homework do I have for Friday?"*, *"what MAD exercises did we do yesterday?"* |

`heig:courses` combines your lessons of the day, the planning published by each teacher on Cyberlearn (whether they
list exercises "to do for next time" or on the day they are started) and your pending submissions.

## Troubleshooting

If authentication fails, check your credentials, delete `.cache/session.json` to start a new session, then run
`npm run schedule -- --refresh --debug`: the pages visited during authentication are saved to `.cache/debug/` for
inspection. These files may contain personal information and must not be shared.
