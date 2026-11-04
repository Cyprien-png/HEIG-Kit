---
name: calendar
description: Manages the user's HEIG-Kit calendar, which merges GAPS lessons, Cyberlearn deadlines, exams and events kept on the server: shows what is coming, adds or moves an exam, a deadline or an event, removes one, and overrides a date a teacher did not update on Cyberlearn. Use whenever the user asks to add, change, move or remove a date, a deadline, an exam ("ajoute le TE de MAD le 5 décembre", "la deadline du labo est repoussée à vendredi", "enlève cet événement"), or asks what is on their calendar / agenda.
---

# Calendar

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). The
calendar lives on the remote server (`HEIG_REMOTE_URL`) or in the local database. For the timetable alone, prefer
`heig:planning`; for Cyberlearn's own deadline list, `heig:deadlines`.

## Commands

- `npm --prefix <root> run -s calendar -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--kind exam|deadline|lesson|event] [--course MAD]`:
  events (default: the next 14 days), each with its **key**.
- `calendar -- add "<title>" <start> [--end <end>] [--kind exam] [--course <CODE>] [--location <room>] [--details …] [--all-day]`:
  a new event. Times without offset are Swiss local time: `2026-12-05T08:30`.
- `calendar -- set <key> [--title …] [--start …] [--end …] [--location …] [--kind …]`: change an event, including a
  GAPS or Cyberlearn one (e.g. a postponed deadline). The change stays until the source changes again after it.
- `calendar -- remove <key>`: remove an event (hidden until its source changes again).
- `calendar -- reset <key>`: forget the manual changes of a source event; `calendar -- history <key>`: every version;
  `calendar -- overrides`: the source events changed by hand.

## Answering

- Before changing a Cyberlearn or GAPS event, show it (key, current date) and confirm what the user wants.
- Exams: `--kind exam`; the exam dates teachers announce are on the course pages (`heig:courses`): offer to add them.
- Always answer with the dates as the user would say them (jeudi 5 décembre, 8h30) and say the calendar on the web
  app shows the change.
