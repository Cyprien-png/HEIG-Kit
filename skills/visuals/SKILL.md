---
name: visuals
description: Creates mathematical and scientific animations (videos) with 3b1b/manim (ManimGL) to explain or demonstrate a concept visually, then opens them, and can embed them in documents. Use whenever the user asks for an animation, a video, a visual demonstration or explanation ("montre-moi visuellement", "anime", "fais une vidéo qui explique…"), or when a moving illustration would make a course concept much clearer and the user wants one.
effort: medium
---

# Visual demonstrations (manim)

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). This
skill needs the `visuals` module: if a command reports that manim is not installed, tell the user to run
`npm --prefix <root> run setup -- visuals` (one time, installs manim, Python, FFmpeg and LaTeX automatically).

## Always start from what already exists, in one call

Every round trip costs several seconds: gather everything in **a single Bash call** at the start, before writing
anything: what was already generated, the output folder and the course material, through the CLI (no MCP tool to
load first):

```sh
cd <root> && npm run -s generated -- <keywords> ; npm run -s video -- --where ; \
  npm run -s kb -- exercise <number> --course <COURSE> ; npm run -s kb -- search "<notion>" --course <COURSE> --limit 4
```

`generated` takes several words and synonyms (any of them matches, best matches first, e.g. `ordre total hasse`);
drop the `kb` commands when the request names no course material. Use this call even when the request comes through
`heig:teacher`: no MCP tool to load with `ToolSearch`, no separate `get_exercise` or `search_course_material`. Then
write the scene right away from the API below, which lists every signature: never read `heigkit_manim.py` nor former
scenes (`grep`, `sed`, `cat`), each read costs a round trip and delays the video by 20 to 40 seconds.

**Plan in the code, not before it.** As soon as the results are in, say in one sentence which example the video
uses, then call `Write` at once: the scene's steps are decided while writing it (comments `# Step 1: …` in
`construct`), not drafted beforehand in your reasoning. Planning the whole video before writing doubles the wait
(about 30 seconds) for no better result; the `--check` and the key frames catch the mistakes afterwards.

- If something matches the request, reuse it: open it with `npm --prefix <root> run -s generated -- --open <file>` and
  say it already existed; offer to complete, update or redo it rather than regenerating it silently.
- Adapt an existing Markdown file or scene (edit it, then render again) when the request is a variation of it.
- Only create a new file when nothing relevant exists.

## Steps: one render, opened as soon as it is ready

1. The output folder is the one printed by `video -- --where` above (e.g. `~/Documents/HEIG-Kit/videos`).
2. Write the scene in that folder as `<descriptive-name>.py` (no spaces), one `Scene` subclass per animation, each with
   a one-line docstring saying what it shows (used to find it again later). Build it from `heigkit_manim` (below):
   shorter to write, fewer layout mistakes, faster to render.
3. Check it in a few seconds: `npm --prefix <root> run -s video -- <file.py> <SceneName> --check` runs the scene
   without rendering it (Python and LaTeX errors) and lists its layout problems at the end of each animation: texts
   over each other, a line or curve through a text, an arrow tip or a dot over a text, something off screen, with the
   time in the video. Fix every problem
   that is not intended (move or shorten a text, fade an object out earlier) and check again until it passes. No
   low-quality preview render: it costs as much time as the real one.
4. Render the final video directly: `npm --prefix <root> run -s video -- <file.py> <SceneName> --open --frames`
   (720p; parts rendered in parallel). **The video opens by itself as soon as it is rendered**: never hold it back until
   your explanation is written. In Claude Code, run this command in the background and write the explanation to the
   user while it renders.
5. Read the `Frames:` image it prints (key frames of the video, 3 per row): overlapping texts, objects off screen, wrong
   colors. If something is wrong, fix the scene and run step 4 again. The user is probably already watching the first
   version: a video open in a player is never closed nor reopened (that would cut their viewing); tell them that a
   corrected version is ready and that reopening the video shows it. Only one render may open the video: never run
   two renders of the same scene at the same time.
6. To include it in a document, reference it from Markdown with `![caption](../videos/<SceneName>.mp4)` and render the
   document with `heig:documents`.

## Template and ready-made pieces: `from heigkit_manim import *`

The renderer puts `heigkit_manim` on the Python path. Everything that moves is updated in place; numbers are written
the French way (0,73). Start every course video from the `CourseScene` template:

```python
from manimlib import *
from heigkit_manim import *


class SinusCercle(CourseScene):
    """ANA1 : sin(α) sur le cercle trigonométrique (ordonnée de M, valeurs remarquables, signes)."""

    def construct(self):
        self.title("Le sinus sur le cercle trigonométrique", "ANA1, §3.3")
        c = UnitCircle(center=FIGURE)              # the figure on the left half, around FIGURE
        self.play(FadeIn(c))
        self.say("M sur le cercle de rayon 1 :", ("sin(α) = ordonnée de M", RED), wait=2)   # panel on the right
        self.play(c.alpha.animate.set_value(PI / 6))
        self.play(FadeIn(c.height_mark(30, "1/2")))
        self.clear()                               # new step: everything but the title fades out
        self.finish(["sin(α) = ordonnée de M"], "Polycopié ANA1, §3.3 p. 17")   # recap and source
```

- `CourseScene` methods: `self.title(text, sub=None)` (kept until the end card); `self.say(*lines, wait=0)` replaces
  the right panel (font 26, top left corner at (0,3; 2,1)), each line a str or `(str, color)`; `self.clear(*keep)`
  fades out everything but the title and `keep` (the panel too); `self.finish(bullets, source=None,
  title="À retenir", wait=5)` clears the screen and shows the recap and the source.
- Text: `colored("texte", 30, YELLOW)` (`Text(..., color=...)` is ignored by ManimGL 1.7: the text stays white),
  `steps("1. …", ("2. …", GREEN))` (lines to show one by one), `title_card`, `recap`, `source_line`, `Panel` (used by
  `CourseScene`).
- Live values: `live_value("tan(α) =", lambda: …, decimals=2, unit="°")`, a label and a number following a value at
  every frame. Freeze it (`.clear_updaters()`) before fading it out while its value still changes; `self.clear()` does
  it. `follow(mobject, lambda: point)` keeps a label next to a moving point.
- Functions and limits: `approach(self, axes, f, x_from, x_to, RED)` (dot sliding along the graph with x and f(x)),
  `hole(axes, x, y)`, `vertical_asymptote(axes, 2, "x = 2")`, `sign_line(split=2, left="x - 2 < 0", right="x - 2 > 0")`,
  `value_table(("x", "f(x)"), [(1.9, -39), (1.99, -399)])`.
- Trigonometry: `c = UnitCircle(center=FIGURE, tangent=True)`, then animate `c.alpha.animate.set_value(angle)`;
  `c.p(x, y)` is the screen point of circle coordinates, `c.tan_value()` for a `live_value`;
  `c.height_mark(30, "1/2")` / `c.width_mark(60, "1/2")` carry sin / cos to the side of the circle with a label;
  `c.quadrant_signs("++--")` (sin; "+--+" cos, "+-+-" tan); `unroll(c, axes, math.sin)` draws the curve while α turns
  (axes at the circle's scale: see its docstring).
- Layout: `FIGURE` is the center of the left half (the panel takes the right half, from x = 0,3); figures may use x
  from -6,8 to 0.
- Discrete mathematics: `hasse(nodes, edges, center=FIGURE, scale=1.3, color=WHITE, font_size=34)`, nodes
  `{Tex label: (x, y)}` (y grows upwards, screen point = center + scale·(x, y)), edges `[(lower, upper)]`, e.g.
  `hasse({"1": (0, -1), "2": (-1, 0), "3": (1, 0), "6": (0, 1)}, [("1", "2"), ("1", "3"), ("2", "6"), ("3", "6")])`;
  returns `VGroup(lines, dots, labels)` (`d[0][k]` is the k-th edge, `d[1][k]` / `d[2][k]` the k-th node's dot / label,
  in the dict's order) with `.pos[label]` the screen point of a node; labels are outside (left of nodes with x < 0).
  `incomparable(diagram, "2", "3", color=RED)` (dashed line and ✗). `Matrix01(["1 1 1", "0 1 1", "0 0 1"],
  center=FIGURE, cell=0.6, font_size=36)` (entries spaced by `cell`, brackets) with `.entry(i, j)` (a `Tex`),
  `.box(i, j, GREEN)` (frame to add), `.diagonal()` (a line to add), `.entries[i]` (row i), `.brackets`.
  `labeled_dot("Aline", BLUE, font_size=22, direction=DOWN)`, `group_box(a, d, f, color=BLUE, buff=0.25)` (an
  equivalence class).

## ManimGL, not Manim Community

This is 3b1b's ManimGL (version 1.7): `from manimlib import *`. Its API differs from Manim Community:

- `ShowCreation(mobject)` (not `Create`), `Write`, `FadeIn(m, shift=UP)`, `FadeOut`, `Transform`, `ReplacementTransform`,
  `TransformMatchingTex`, `Indicate`, `LaggedStart(*anims, lag_ratio=0.1)`; `self.play(...)`, `self.wait(seconds)`.
- Text: `Text("…")` for plain text (color it with `.set_color(...)` or `colored`), `TexText("…")` for text with LaTeX,
  `Tex(r"\forall a \in A", color=RED)` for math (always raw strings). Accented text is fine in `Text` and `TexText`.
- Shapes and layout: `Circle`, `Square`, `Dot`, `Line`, `Arrow`, `VGroup(...).arrange(DOWN, buff=0.5)`,
  `.next_to(m, DOWN)`, `.move_to([x, y, 0])`, `.set_color(BLUE)`; colors `BLUE`, `RED`, `GREEN`, `YELLOW`, `GREY`.
  `color=` is also ignored by `Dot` and `Circle`: `Dot().set_color(RED)`, `Circle(...).set_stroke(BLUE, 3)`.
- Graphs of functions: `axes = Axes((-3, 3), (-2, 2))`, `axes.get_graph(lambda x: x**2, color=BLUE)`,
  `axes.add_coordinate_labels()`.
- Rendering time grows with what is rebuilt at every frame: never create `Text` or `Tex` inside `always_redraw` or an
  updater; move existing objects instead (`add_updater(lambda m: m.move_to(...))`, `put_start_and_end_on`,
  `live_value`).
- An updater must compute its position from the values (the angle, the tracker), not from another object's
  position: updaters run one after the other, so reading another moving object lags one frame behind.
- The video is rendered in parallel parts, each starting by skipping the animations before it: what is on screen must
  depend only on the current values, never be accumulated frame after frame. No `TracedPath` nor updater that adds to
  an object with `dt`: draw from the current value instead, e.g. a curve traced up to the angle α with
  `always_redraw(lambda: axes.get_graph(f, x_range=(0, alpha.get_value())))`.

## Good demonstrations

- **Demonstrate every step, never skip one.** A video is a complete step-by-step demonstration the user can follow
  without the course: every step of the method appears on screen in order, every intermediate result is shown
  (each pair checked, each entry of a matrix read, each line of a calculation, each edge removed and why), and no
  step is summarised as "and so on" or jumped over to the result. When a step repeats on many cases, show the first
  ones in full, then the others faster, but still all of them. Keep the end card with the key points.
- One idea per scene, in steps that match the explanation (build the objects, then show the property, then a
  counter-example); the length follows from showing every step (often 40 seconds to 2 minutes).
- Use the course's notation and examples (search them with `heig:teacher` when the knowledge base is available).
- Pause with `self.wait()` after each key step so the viewer can read.
