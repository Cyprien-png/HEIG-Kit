---
name: calendar
description: Manages the user's HEIG-Kit calendar, which merges GAPS lessons (with the programme announced on Cyberlearn), Cyberlearn deadlines, exams and events kept on the server, in calendars (layers) the user shows or hides. Shows what is coming, adds or moves an exam, a deadline or an event, removes one, overrides a date a teacher did not update on Cyberlearn, creates a calendar such as a revision plan before an exam ("fais-moi un calendrier de révision MAD pour le TE de lundi"). Use whenever the user asks to add, change, move or remove a date, a deadline, an exam ("ajoute le TE de MAD le 5 décembre", "la deadline du labo est repoussée à vendredi", "enlève cet événement"), asks what is on their calendar / agenda, or wants a revision schedule.
---

# Calendar

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). The
calendar lives on the remote server (`HEIG_REMOTE_URL`) or in the local database. For the timetable alone, prefer
`heig:planning`; for Cyberlearn's own deadline list, `heig:deadlines`. Prefer the MCP tools when available
(`get_calendar`, `set_calendar_event`, `remove_calendar_event`, `list_calendars`, `set_calendar`, `remove_calendar`);
the commands below do the same.

## Calendars (layers)

Every event belongs to a calendar. Built in: **Horaires** (GAPS lessons; each lesson's details hold the programme its
course page announces for that day, and a lesson announced as an evaluation becomes an exam), **Examens**, **Rendus**
(Cyberlearn). The user's own calendars hold revision plans and anything else; the web app shows or hides each one.

- `npm --prefix <root> run -s calendar -- calendars`: the calendars with their id, color and visibility.
- `calendar -- calendars add "Révision MAD" [--color #7c3aed] [--description "TE 1 du 9 novembre"]`
- `calendar -- calendars set <id> [--name …] [--color …] [--visible false]`; `calendar -- calendars remove <id>`
  (deletes its events; built-in calendars can only be hidden).

## Events

- `npm --prefix <root> run -s calendar -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--kind exam|deadline|lesson|event] [--course MAD] [--calendar <id|name>]`:
  events (default: the next 14 days), each with its **key**; `calendar -- show <key>` adds the details.
- `calendar -- add "<title>" <start> [--end <end>] [--kind exam] [--course <CODE>] [--location <room>] [--details …] [--all-day] [--calendar <id|name>]`:
  a new event. Times without offset are Swiss local time: `2026-12-05T08:30`. Details are Markdown.
- `calendar -- set <key> [--title …] [--start …] [--end …] [--location …] [--kind …] [--calendar …]`: change an event,
  including a GAPS or Cyberlearn one (e.g. a postponed deadline). The change stays until the source changes again
  after it.
- `calendar -- remove <key>`: remove an event (hidden until its source changes again).
- `calendar -- reset <key>`: forget the manual changes of a source event; `calendar -- history <key>`: every version;
  `calendar -- overrides`: the source events changed by hand.
- `calendar -- import <plan.json>`: a calendar and its events in one go:
  `{"calendar": {"name": "Révision MAD", "description": "…"}, "events": [{"title": "…", "course": "MAD", "start": "2026-11-05T18:00", "end": "2026-11-05T19:30", "details": "markdown"}]}`
  (`"calendar": "<id|name>"` adds to an existing one).

## Revision plans

When the user wants to prepare an exam:

1. Find the exam (`calendar -- --kind exam`, the course page with `heig:courses`) and what it covers: the planning
   on the course page lists the topics and exercises of each lesson; `heig:teacher` (`kb -- documents <COURSE>`,
   `kb -- search`) gives the chapters, exercise sheets and past exams; `heig:profile` the user's weak points.
2. Create one calendar per exam ("Révision MAD · TE 1") and one event per session in the user's free slots (check the
   timetable: no session during a lesson), from the next day to the eve of the exam, 60 to 120 minutes each. Each
   event's details (Markdown) say what to revise and the exercises to do, by number as the course numbers them, the
   past exams to try, and the flashcard decks (`heig:flashcards`) to review. Order: notions first, exercises next,
   past exams last, and keep the eve light.
3. Say which calendar was created and that it can be hidden or edited on the web app's calendar page.

## Answering

- Before changing a Cyberlearn or GAPS event, show it (key, current date) and confirm what the user wants.
- Exams: `--kind exam`; the exam dates teachers announce are on the course pages (`heig:courses`): offer to add them.
- Always answer with the dates as the user would say them (jeudi 5 décembre, 8h30) and say the calendar on the web
  app shows the change.
