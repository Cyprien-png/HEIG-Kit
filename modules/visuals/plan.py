"""
Dry run of a ManimGL scene: `python plan.py <manimgl arguments> -s -w` runs the scene without rendering its frames (a few
seconds), saves its last frame, and writes to the JSON file named by HEIGKIT_PLAN:
- "durations": the duration of each animation (every play and wait, in order), so that render.ts can split the rendering
  into balanced parts (manimgl -n start,end);
- "layout": the layout problems found at the end of each animation (layout.py), each reported once, when it appears.
"""
import atexit
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.argv = ["manimgl", *sys.argv[1:]]  # manimlib reads its command line when imported

from manimlib.scene.scene import Scene  # noqa: E402

import layout  # noqa: E402

durations: list[float] = []
problems: list[dict] = []
current: set[str] = set()
play_progression = Scene.get_animation_time_progression
wait_progression = Scene.get_wait_time_progression


def record_play(self, animations):
    animations = list(animations)
    durations.append(float(self.get_run_time(animations)))
    return play_progression(self, animations)


def record_wait(self, duration, stop_condition=None):
    durations.append(float(duration))
    return wait_progression(self, duration, stop_condition)


post_play = Scene.post_play
progress = Scene.progress_through_animations


def probe_animations(self, animations):
    """
    The dry run skips the frames of an animation; some errors only happen in the middle of one (e.g. a number changing
    its count of digits while it fades). Each animation is computed halfway and almost at its end, with the updaters
    run in between as for real frames, so that they show up now instead of in a rendered part.
    """
    if self.skip_animations:
        for alpha in (0.5, 0.99):
            for animation in animations:
                animation.interpolate(alpha)
            self.update_mobjects(0)
    progress(self, animations)


def check_layout(self):
    """After each animation: the layout problems that were not there after the previous one."""
    post_play(self)
    global current
    try:
        found = set(layout.check(self))
    except Exception as error:  # a check must never stop the scene
        found = {f"vérification impossible : {error}"}
    for warning in sorted(found - current):
        problems.append({"animation": len(durations) - 1, "time": round(sum(durations), 1), "warning": warning})
    current = found


Scene.get_animation_time_progression = record_play
Scene.get_wait_time_progression = record_wait
Scene.post_play = check_layout
Scene.progress_through_animations = probe_animations


@atexit.register
def write_plan():
    with open(os.environ["HEIGKIT_PLAN"], "w") as f:
        json.dump({"durations": durations, "layout": problems}, f)


from manimlib.__main__ import main  # noqa: E402

main()
