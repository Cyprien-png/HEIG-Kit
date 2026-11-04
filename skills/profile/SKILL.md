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

## Revision targeted at weak points

1. Read the profile and the latest corrections (`npm --prefix <root> run -s correction -- list`, `correction -- show <id>`).
2. Take the 2 or 3 most urgent topics of "To revise first"; read the course on them (`heig:teacher`).
3. For each topic: why the user gets it wrong (from the noted causes), the right method in a few steps with an example
   from the course, then 2 new exercises of the same kind with detailed solutions.
4. Offer a deck of cards on the key points (`heig:flashcards`) and a PDF sheet (`heig:documents`), and suggest
   photographing the new exercises once done (`heig:correct`) so the profile is updated.

When the user tells you something to remember about their learning ("je confonds toujours ⊆ et ∈"), record it as a
`note` or `weakness` with `profile -- add`.
