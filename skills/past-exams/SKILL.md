---
name: past-exams
description: Files the scanned written tests of former years ("anciens TE", PDFs filled by students) on the HEIG-Kit server by branch, year and test, writes their clean statement ("énoncé") and a solutions document ("corrigé") from the page images, and corrects the user's own attempt of one. Use whenever the user mentions old or past tests ("anciens TE", "TE des années précédentes", "le TE2 de 2022"), wants one transcribed, its corrigé, to import an archive of them, or to be corrected on one they did.
---

# Past exams (« anciens TE »)

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). The
exams live in the `exams` output folder (`npm --prefix <root> run -s exams -- where`), filed as
`<branch>/[<sub-branch>/]<year>/<exam>/`, and are synced with the server (`exams -- push|pull`). The web app shows them
under **Révision › Anciens TE**, branch by branch, then year by year.

On a shared server (`HEIG_REMOTE_URL` set, or a remote MCP server) everyone reads the past exams and is corrected on
them, but only an administrator files, transcribes, changes or deletes them (`exams -- push`, `save_past_exam_text`):
for anyone else the server refuses, and that refusal is final. Tell the user to ask an administrator; correcting their
own attempt stays theirs to do.

Inside an exam folder: `original.pdf` (the scan, **filled by a former student**: name, answers, marks), optionally
`original-vierge.pdf` (unfilled) and `original-corrige.pdf` (the teacher's solutions), then what the agent produces:
`enonce.md` + `enonce.pdf` (the statement alone), `corrige.md` + `corrige.pdf`, and `pages/p01.png`… (page images).

## Import an archive

```sh
npm --prefix <root> run -s exams -- import <folder> --dry-run      # what would be filed, what is skipped (labs, quizzes…)
npm --prefix <root> run -s exams -- import <folder>                # copies into the exams folder, one folder per test
npm --prefix <root> run -s exams -- push                           # sends everything new to the server
```

The folder is laid out like the archives (`MAD/2024-2025/MAD_JHH_24-25_TE1.pdf`, `PRG1/INF1/2016-2017/…`): the file
names give the course, the teacher, the year, the test number and the role (`_corrigé`, `_corrige_inclu`, `_vierge`,
`_blanc`, `_partie1`). Unzip an archive into an empty folder first. `--branch <NAME>` forces the top folder.

## Write the énoncé and the corrigé of one exam

1. Find it: `npm --prefix <root> run -s exams -- list [--branch MAD]` (MCP: `list_past_exams`), then
   `exams -- show <id|words>`.
2. Render its pages: `npm --prefix <root> run -s exams -- pages <id>` (`--which corrige` for the teacher's solutions,
   `--which vierge` for the unfilled copy, better than the filled scan when it exists). Read **every** page image with
   the Read tool (MCP: `get_past_exam` returns them).
3. Write `<exam folder>/enonce.md`: **only the printed statement**, in the teacher's order and words: header (course,
   teacher, date or year, duration, allowed material, total points), instructions, every problem with its points and
   its sub-questions, tables and figures redrawn (Markdown tables, Mermaid, SVG). Formulas in LaTeX. Leave the answer
   areas out. **Never transcribe anything handwritten**: no student name, no answers, no marks, no teacher
   annotations or ticks. An answer blank in the scan that reveals the expected form (a table to fill, a Venn diagram
   to shade) is kept empty. Where the scan is unreadable, write `[illisible]` and say so to the user.
4. Write `corrige.md`: from `original-corrige.pdf` when it exists (transcribed, completed where it is terse),
   otherwise solve every question yourself with the course's method (`heig:teacher`, `kb -- search`), giving every
   step and the points of each question.
5. Render and send: `npm --prefix <root> run -s exams -- render <id>` then `exams -- push`. Tell the user the
   énoncé and the corrigé are under Anciens TE, branch › year.

Over MCP only (another computer): `save_past_exam_text` stores the Markdown; the PDF comes with the next `render` on
the computer holding the files.

## Correct the user's attempt

The user does the exam on paper, then asks for a correction: follow `heig:correct` with the exam attached, so that
the Anciens TE page shows the attempt and its grade:

```sh
npm --prefix <root> run -s correction -- new "Ancien TE : <title>" --course <CODE> --exam exam:<id>
```

(MCP: `create_correction` with `exam: "exam:<id>"`.) Grade with the exam's barème (`points` on every exercise), from
`corrige.md` or the teacher's solutions. The « Photographier » button of the page creates the same correction itself.

## Privacy

The scans show another student's name, answers and marks: never quote them, never put them in the énoncé or in a
message, and do not share the originals outside the user's server.
