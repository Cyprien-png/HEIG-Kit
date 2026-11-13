/** What the local and remote `render_hq_video` tools share: how a high quality video is written, and its inputs. */
import { z } from "zod";

/** Said by every tool that creates a video: the choice between the two kinds of videos and the sound belongs to the user. */
export const ASK_VIDEO_KIND =
  "BEFORE creating any video, unless the user already said it, ASK them two things and wait for the answer: " +
  "a normal video (render_animation, manim) or a High quality one (render_hq_video), and with or without audio. Never choose for them.";

export const HQ_VIDEO_API =
  "A High quality video is drawn in React (HTML, CSS, SVG) and rendered by Remotion at 1080p, 30 fps: polished typography, cards, glows, " +
  "circuits, tables, step-by-step explanations; for plotted functions and heavy LaTeX, prefer render_animation. " +
  "`narration` lists what is said (French), scene by scene and line by line: a line lasts as long as its speech (audio) or its reading time " +
  "(silent: the lines are the subtitles), so the same scenes work both ways. Lines are the only synchronization points: one line per thing " +
  "that appears, one or two sentences, at least four words; write numbers and symbols in words (\"huit vers un\", \"non B\"), and give `tts` " +
  "when a word is mispronounced (\"mine-termes\" for \"mintermes\"). " +
  "`code` is one TSX file: `import { AbsoluteFill, useCurrentFrame } from \"remotion\"; import { … } from \"heigkit\";` and " +
  "`export const scenes = { intro: Intro, … }`, one component per scene of the narration, same names. In a component: " +
  "`const f = useCurrentFrame()` (frame since the scene started) and `const { a1, a2 } = useLines()` (line by id: `.s` start frame, `.d` " +
  "duration, `.e` end). Everything is a pure function of `f`: no CSS animation, no state, no timer. `ramp(f, a1.s, 16)` goes 0→1 over 16 " +
  "frames from the start of line a1 (use it for opacity, `lerp(from, to, p)` for positions). The canvas is 1920×1080; leave the bottom " +
  "130 px to the subtitles. The dark background, subtitles and fades between scenes are added for you. " +
  "heigkit: colors `C` (bg0, panel, line, text, dim, one = the accent of the course, also 1/true, zero = grey, sel = amber, varA = pink, varB = violet, bad = red), " +
  "`alpha(C.panel, 0.85)` for a transparent one (never hard-code a background: the colors are those of the course the file name or the first comment starts with, see get_course_themes), fonts `SANS` and `MONO`; `<Header title tag />` (top left); `<Svg>` (full-screen SVG, filter=\"url(#glow)\" available); " +
  "`<Val x y label size? opacity? glow? />` (a value chip: 0, 1, A, /B); " +
  "`<TruthTable t={{ x, y, rowH, vars: [\"C\",\"B\",\"A\"] }} name values appear? rows? hi? emphasis? groups? />` with `cellPos(t, row, key)` " +
  "and `groupPos(t, level, size, index)`; `<Mux g={{ x, y, w, n, gap }} frame={f} sel={[\"A\",\"B\"]} appear? selBits? selected? flow? out? " +
  "outValue? title? />` with `dataLabel(g, i)`, `dataPin`, `selPin`, `outPin`, `muxH(g)`; `<Fly f start from to label />` (a chip flying " +
  "between two positions). Networks: `<Device x y kind label sub? size? active? color? />` (kind laptop, pc, server, router, switch, cloud, " +
  "browser), `<Link from to p? active? f? label? dashed? />`, `<Packet f start from to via? label color? dur? labelBelow? />` (an envelope " +
  "travelling), `<Broadcast f start at color? />`, `<FileIcon x y name />`, `NET` (colors per protocol), `<SeqDiagram f x y w gap actors msgs " +
  "hi? />` (arrow diagram); HTML: `<Terminal f x y w title prompt lines={[{ at, text, out? }]} rows? />`, `<FieldCard x y w title fields />`, " +
  "`<ZoomBadge path />`; zooms: `<Camera focus scale opacity?>`, `zoomScale(f, { inAt?, outAt?, max? })`, `<Lens x y w h label p />`. " +
  "A video of a network lab follows the network lab standard (the whole lab, devices always visible, packets, terminals, zoom-ins on the " +
  "mechanisms that go back out to the overview): see skills/hqvideo/network-labs.md. " +
  "Plain HTML with inline styles works too (cards, lists, formulas). Start the file with a one-line " +
  "`/** … */` comment saying what the video shows.";

export const hqVideoInput = {
  name: z.string().describe("File name without spaces, e.g. syl-mux-exercice-4"),
  code: z.string().describe("TSX source of the scenes (see the description)"),
  narration: z
    .array(
      z.object({
        scene: z.string().describe("Name of the scene, the key of its component in `scenes`"),
        lines: z.array(
          z.object({
            id: z.string().describe("Unique in the whole video, a valid identifier: a1, a2…"),
            text: z.string().describe("What is said and shown as subtitle"),
            tts: z.string().optional().describe("What is spoken instead, when the text is mispronounced"),
            seconds: z.number().optional().describe("Fixed duration in a silent video, instead of the reading time"),
          }),
        ),
      }),
    )
    .describe("What is said, scene by scene, line by line"),
  audio: z.boolean().describe("Spoken narration with a natural French voice (true) or silent with subtitles (false). The user's choice: ask them if they did not say."),
  check: z.boolean().optional().describe("Only an image of the key frames, in seconds and without the voice: use it first to fix errors and the layout, then render."),
  quality: z.enum(["low", "medium", "high"]).optional().describe("high (1080p) by default; medium is 720p"),
  subtitles: z.boolean().optional().describe("Show the lines as subtitles (default: true)"),
};
