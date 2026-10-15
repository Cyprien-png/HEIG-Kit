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
npm run video -- scene.py MyScene --open            # render a scene (720p) and open the video
npm run video -- scene.py MyScene --quality low     # quick preview (480p); high = 1080p
npm run video -- --where                            # default folder used by the assistant
```

In Claude Code, the `heig:visuals` skill writes and renders the scene for you: *"montre-moi visuellement pourquoi la
divisibilité n'est pas antisymétrique sur Z*"*, *"anime la construction d'un diagramme de Hasse"*. Videos go to
`~/Documents/HEIG-Kit/videos` and can be embedded in documents (`heig:documents`).

## Notes

- The scenes use ManimGL (`from manimlib import *`), whose API differs from Manim Community (`ShowCreation` instead of
  `Create`, for instance).
- Rendering uses OpenGL: on a remote Linux server, `xvfb` provides the display (installed by the setup).
