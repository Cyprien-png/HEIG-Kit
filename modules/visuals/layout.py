"""
Layout check of a ManimGL scene, run by plan.py at the end of every animation of the dry run: texts that overlap each
other, texts crossed by a line or a curve, and objects partly off screen. Returns readable warnings, so that layout
mistakes are fixed before rendering instead of after looking at the video.
"""
from __future__ import annotations

import numpy as np

from manimlib.constants import FRAME_X_RADIUS, FRAME_Y_RADIUS
from manimlib.mobject.numbers import DecimalNumber
from manimlib.mobject.svg.string_mobject import StringMobject
from manimlib.mobject.types.vectorized_mobject import VMobject

# Texts may touch; they overlap when the common part covers this share of the smaller one.
OVERLAP_SHARE = 0.15
# A line crosses a text when it goes through the text's box shrunk by this share on each side (letters have margins).
SHRINK = 0.2
# Tolerance at the edges of the screen.
MARGIN = 0.05
# Distance between the points sampled along a line or a curve: smaller than the height of a small text.
STEP = 0.04


def _visible(mobject) -> bool:
    for m in mobject.family_members_with_points():
        if isinstance(m, VMobject):
            if m.get_fill_opacity() > 0.1 or (m.get_stroke_opacity() > 0.1 and m.get_stroke_width() > 0):
                return True
        else:
            return True
    return False


def _box(m) -> np.ndarray:
    return np.array([m.get_left()[0], m.get_bottom()[1], m.get_right()[0], m.get_top()[1]])


def _name(m) -> str:
    if isinstance(m, DecimalNumber):
        return f"nombre {getattr(m, 'num_string', '')!r}"
    text = getattr(m, "string", None) or getattr(m, "tex_string", None) or type(m).__name__
    text = " ".join(str(text).split())
    return f"« {text[:40]}{'…' if len(text) > 40 else ''} »"


def _texts(scene) -> list[tuple[object, int]]:
    """Visible texts (outermost Text, Tex, TexText or DecimalNumber), each with the index of its top-level mobject."""
    found = []

    def walk(m, top):
        if isinstance(m, (StringMobject, DecimalNumber)):
            if _visible(m) and m.get_width() > 0:
                found.append((m, top))
            return
        for sub in m.submobjects:
            walk(sub, top)

    for i, m in enumerate(scene.mobjects):
        walk(m, i)
    return found


def _strokes(scene) -> list[tuple[VMobject, int]]:
    """Visible lines and curves (no fill) outside texts, with the index of their top-level mobject."""
    found = []

    def walk(m, top):
        if isinstance(m, (StringMobject, DecimalNumber)):
            return
        if isinstance(m, VMobject) and m.has_points() and m.get_fill_opacity() < 0.1 \
                and m.get_stroke_opacity() > 0.1 and m.get_stroke_width() > 0:
            found.append((m, top))
        for sub in m.submobjects:
            walk(sub, top)

    for i, m in enumerate(scene.mobjects):
        walk(m, i)
    return found


def _sample(stroke: VMobject) -> np.ndarray:
    """Points every STEP or so along a line or curve (its control points alone can skip over a small text)."""
    samples = []
    for a, h, b in stroke.get_bezier_tuples():
        n = max(2, int(np.ceil((np.linalg.norm(h - a) + np.linalg.norm(b - h)) / STEP)))
        t = np.linspace(0, 1, n + 1)[:, None]
        samples.append((1 - t) ** 2 * a + 2 * (1 - t) * t * h + t ** 2 * b)
    return np.concatenate(samples) if samples else stroke.get_points()


def check(scene) -> list[str]:
    warnings = []
    texts = _texts(scene)
    boxes = [_box(m) for m, _ in texts]

    # Texts over each other.
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, b = boxes[i], boxes[j]
            w = min(a[2], b[2]) - max(a[0], b[0])
            h = min(a[3], b[3]) - max(a[1], b[1])
            if w <= 0 or h <= 0:
                continue
            smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
            if smaller > 0 and w * h / smaller >= OVERLAP_SHARE:
                warnings.append(f"{_name(texts[i][0])} chevauche {_name(texts[j][0])}")

    # Lines and curves through texts (not those of the same object, e.g. an axis and its numbers).
    for stroke, top in _strokes(scene):
        points = _sample(stroke)
        for (text, text_top), box in zip(texts, boxes):
            if text_top == top:
                continue
            dx, dy = (box[2] - box[0]) * SHRINK, (box[3] - box[1]) * SHRINK
            inside = (points[:, 0] > box[0] + dx) & (points[:, 0] < box[2] - dx) \
                & (points[:, 1] > box[1] + dy) & (points[:, 1] < box[3] - dy)
            if inside.any():
                warnings.append(f"une ligne ({type(stroke).__name__}) traverse {_name(text)}")

    # Off screen.
    for m in scene.mobjects:
        if not m.has_points() and not m.submobjects or not _visible(m):
            continue
        box = _box(m)
        if box[0] < -FRAME_X_RADIUS - MARGIN or box[2] > FRAME_X_RADIUS + MARGIN \
                or box[1] < -FRAME_Y_RADIUS - MARGIN or box[3] > FRAME_Y_RADIUS + MARGIN:
            texts_in = [t for t, top in texts if t in m.get_family()]
            what = _name(texts_in[0]) if texts_in else type(m).__name__
            warnings.append(f"{what} sort de l'écran")
    return sorted(set(warnings))
