---
name: documents
description: Creates documents for the user as PDF (and DOCX or HTML on request) from Markdown with LaTeX math, Mermaid diagrams, tables, code and embedded videos, then opens them. Use whenever the user asks for a PDF, a Word/DOCX file, a printable or exportable version, a revision sheet ("fiche de révision"), a practice exam to print ("TE blanc en PDF"), or to export an answer, exercises or a summary as a document.
---

# Documents

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). This
skill needs the `documents` module: if a command reports that it is missing, tell the user to run
`npm --prefix <root> run setup -- documents` (one time, installs everything automatically).

## Steps

1. Get the output folder: `npm --prefix <root> run -s doc -- --where` (e.g. `~/Documents/HEIG-Kit/documents`).
2. Write the content as Markdown in that folder, with a short descriptive file name without spaces, e.g.
   `MAD-relations-ordre-exercices.md` (create the folder if needed). Start with a `# Title`.
3. Render and open it: `npm --prefix <root> run -s doc -- <file.md> --pdf --open`. Add `--docx` (Word) or `--html` when
   asked; several formats can be combined. The output files are written next to the Markdown file.
4. Tell the user where the files are (the command prints their paths) and that the Markdown source is next to them
   (editable, and also rendered by Obsidian, VS Code or GitHub).

## Writing the Markdown

- **Math**: LaTeX between `$…$` (inline) or `$$…$$` (display), rendered with KaTeX: use standard math LaTeX
  (`\forall`, `\in`, `\mathbb{N}`, `\frac{a}{b}`, `\begin{pmatrix}…\end{pmatrix}`, `\begin{aligned}…\end{aligned}`).
- **Diagrams**: ```` ```mermaid ```` blocks (flowchart, sequence, class, state, er, gantt, pie, mindmap…). For an order
  relation, a `graph BT` flowchart gives a Hasse diagram (smaller elements at the bottom).
- **Videos**: `![caption](video.mp4)` with a path relative to the Markdown file (videos from `heig:visuals`): played
  in HTML, shown in PDF and DOCX as their last frame linking to the video file.
- Tables, code blocks with a language (```` ```python ````), quotes and images work as usual.
- New page: `<div style="page-break-after: always"></div>` (e.g. between a practice exam and its solutions).
- Write in the user's language, and keep the sources section of course-based content (see `heig:teacher`).

## Practice exams and exercise sheets

Produce two files when solutions are involved, so the statement can be done without seeing them:
`<name>-enonce.md` and `<name>-corrige.md`, both rendered to PDF. The statement header gives the course, the duration,
the allowed material and the points.
