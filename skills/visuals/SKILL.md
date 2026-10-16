---
name: visuals
description: Creates mathematical and scientific animations (videos) with 3b1b/manim (ManimGL) to explain or demonstrate a concept visually, then opens them, and can embed them in documents. Use whenever the user asks for an animation, a video, a visual demonstration or explanation ("montre-moi visuellement", "anime", "fais une vidéo qui explique…"), or when a moving illustration would make a course concept much clearer and the user wants one.
---

# Visual demonstrations (manim)

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). This
skill needs the `visuals` module: if a command reports that manim is not installed, tell the user to run
`npm --prefix <root> run setup -- visuals` (one time, installs manim, Python, FFmpeg and LaTeX automatically).

## Always start from what already exists

Before creating anything, look for what was already generated on the topic:
`npm --prefix <root> run -s generated -- <one or two keywords>` (e.g. `hasse`, `antisymetrie`, `MAD`).

- If something matches the request, reuse it: open it with `npm --prefix <root> run -s generated -- --open <file>` and
  say it already existed; offer to complete, update or redo it rather than regenerating it silently.
- Adapt an existing Markdown file or scene (edit it, then render again) when the request is a variation of it.
- Only create a new file when nothing relevant exists.

## Steps: one render, opened as soon as it is ready

1. Get the output folder: `npm --prefix <root> run -s video -- --where` (e.g. `~/Documents/HEIG-Kit/videos`).
2. Write the scene in that folder as `<descriptive-name>.py` (no spaces), one `Scene` subclass per animation, each with
   a one-line docstring saying what it shows (used to find it again later). Build it from `heigkit_manim` (below):
   shorter to write, fewer layout mistakes, faster to render.
3. Check it in a few seconds: `npm --prefix <root> run -s video -- <file.py> <SceneName> --check` runs the scene
   without rendering it (Python, LaTeX and position errors) and prints the image of its last frame. Fix and check again
   until it passes. No low-quality preview render: it costs as much time as the real one.
4. Render the final video directly: `npm --prefix <root> run -s video -- <file.py> <SceneName> --open --frames`
   (720p; parts rendered in parallel). **The video opens by itself as soon as it is rendered**: never hold it back until
   your explanation is written. In Claude Code, run this command in the background and write the explanation to the
   user while it renders.
5. Read the `Frames:` image it prints (key frames of the video, 3 per row): overlapping texts, objects off screen, wrong
   colors. If something is wrong, fix the scene and run step 4 again (the corrected video opens in its turn).
6. To include it in a document, reference it from Markdown with `![caption](../videos/<SceneName>.mp4)` and render the
   document with `heig:documents`.

## Ready-made pieces: `from heigkit_manim import *`

The renderer puts `heigkit_manim` on the Python path. Everything that moves is updated in place; numbers are written
the French way (0,73).

- `title_card("Titre", "sous-titre")`: title at the top. `source_line("Polycopié ANA1, §1.6")`: reference at the
  bottom right. `recap("À retenir", "point 1", "point 2")`: end card.
- `Panel()`: text block on the right half, replaced step by step: `panel.say(self, "ligne", ("ligne en jaune", YELLOW),
  wait=2)`, `panel.clear(self)`. `steps("1. …", ("2. …", GREEN))`: lines to show one by one.
- `colored("texte", 30, YELLOW)`: colored Text (`Text(..., color=...)` is ignored by ManimGL 1.7: the text stays white).
- `live_value("tan(α) =", lambda: …, decimals=2, unit="°")`: label and number that follows a value at every frame.
  `follow(mobject, lambda: point)`: keeps a label next to a moving point.
- Functions and limits: `approach(self, axes, f, x_from, x_to, RED)` (dot sliding along the graph with x and f(x)),
  `hole(axes, x, y)`, `vertical_asymptote(axes, 2, "x = 2")`, `sign_line(split=2, left="x - 2 < 0", right="x - 2 > 0")`,
  `value_table(("x", "f(x)"), [(1.9, -39), (1.99, -399)])`.
- Trigonometry: `c = UnitCircle(radius=1.8, center=[-3.3, -0.4, 0], tangent=True)`, then animate
  `c.alpha.animate.set_value(angle)`; `c.p(x, y)` is the screen point of circle coordinates, `c.tan_value()` for a
  `live_value`.

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

## Good demonstrations

- One idea per scene, 10 to 40 seconds, in steps that match the explanation (build the objects, then show the
  property, then a counter-example).
- Use the course's notation and examples (search them with `heig:teacher` when the knowledge base is available).
- Pause with `self.wait()` after each key step so the viewer can read.
