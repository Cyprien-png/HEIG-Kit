# Video narration (`voice` module)

Adds a spoken explanation, synchronized with the animation, to the videos of the [`visuals`](visuals.md) module. It is
optional: without it, or without `--voice`, videos stay silent and render exactly as fast as before.

## Setup

```sh
npm run setup -- voice
```

Installs, in `vendor/kokoro` (about 280 MB, deleting that folder removes everything), and the `visuals` module if it is
missing:

- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small AI speech model (Apache 2.0) run by
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) on the processor, without a GPU, account or Internet
  connection, about 7 times faster than real time on a recent Mac;
- its French voice `ff_siwis`, trained on the [SIWIS dataset](https://datashare.ed.ac.uk/handle/10283/2353).

## Usage

A scene says its lines with `self.voice`:

```python
class Sinus(CourseScene):
    def construct(self):
        self.voice("Sur le cercle de rayon un, le sinus d'alpha est l'ordonnée du point M.")
        self.title("Le sinus", "ANA1, §3.3")      # animations run while the line is spoken
        self.voice("Quand alpha vaut trente degrés, le sinus vaut un demi.")   # starts when the previous line ends
        self.play(c.alpha.animate.set_value(PI / 6))
        self.wait_voice()                         # holds the picture until the line ends
```

```sh
npm run video -- scene.py Sinus --voice --open   # video with its voice
npm run video -- scene.py Sinus --open           # the same scene, silent
```

- `self.voice(text)` starts a line now and returns at once. If the previous line is not finished, the picture is held
  until it is: lines never overlap, and the video is lengthened as much as the speech needs.
- `self.wait_voice()` holds the picture until the current line ends, then pauses briefly.
- The end of a video waits for its last line.
- Without `--voice`, these two calls do nothing and take no time, so one scene gives both versions. Both are written to
  `<Scene>.mp4`: the last render replaces the previous one.

Lines are read aloud as written: write formulas and symbols in words (`sinus d'alpha`, not `sin(α)`). Generated speech is
kept in `.cache/voice`, so rendering again only synthesizes the lines that changed.

`--voice` renders the frames again rather than adding sound to an existing video, because the speech changes the timing of
the animations. Synthesis adds about 20 seconds for two minutes of new speech, plus a second dry run.

A scene whose pace comes only from its spoken lines runs much faster in its silent version, too fast to read: keep
`self.wait` and `wait=` pauses in a scene meant to be watched both ways.
