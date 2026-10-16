# Visual demonstrations (`visuals` module)

Mathematical animations with [3b1b/manim](https://github.com/3b1b/manim) (ManimGL), the engine of the 3Blue1Brown
videos, to see a concept move: a construction, a transformation, a counter-example.

## Setup

```sh
npm run setup -- visuals
```

Installs, without touching the rest of your system:

- manim 1.7.2 in `vendor/manim`, with its own Python environment (Python 3.12 is installed if needed);
- [TinyTeX](https://yihui.org/tinytex/) in `vendor/`, a small LaTeX distribution for the formulas of the animations;
- FFmpeg (video encoding), with your system's package manager.

On Linux, OpenGL, Cairo and Pango libraries are installed too, and animations are rendered through a virtual display
when there is no screen.

## Usage

```sh
npm run video -- scene.py MyScene --check           # runs the scene without rendering it (a few seconds), last frame
npm run video -- scene.py MyScene --open --frames   # render (720p), open the video, image of its key frames
npm run video -- scene.py MyScene --quality low     # 480p; high = 1080p
npm run video -- scene.py MyScene --jobs 2          # parallel parts (default: half the processors, at most 4)
npm run video -- --where                            # default folder used by the assistant
```

A scene is first run without rendering (dry run): errors show up in seconds, the layout is checked at the end of every
animation (texts over each other, a line through a text, something off screen), and the duration of each animation is
measured. Its frames are then rendered in parallel parts of similar length (`manimgl -n start,end`), joined with FFmpeg
without re-encoding: a 1 min 40 video renders in about 15 to 30 seconds instead of one minute on an 8-core Mac.

In Claude Code, the `heig:visuals` skill writes and renders the scene for you: *"montre-moi visuellement pourquoi la
divisibilité n'est pas antisymétrique sur Z*"*, *"anime la construction d'un diagramme de Hasse"*. Videos go to
`~/Documents/HEIG-Kit/videos` and can be embedded in documents (`heig:documents`).

## Notes

- The scenes use ManimGL (`from manimlib import *`), whose API differs from Manim Community (`ShowCreation` instead of
  `Create`, for instance). In ManimGL 1.7, `color=` is ignored by `Text`, `Dot` and `Circle`: color them with
  `.set_color()` or `.set_stroke()`.
- `from heigkit_manim import *` gives ready-made pieces for course animations (`modules/visuals/heigkit_manim.py`):
  title and text panel, live values with a decimal comma, a point approaching a limit, holes, asymptotes, sign lines,
  tables of values, the trigonometric circle. They update objects in place instead of rebuilding them at every frame,
  which is what makes a scene slow to render.
- Rendering uses OpenGL: on a remote Linux server, `xvfb` provides the display (installed by the setup).
