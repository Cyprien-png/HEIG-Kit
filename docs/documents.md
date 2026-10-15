# Documents (`documents` module)

Turns Markdown into PDF, Word (DOCX) or HTML, with LaTeX math, Mermaid diagrams, highlighted code and embedded
videos rendered, and opens the result.

## Setup

```sh
npm run setup -- documents
```

Installs the renderer (Markdown, [KaTeX](https://katex.org), [Mermaid](https://mermaid.js.org), a headless Chromium) in
`modules/documents/`, and [pandoc](https://pandoc.org) for Word files, with your system's package manager.

## Usage

```sh
npm run doc -- notes.md                       # notes.pdf, next to notes.md
npm run doc -- notes.md --pdf --docx --open   # several formats, then open them
npm run doc -- notes.md --html --out ~/Desktop
npm run doc -- --where                        # default folder used by the assistant
```

In Claude Code, the `heig:documents` skill writes the Markdown for you and renders it: *"exporte ces exercices en PDF"*,
*"fais-moi une fiche de révision sur les relations d'ordre"*, *"mets le TE blanc en PDF, énoncé et corrigé séparés"*.
Documents go to `~/Documents/HEIG-Kit/documents` (`HEIG_OUTPUT_DIR` in `.env` to change it), next to their Markdown
source, which Obsidian, VS Code and GitHub also render.

## Markdown features

| Feature | Syntax |
|---|---|
| Math (KaTeX) | `$a \mid b$`, `$$\forall a \in A,\ aRa$$`, `\begin{aligned}…\end{aligned}` |
| Diagrams | ```` ```mermaid ```` blocks: flowcharts, sequence, class, state, gantt, mindmap… |
| Videos | `![caption](animation.mp4)`: played in HTML; in PDF and DOCX, the last frame links to the video |
| New page | `<div style="page-break-after: always"></div>` |

In Word files, formulas become native, editable equations and Mermaid diagrams are inserted as images.
