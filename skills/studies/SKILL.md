---
name: studies
description: Answers questions about the user's HEIG-VD study plan from GAPS and shows unit and module descriptions ("fiches d'unité", "descriptifs de module"). Use whenever the user asks which units belong to which module, what they will study this semester or in later years, how many credits a unit or a year is worth, the objectives, content, workload, assessment rules, teacher in charge or bibliography of a course, or for the "fiche" of a course (e.g. "montre-moi la fiche de MAD", "quelles unités font partie de MAI1 ?", "combien de crédits cette année ?").
---

# Study plan and course sheets

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`).

## Commands

- `npm --prefix <root> run -s gaps -- plan`: current academic year, as Markdown tables: module → units, semester (E =
  preparatory, S1, S2), ECTS credits, status (suivie, à suivre, remplacée, équivalence, prévue…). Add `--all` for every
  year of the curriculum.
- `npm --prefix <root> run -s gaps -- unit <CODE>`: the unit sheet (e.g. `MAD`, `RXI`): key facts (teacher in charge,
  workload, periods, semesters), prerequisites, objectives, content with periods per topic, assessment, final grade,
  bibliography.
- `npm --prefix <root> run -s gaps -- module <CODE>`: the module sheet (e.g. `MAI1`): credits, compensation and repetition
  thresholds, how the module grade is computed from its units, skills, units and their content.

Codes are those of the study plan (an unknown code makes the command list the valid ones).

## Answering

- Sheets are already formatted Markdown: show them as they are when the user asks for a sheet (they render nicely),
  or answer the specific question (e.g. the assessment rules) with the relevant part and the sheet link.
- For "what is in module X", combine `plan` (units and credits) with the module sheet (grade formula, thresholds).
- Offer a PDF of a sheet with `heig:documents` when the user wants to keep or print it.
- If a command exits with "edu-ID two-step login code required" (exit code 2), ask the user for the current 6-digit code
  of their authenticator app and rerun it with `--mfa-code <code>`.
