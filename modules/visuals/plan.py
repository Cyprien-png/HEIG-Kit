"""
Dry run of a ManimGL scene: `python plan.py <manimgl arguments> -s -w` runs the scene without rendering its frames (a few
seconds), saves its last frame, and writes to the JSON file named by HEIGKIT_PLAN the duration of each animation (every
play and wait, in order), so that render.ts can split the rendering into balanced parts (manimgl -n start,end).
"""
import atexit
import json
import os
import sys

sys.argv = ["manimgl", *sys.argv[1:]]  # manimlib reads its command line when imported

from manimlib.scene.scene import Scene  # noqa: E402

durations: list[float] = []
play_progression = Scene.get_animation_time_progression
wait_progression = Scene.get_wait_time_progression


def record_play(self, animations):
    animations = list(animations)
    durations.append(float(self.get_run_time(animations)))
    return play_progression(self, animations)


def record_wait(self, duration, stop_condition=None):
    durations.append(float(duration))
    return wait_progression(self, duration, stop_condition)


Scene.get_animation_time_progression = record_play
Scene.get_wait_time_progression = record_wait


@atexit.register
def write_plan():
    with open(os.environ["HEIGKIT_PLAN"], "w") as f:
        json.dump(durations, f)


from manimlib.__main__ import main  # noqa: E402

main()
