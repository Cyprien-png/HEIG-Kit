---
name: grades
description: Shows the user's HEIG-VD grades and absences from GAPS: continuous assessment grades (tests, quizzes, with class averages and weights), course averages, the official transcript ("bulletin de notes") and absence rates per unit. Use whenever the user asks about their grades, marks, notes, averages, test results, what grade they need, their transcript or credits obtained, or their absences ("quelles sont mes notes ?", "ma moyenne en RXI ?", "combien d'absences en PRG ?").
---

# Grades and absences

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`).

## Commands

- `npm --prefix <root> run -s gaps -- grades`: continuous assessment of the current semester per course (each
  evaluation with its date, grade, class average and coefficient, the average per teaching type and its weight), then the
  official transcript and the credits obtained.
- `npm --prefix <root> run -s gaps -- absences`: absent periods per unit (justified ones included), rate over the
  periods already given and over the whole unit.
- `npm --prefix <root> run -s gaps -- module <CODE>`: how a module grade is computed from its units (weights,
  compensation threshold), to answer "what grade do I need".

## Answering

- Grades are personal: answer only what was asked, concisely, with the figures from GAPS. "-" means not graded yet.
- Scale: 1 to 6, 4 is the minimum pass grade. "a 1.0" is an absence at a test, "[x]" a grade ignored in the average.
- To estimate a needed grade, use the coefficients shown and the module rules; say clearly it is an estimate.
- Absence rates in orange in GAPS (≥ 10%) deserve a short heads-up; HEIG-VD rules on absences may require attendance.
- If a command exits with "edu-ID two-step login code required" (exit code 2), ask the user for the current 6-digit code
  of their authenticator app and rerun it with `--mfa-code <code>`.
