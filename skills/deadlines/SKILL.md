---
name: deadlines
description: Answer questions about the user's HEIG-VD / HES-SO homework and deadlines on Cyberlearn (Moodle): assignments to submit, quizzes or lab report forms to complete, overdue work. Use whenever the user asks about homework, deadlines, "devoirs", "rendus", what is due, or what they still have to submit, e.g. "what are my deadlines?", "do I have homework for RXI?", "what's due this week?".
---

# Deadlines

1. Fetch the activities still to do with the plugin's CLI. `<root>` is the plugin root, two levels above this skill's
   base directory (the folder holding `package.json`); the commands work from any current directory:
   - `npm --prefix <root> run -s deadlines -- --color emoji` for the table of everything pending
   - `npm --prefix <root> run -s deadlines -- --days N --color emoji` to limit to what is due within N days
     (e.g. "this week" → days until Sunday, "tomorrow" → 1)
   - `npm --prefix <root> run -s deadlines -- --json` when you need details (full course name, Moodle URL, expected action)
   Data is always live: there is no cache to refresh.
2. The list comes from the Cyberlearn timeline: it only contains activities the user still has to act on.
   Submitted or completed work does not appear; "overdue" items were not submitted (overdue ones stay listed 30 days).
3. Default view: when the user asks generally ("my deadlines", "my homework", or just invoking this skill), reply with the
   table output verbatim inside a ```text code block, followed by at most one or two short lines: overdue items first,
   then what is due soonest. Chat replies cannot render ANSI colors, so always use `--color emoji`.
4. Specific questions (a course, a date, "is X due?"): answer concisely with the activity, course, due date and time,
   and the link from `--json` when useful. Resolve relative dates from today's date in Europe/Zurich.
5. This list only covers what must be submitted on Cyberlearn. For exercises to prepare for a lesson ("homework for
   Friday"), use the `heig:courses` skill, which combines the timetable, course plannings and these deadlines.
6. Course codes and colors match the `heig:planning` timetable (e.g. `RXI`, `SYL`), so both can be combined, e.g.
   "what do I need to prepare before Friday's RXI lab?".
7. If the command exits with "edu-ID two-step login code required" (exit code 2), ask the user for the current 6-digit
   code of their authenticator app, then rerun the same command with `--mfa-code <code>` added.
8. If the command fails on login otherwise, report the error and suggest `npm --prefix <root> run deadlines -- --debug`.
   If it reports missing credentials, ask the user to fill `<root>/.env` (see `<root>/.env.example`). Never print `.env`
   nor the content of `<root>/.cache/`.
