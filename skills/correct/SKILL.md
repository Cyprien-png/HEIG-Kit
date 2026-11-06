---
name: correct
description: Corrects the user's handwritten exercises, tests or practice exams from photos taken with their phone, and records their mistakes in their profile. Use whenever the user wants their paper work corrected or checked ("corrige mes exercices", "corrige mon TE blanc", "vérifie ma série 3", "j'ai fait les exos sur papier"), asks to photograph or scan their work, or asks for a QR code to send photos.
---

# Correcting photographed work

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). This
skill needs a remote HEIG-Kit server (`HEIG_REMOTE_URL` in `.env`, `npm --prefix <root> run remote -- login`): the
phone sends its photos there. If the command says so, tell the user and stop.

## 1. QR code first, name it after

The student must never wait for you, nor you for them. Two steps, in this order:

1. **Get the QR code at once**, before anything else (no search, no title to think about):

   ```sh
   cd <root> && npm run -s correction -- new
   ```

   (or the `create_correction` MCP tool with no arguments). Show the QR code and the link **as printed** (the QR code
   in a code block, every line intact) and tell the user to scan it, photograph each page (camera or gallery; they can
   rotate, crop, reorder and delete), then press **Envoyer**. Note the correction id.

2. **While they photograph**, name and describe the correction:

   ```sh
   npm run -s correction -- set <id> --title "<title>" --course <CODE> [--topic "<topic>"] [--notes "<what to photograph>"]
   ```

   (or `update_correction`). The title names the work ("Série 3 MAD", "TE blanc ANA1 problème 2"); the capture page
   on the phone picks the new title up by itself. Use this time to also look up the statements and the reference
   solutions in the course material (step 3.2), so that the correction starts as soon as the photos arrive.

## 2. Wait for the photos, then read them

When the user says the photos are sent (or ask them to tell you):

```sh
npm --prefix <root> run -s correction -- show <id> --photos .cache/corrections/<id>
```

It saves the photos as files: **read every one of them** (Read tool) before correcting. If the state is still
`capture`, the user has not pressed Envoyer: ask them to, then run it again.

## 3. Correct, always the same way

Follow this method, exercise by exercise (it is also the server's `correct_exercises` prompt):

1. Transcribe **exactly** what the user wrote (`answer`, Markdown and LaTeX), mistakes included; `[illisible]` for
   what cannot be read, and say so in the feedback. Their tables become Markdown tables; their drawings, graphs and
   diagrams (Hasse diagram, automaton, curve, truth table, sketch) are redrawn faithfully, mistakes included, in a
   ```` ```svg ```` block (a `viewBox`, strokes in `currentColor`, shown on a paper-white card) or a ```` ```mermaid ````
   block (`graph`, `flowchart`, `xychart-beta`, `pie`…) that the web app draws. The `solution` holds the correct
   drawing, graph or table when the exercise has one; `feedback` may show the faulty part alone.
2. Find the statement and the reference solution in the course material (`heig:teacher`:
   `npm --prefix <root> run -s kb -- exercise <n> --course <CODE>`, `kb -- search …`); otherwise solve it yourself with
   the course's method.
3. Verdict: `correct` (result and method right), `partial` (right method, calculation slip, missing step or weak
   justification), `wrong` (wrong method or result), `missing` (not done).
4. For each non-correct exercise: `feedback` shows precisely where the error is (quote the faulty line) and how it
   should be done, step by step; `solution` is the full correct solution; `cause` is the probable cause in a few
   words (confused notions, forgotten case, calculation, misread statement, method not mastered…). For correct ones,
   confirm in a sentence and point out a possible improvement of the write-up.
5. `topics`: short reusable French topics per exercise ("inclusion-exclusion", "diagramme de Hasse").

Write the result as JSON (`.cache/corrections/<id>/result.json`):

```json
{
  "result": {
    "summary": "Deux exercices sur trois justes. Point fort : … À travailler : …",
    "exercises": [
      { "number": "1", "title": "…", "statement": "…", "answer": "…", "verdict": "correct", "feedback": "Juste. …", "topics": ["…"] },
      { "number": "2", "answer": "…", "verdict": "wrong", "feedback": "…", "solution": "…", "cause": "…", "topics": ["…"], "points": { "obtained": 1, "total": 4 } }
    ],
    "toRevise": ["…"]
  }
}
```

```sh
npm --prefix <root> run -s correction -- submit <id> --file .cache/corrections/<id>/result.json
```

## 4. Record the profile

Write `.cache/corrections/<id>/notes.json` and run `npm --prefix <root> run -s profile -- add --file <it>`:
one `mistake` note per error (`topic`, `text` = the cause and what happened, `severity` 1 to 3, `correctionId`,
`exercise`), one `weakness` per topic not mastered, one `strength` per topic clearly mastered, each with the `chapter`
and the `section` of the course it belongs to (`profile -- chapters <CODE>`; if the course has no chapters yet, set them first from the
unit sheet, see `heig:profile`). If a weakness listed
by `npm --prefix <root> run -s profile -- notes --course <CODE>` is now mastered, resolve it
(`profile -- resolve <note id>`).

```json
{ "notes": [ { "course": "MAD", "chapter": "1. Ensembles", "section": "Cardinal et inclusion-exclusion", "topic": "inclusion-exclusion", "kind": "mistake", "text": "Oublie de retirer |A ∩ B| : additionne les cardinaux.", "severity": 2, "correctionId": "<id>", "exercise": "2" } ] }
```

## 5. Answer in two levels

First only the list of exercises with juste / partiel / faux (so the user can look for their own mistakes), then,
under a heading « Détails », the complete correction. Tell them the correction is on the web app under
**Corrections**, with the same two toggles.
