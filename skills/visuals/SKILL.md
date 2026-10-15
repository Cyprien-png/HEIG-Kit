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

## Steps

1. Get the output folder: `npm --prefix <root> run -s video -- --where` (e.g. `~/Documents/HEIG-Kit/videos`).
2. Write the scene in that folder as `<descriptive-name>.py` (no spaces), one `Scene` subclass per animation, each with
   a one-line docstring saying what it shows (used to find it again later).
3. Render a quick preview, then the final version, and open it:
   `npm --prefix <root> run -s video -- <file.py> <SceneName> --quality low` to check it renders, then
   `npm --prefix <root> run -s video -- <file.py> <SceneName> --quality medium --open`.
   The video is written to the output folder as `<SceneName>.mp4` (path printed by the command).
4. If rendering fails, read the error, fix the scene and render again.
5. To include it in a document, reference it from Markdown with `![caption](../videos/<SceneName>.mp4)` and render the
   document with `heig:documents`.

## ManimGL, not Manim Community

This is 3b1b's ManimGL (version 1.7): `from manimlib import *`. Its API differs from Manim Community:

- `ShowCreation(mobject)` (not `Create`), `Write`, `FadeIn(m, shift=UP)`, `FadeOut`, `Transform`, `ReplacementTransform`,
  `TransformMatchingTex`, `Indicate`, `LaggedStart(*anims, lag_ratio=0.1)`; `self.play(...)`, `self.wait(seconds)`.
- Text: `Text("…")` for plain text, `TexText("…")` for text with LaTeX, `Tex(r"\forall a \in A")` for math (always raw
  strings). Accented text is fine in `Text` and `TexText`.
- Shapes and layout: `Circle`, `Square`, `Dot`, `Line`, `Arrow`, `VGroup(...).arrange(DOWN, buff=0.5)`,
  `.next_to(m, DOWN)`, `.move_to([x, y, 0])`, `.set_color(BLUE)`; colors `BLUE`, `RED`, `GREEN`, `YELLOW`, `GREY`.
- Graphs of functions: `axes = Axes((-3, 3), (-2, 2))`, `axes.get_graph(lambda x: x**2, color=BLUE)`,
  `axes.add_coordinate_labels()`.

## Good demonstrations

- One idea per scene, 10 to 40 seconds, in steps that match the explanation (build the objects, then show the
  property, then a counter-example).
- Use the course's notation and examples (search them with `heig:teacher` when the knowledge base is available).
- Pause with `self.wait()` after each key step so the viewer can read.
