---
name: courses
description: Answer questions about the content of the user's HEIG-VD courses on Cyberlearn (Moodle) and about the exercises and homework to prepare for a given day or lesson. Use whenever the user asks what was done or is planned in a course, which exercises to do, what homework they have for a day ("what homework do I have for Friday?", "qu'est-ce que je dois faire pour lundi ?", "what MAD exercises did we do yesterday?"), or about course material (slides, exercise sheets, lab instructions, written exam dates).
---

# Courses and homework

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`); the
commands work from any current directory. All Cyberlearn data is live (no cache).

## Commands

- `npm --prefix <root> run -s courses`: the user's Cyberlearn courses, with the timetable code (e.g. `MAD`) in front.
- `npm --prefix <root> run -s course -- <CODE>`: the whole course as text: sections, plannings and announcements written
  in labels and pages, resources (files with their upload date), quizzes and assignments with their dates. `<CODE>` is a
  timetable code, a course id or part of the course name.
- `npm --prefix <root> run -s schedule -- --from YYYY-MM-DD --to YYYY-MM-DD`: lessons of a period (see `heig:planning`).
- `npm --prefix <root> run -s deadlines -- --json`: Cyberlearn activities still to submit (see `heig:deadlines`).

## The user's class and group

GAPS lesson codes are `<COURSE>-<CLASS>-<TYPE><N>` (e.g. `MAD-E-C3`, `SYL-F-L1`, `SYL-EF-C1` for classes E and F
together). Course pages often address several classes or groups ("Groupe A et B", "MAD-E", "Labo B"): only keep what
applies to the user's class letter(s) for that course. RXI-style tables list lab dates per lab group; match the lab
dates with the user's actual lab days in the timetable.

## Homework for a given day

For "what homework do I have for <day>?":

1. **Lessons of that day**: run `schedule` for that day and list the distinct courses.
2. **Previous session of each course**: run `schedule` over the ~3 weeks before that day (breaks such as "Travail
   personnel" weeks have no lessons) to find the user's previous lesson(s) of each course.
3. **Course planning**: run `course -- <CODE>` for each course and find where the teacher plans the work: a
   day-by-day planning, a week table, a "Travail à faire" section, announcements, recently uploaded exercise sheets.
4. **Interpret the teacher's convention**, which differs per course:
   - **"To do for next time" style** (e.g. "À faire pour la semaine 3", "pour la prochaine fois", "pour le 16.10"):
     items announced for the target day/week, or announced at the previous session for "next time", are the homework.
   - **"Exercises listed when started" style** (e.g. "Mardi 13 octobre — Exercices : 2.22 à 2.25"): exercises are
     listed at the date they are started in class, so the homework for the target day is to finish the exercises
     listed at the previous session(s) since the last lesson. Those listed at the target day itself will be started then
     (mention them as "planned in class", not as homework).
   - **No planning** (only exercise sheets or series): point to the most recently uploaded sheets of the course, and say
     clearly that the course gives no explicit planning.
5. **Submissions**: add Cyberlearn activities from `deadlines` due before the end of that day (lab reports, quizzes…).
6. **Answer per course**: what to do, the source ("planning du 5 au 30 octobre", "Travail à faire, semaine 5"…) and
   which convention you applied. Plannings are indicative: never invent exercises, and say when something is unclear.

## Other questions

- "What did we do / what is planned in <course> on <date>?": read the course's planning entry for that date and the
  user's lesson of that course on that date in the timetable.
- Written exams ("travaux écrits", "TE") and lab instructions are usually in dedicated sections: quote the date and
  time for the user's class.
- Never print `<root>/.env` nor the content of `<root>/.cache/`. If a command exits with "edu-ID two-step login code
  required" (exit code 2), ask the user for the current 6-digit code of their authenticator app and rerun it with
  `--mfa-code <code>`.
