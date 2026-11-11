---
name: hqvideo
description: Creates High quality explanatory videos drawn in React, HTML and SVG and rendered with Remotion (1080p), with a natural local French voice or silent with subtitles. Use when the user asks for a High quality video ("vidéo High quality", "vidéo HQ", "une belle vidéo", "plus jolie que manim"), or when they answered "High quality" to the question every video request starts with (normal or High quality, with or without audio).
effort: medium
---

# High quality videos (Remotion)

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). This
skill needs the `hqvideo` module: if a command reports that it is not installed, tell the user to run
`npm --prefix <root> run setup -- hqvideo` (one time: Remotion, a headless browser, the OmniVoice voice and its model,
about 6 GB).

## First, the two questions

A video request that does not already say it starts with two questions, asked together and before anything else
(`AskUserQuestion` when available):

1. **Normal or High quality?** Normal is `heig:visuals` (manim): fast, the right tool for curves, geometry and
   LaTeX-heavy mathematics. High quality is this skill: polished typography, cards, glows, circuits, tables,
   step-by-step explanations.
2. **With or without audio?** With audio, a natural French voice says the narration (about 20 seconds of computing per
   line on a recent Mac, much more on a server without a graphics card). Without, the lines are shown as subtitles.

Never choose for the user. If they chose normal, follow `heig:visuals` instead.

## Start from what exists, in one call

```sh
cd <root> && npm run -s generated -- <keywords> ; npm run -s hqvideo -- --where ; \
  npm run -s kb -- exercise <number> --course <COURSE> ; npm run -s kb -- search "<notion>" --course <COURSE> --limit 4
```

Reuse or adapt an existing video (`<name>.tsx` and `<name>.narration.json` in the videos folder) rather than
regenerating it. Follow the course's notation and cite the exercise or chapter in the video (`Header` tag).

## A video is two files

In the folder printed by `hqvideo -- --where`, with the same descriptive name (no spaces):

**`<name>.narration.json`**: what is said, scene by scene and line by line.

```json
[
  { "scene": "intro", "lines": [
    { "id": "i1", "text": "On te donne trois fonctions logiques." },
    { "id": "i2", "text": "Elle vaut un pour les mintermes zéro et un.", "tts": "Elle vaut un pour les mine-termes zéro et un." }
  ] }
]
```

- **A line is a synchronization point**: it lasts as long as its speech (audio) or its reading time (silent), and the
  scenes place their animations on the start of the lines. One line per thing that appears; one or two sentences; at
  least four words (very short lines are spoken badly).
- Write as someone speaks, in French, explaining the step instead of reading the screen; numbers and symbols in words
  (`huit vers un`, `non B`, never `8→1` or `/B`).
- `tts` replaces what is spoken when a word is mispronounced; `seconds` fixes the duration of a line in a silent video.
- Ids are unique in the whole video and valid identifiers (`a1`, `r3`); scene names too.

**`<name>.tsx`**: one React component per scene, exported under the scene's name. Start it with a one-line
`/** … */` comment saying what the video shows (used to find it again).

```tsx
/** SYL : le multiplexeur, un aiguillage. */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, Header, Mux, type MuxGeo, Svg, Val, dataLabel, lerp, ramp, useLines } from "heigkit";

const Intro: React.FC = () => {
  const f = useCurrentFrame();            // frame since the scene started (30 per second)
  const { i1, i2 } = useLines();          // timing of the lines: .s start frame, .d duration, .e end
  const g: MuxGeo = { x: 830, y: 270, w: 290, n: 4, gap: 96 };
  const p = ramp(f, i2.s, 16);            // 0 → 1 over 16 frames, from the start of line i2
  return (
    <AbsoluteFill>
      <Header title="Le multiplexeur" tag="SYL · Série 6" />
      <Svg>
        <Mux g={g} frame={f} appear={ramp(f, i1.s, 30)} sel={["Sel0", "Sel1"]} selected={f >= i2.s ? 2 : null} flow={p} />
        <Val x={dataLabel(g, 2).x} y={dataLabel(g, 2).y} label="D2" opacity={p} glow />
      </Svg>
    </AbsoluteFill>
  );
};

export const scenes = { intro: Intro };
```

Rules that make a video render correctly:

- **Everything is a pure function of the frame**: no CSS animation or transition, no `useState`, no timer, no
  `Math.random()`. Appearances are `opacity={ramp(f, line.s, 16)}`; movements are `lerp(from, to, ramp(…))`.
- The canvas is 1920×1080. Keep the bottom 130 px free: the subtitles go there. The dark animated background, the
  subtitles and the fades between scenes are added for you; a scene only draws its content.
- A scene that stays on screen for many lines should keep one layout and reveal its parts line after line (as the
  example does), rather than replacing everything at each line.
- Imports: `remotion` (`AbsoluteFill`, `useCurrentFrame`, `interpolate`, `Easing`, `Sequence`), `react`, and
  `heigkit`. No other package, no network, no image or font file.

## `heigkit` reference

- **Timing**: `useLines()` (lines by id), `useScene()` (`dur`, `list`), `ramp(f, start, dur = 16)`, `lerp(a, b, p)`.
- **Look**: `C` colors (`bg0`, `bg1`, `panel`, `line`, `text`, `dim`, `one` teal for 1 or true, `zero` grey, `sel`
  amber for selection, `varA` pink, `varB` violet, `bad` red), `SANS`, `MONO`, `colorOf(label)`.
- **`<Header title tag? />`**: title of the scene, top left, tag above it (course, series, exercise).
- **`<Svg>`**: a full-screen SVG in the video's coordinates; `filter="url(#glow)"` and `url(#soft)` are available.
- **`<Val x y label size? opacity? scale? glow? />`**: a value chip (`0`, `1`, `A`, `/B`, `D2`), colored by its label.
- **`<TruthTable t={{ x, y, rowH, vars: ["C","B","A"] }} name values appear? rows? hi? emphasis? groups? />`**:
  `values` are the outputs, row 0 first; `rows={(f - start) / 4}` reveals the rows one by one; `hi={{ row,
  strength, color? }}` highlights a row; `emphasis={{ col: "A", strength }}` puts a column forward;
  `groups={[{ size: 2, labels, progress, band? }]}` brackets the rows by 2, 4… with a result per group.
  `cellPos(t, row, "F" | "n" | variable)` and `groupPos(t, level, size, index)` give positions, `tableW(t)` its width.
- **`<Mux g={{ x, y, w, n, gap, selGap? }} frame={f} sel={["A","B"]} appear? selAppear? selBits? selected? flow? out?
  outValue? title? />`**: an IEC multiplexer with `n` data inputs; `sel` names its select inputs, weight 0 first;
  `selected` and `flow` light the path from an input to Y. `dataLabel(g, i)` is where the value of input `i` goes;
  also `dataPin`, `selPin`, `outPin`, `outLabel`, `muxH(g)`.
- **`<Fly f start from to label dur? />`**: a chip flying along an arc between two positions (a value copied from a
  table to an input).
- Anything else is plain SVG inside `<Svg>` or HTML with inline styles inside `<AbsoluteFill>` (cards, lists,
  formulas): see `<root>/modules/hqvideo/examples/mux.tsx`, the complete video of a SYL exercise, when you need a model
  for a kind of scene; do not read the kit's sources.

## Steps

1. Write both files.
2. Check in seconds, without the voice: `npm --prefix <root> run -s hqvideo -- <file.tsx> --check`. It reports
   compilation and runtime errors, and prints `Frames:`, an image of the key frames (the end of the lines, 3 per row).
   Read it: overlapping texts, something off screen or over the subtitles, a scene that looks empty. Fix and check
   again.
3. Render: `npm --prefix <root> run -s hqvideo -- <file.tsx> --open --frames`, with `--audio` if the user asked for
   sound. In Claude Code, run it in the background and tell the user what the video covers while it renders. Spoken
   lines are cached: rendering again after a visual fix only synthesizes the lines whose text changed.
4. Read the `Frames:` image of the final video (with audio, the lines have their real duration); fix and render again
   if needed.
5. Tag the video in the library: `npm --prefix <root> run -s library -- tag videos/<name>.mp4 --course <CODE> --tags
   "vidéo,explication,<topic>"` (or the `tag_library_item` MCP tool).

Other options: `--quality medium` (720p, faster), `--no-subtitles`, `--jobs N` (browser tabs drawing in parallel).

Through the MCP server, `render_hq_video` takes the same two parts (`code`, `narration`) with `audio` and `check`.
