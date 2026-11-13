# Course themes

Every course has its own graphic charter, the same everywhere: one **color** per course, the one of its lessons in the
calendar, from which the colors of the High quality videos, the manim videos, the documents and the web app are derived.
Everything keeps the same layout and typography; only the colors change, so a video or a PDF is recognized as "RXI" or
"MAD" at a glance.

A **mood** sets how the dark backgrounds of the videos feel, for all courses or for one:

| Mood | Feel |
|---|---|
| `nuit` | dark and tinted with the course color (the default) |
| `encre` | almost black and sober, the color only on the accents |
| `neon` | saturated, with marked halos |
| `aube` | lighter and softer |

## What takes the theme

| Output | What changes | How the course is found |
|---|---|---|
| High quality videos (`npm run hqvideo`, `render_hq_video`) | background, halos, panels, lines, accent (`C.one`), second colors | first comment of the scene file (`/** RXI ch. 5 : … */`), then its file name (`rxi-…`), or `--course` |
| Manim videos (`npm run video`, `render_animation`) | background and title accent of a `CourseScene` | file name (`MAD-…py`) or `--course` |
| Documents (`npm run doc`, `render_document`) | headings, rules, table headers, quotes, links (the page stays white, for printing) | file name (`RXI-…md`), then the title, or `--course` |
| Web app | course chips and lessons of the calendar | the course code |

Something that belongs to no known course keeps the neutral look. The mood only acts on videos.

## Changing a color or the mood

```sh
npm run theme                                # the courses, their colors and the moods
npm run theme -- preview                     # a page showing every course in every mood
npm run theme -- mood encre                  # mood of every course
npm run theme -- set RXI --mood neon         # mood of one course (--mood default: back to the general one)
npm run theme -- set RXI --color "#ec4899"   # color of a course; also how a new course is added
npm run theme -- show RXI --mood aube        # every color of a course, as JSON
```

To try a mood on one video without changing the settings: `npm run hqvideo -- <video.tsx> --check --mood neon`.

The settings are [`themes/themes.json`](../themes/themes.json) (`mood`, `courses`, and `aliases` such as `ANA` → `ANA1`).
It is a file of the repository, so that this computer and the server show the same colors: commit it, then update the
server (`npm run server:update`); the web app takes it when it is built. A video or document already rendered keeps the
colors it was rendered with: render it again to give it the new ones.

A course that is not in the settings gets a color from its code, always the same. Give it one with `set` when two
courses end up too close.

## For scenes

In a High quality video, never hard-code a background color: use `C.bg0`, `C.panel`, `C.line`… and
`alpha(C.panel, 0.85)` for a transparent one. `C.one` is the accent of the course (and the color of a 1); `C.sel`,
`C.varA` and `C.varB` are three second colors chosen away from it. The derivation is in
[`themes/index.ts`](../themes/index.ts), tested for readability in every course and mood (`test/themes.test.ts`).
