---
name: profile
description: Reads and updates the user's learning profile (strengths, weaknesses, frequent mistakes and topics to revise per course, built from past corrections) and prepares revisions targeted at their weak points. Use whenever the user asks what they struggle with, what to revise, for a revision on their weak points ("révise mes points faibles", "sur quoi je galère en MAD ?"), or asks to remember something about how they learn.
---

# Learning profile

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`).

## Commands

- `npm --prefix <root> run -s profile -- [--course MAD]`: weaknesses, frequent mistakes, strengths, corrected exercise
  rates and the topics to revise first.
- `profile -- notes [--course MAD] [--kind mistake|weakness|strength|note] [--query "<topic>"]`: the notes, by
  filters or by meaning.
- `profile -- add --file notes.json`: `{ "notes": [ { "course": "MAD", "topic": "…", "kind": "weakness", "text": "…", "severity": 2 } ] }`.
- `profile -- resolve <note id>`: a weakness is overcome.
- `profile -- chapters [MAD]`: the chapters of a course, the axes of the profile's radar; `profile -- chapters MAD --file
  chapters.json` sets them in order (`{ "chapters": [ { "title": "3. Relations", "keywords": ["relation d'ordre",
  "diagramme de Hasse"] } ] }`). Each chapter is **maîtrisé**, **fragile**, **en difficulté** or **non évalué** from the
  open notes filed under it (their `chapter` field, or a keyword equal to their topic).

## Chapters first

The first time a course appears in the profile (or when `profile` says its chapters are not set), define them from the
course: the unit sheet (`heig:studies`, `get_unit_sheet`) or the Cyberlearn course page (`heig:courses`), one chapter
per chapter of the syllabus, in order, with the topics of each as keywords (in the course's words, the ones corrections
use). Then every note carries its `chapter`, so that the radar stays complete; topics the profile lists as « under no
chapter » are added to a chapter's keywords.

## Revision targeted at weak points

1. Read the profile and the latest corrections (`npm --prefix <root> run -s correction -- list`, `correction -- show <id>`).
2. Take the 2 or 3 most urgent topics of "To revise first"; read the course on them (`heig:teacher`).
3. For each topic: why the user gets it wrong (from the noted causes), the right method in a few steps with an example
   from the course, then 2 new exercises of the same kind with detailed solutions.
4. Offer a deck of cards on the key points (`heig:flashcards`) and a PDF sheet (`heig:documents`), and suggest
   photographing the new exercises once done (`heig:correct`) so the profile is updated.

When the user tells you something to remember about their learning ("je confonds toujours ⊆ et ∈"), record it as a
`note` or `weakness` with `profile -- add`, with its `chapter`.
