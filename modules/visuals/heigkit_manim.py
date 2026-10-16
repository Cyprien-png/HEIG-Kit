"""
Ready-made pieces for HEIG-Kit course animations (ManimGL 1.7), so that a scene is short to write and fast to render.

    from manimlib import *
    from heigkit_manim import *

    class Sinus(CourseScene):
        '''ANA1 : sin(α) sur le cercle trigonométrique.'''

        def construct(self):
            self.title("Le sinus", "ANA1, §3.3")
            c = UnitCircle(center=FIGURE)
            self.play(FadeIn(c))
            self.say("sin(α) = ordonnée de M", wait=2)
            self.finish(["sin(α) = ordonnée de M"], "Polycopié ANA1, §3.3")

`npm run video` puts this folder on the Python path. Everything that moves is updated in place (no Text or Tex created
again at every frame), which keeps rendering fast. Numbers are written the French way (0,73).
"""
from __future__ import annotations

import math

from manimlib import *

__all__ = [
    "FIGURE", "CourseScene", "colored", "FrDecimal", "title_card", "Panel", "live_value", "follow", "steps", "recap",
    "source_line", "value_table", "sign_line", "approach", "hole", "vertical_asymptote", "UnitCircle", "unroll",
    "labeled_dot", "group_box", "hasse", "incomparable", "Matrix01",
]

# Center of the figure in the usual layout: figure on the left half, text panel on the right half.
FIGURE = np.array([-3.3, -0.4, 0])


def colored(content: str, font_size: int = 30, color=WHITE) -> Text:
    """Text in a color: in ManimGL 1.7, Text(..., color=...) is ignored and the text stays white (Dot and Circle too)."""
    return Text(content, font_size=font_size).set_color(color)


class FrDecimal(DecimalNumber):
    """DecimalNumber with a decimal comma: 0,73; infinite values are shown as ∞."""

    def __init__(self, number: float = 0, **kwargs):
        kwargs.setdefault("group_with_commas", False)
        super().__init__(number, **kwargs)

    def get_num_string(self, number):
        if isinstance(number, float) and not math.isfinite(number):
            return "∞" if number > 0 else "−∞" if number < 0 else "?"
        return super().get_num_string(number).replace(".", ",")


def title_card(text: str, sub: str | None = None, font_size: int = 40) -> VGroup:
    """Title at the top of the screen, with an optional grey subtitle under it."""
    title = Text(text, font_size=font_size).to_edge(UP, buff=0.3)
    group = VGroup(title)
    if sub:
        group.add(colored(sub, 26, GREY_A).next_to(title, DOWN, buff=0.2))
    return group


class Panel:
    """
    A block of text lines in a fixed place (by default the right half of the screen), replaced step by step:
    `panel.say(self, "line 1", ("line 2", YELLOW))`. Each line is a str or (str, color).
    """

    def __init__(self, corner=np.array([0.3, 2.1, 0]), font_size: int = 26, buff: float = 0.22):
        self.corner = corner
        self.font_size = font_size
        self.buff = buff
        self.group: VGroup | None = None

    def lines(self, *lines) -> VGroup:
        items = [(l, WHITE) if isinstance(l, str) else l for l in lines]
        group = VGroup(*[colored(t, self.font_size, c) for t, c in items])
        return group.arrange(DOWN, aligned_edge=LEFT, buff=self.buff).move_to(self.corner, aligned_edge=UL)

    def say(self, scene: Scene, *lines, wait: float = 0) -> VGroup:
        new = self.lines(*lines)
        animations = [FadeIn(new, shift=UP * 0.2)]
        if self.group is not None:
            animations.append(FadeOut(self.group))
        scene.play(*animations)
        self.group = new
        if wait:
            scene.wait(wait)
        return new

    def clear(self, scene: Scene) -> None:
        if self.group is not None:
            scene.play(FadeOut(self.group))
            self.group = None


class CourseScene(Scene):
    """
    Template of a course video: a title at the top, the figure on the left (around FIGURE), a text panel on the right
    (`self.say`), and an end card. In construct: `self.title(...)`, then the steps, then `self.finish(...)`.
    """

    def setup(self):
        super().setup()
        self.panel = Panel()
        self.heading: VGroup | None = None

    def title(self, text: str, sub: str | None = None) -> VGroup:
        """Title (and grey subtitle) at the top, kept until the end card."""
        self.heading = title_card(text, sub)
        self.play(FadeIn(self.heading))
        return self.heading

    def say(self, *lines, wait: float = 0) -> VGroup:
        """Replaces the text of the right panel: lines are str or (str, color)."""
        return self.panel.say(self, *lines, wait=wait)

    def clear(self, *keep: Mobject) -> None:
        """Fades out everything but the title and `keep` (the panel too), to start a new step."""
        kept = {id(m) for m in keep} | ({id(self.heading)} if self.heading else set())
        gone = [m for m in self.mobjects if id(m) not in kept]
        for m in gone:
            # Frozen while they fade out: a live value changing its number of digits would break the fading.
            m.clear_updaters()
        if gone:
            self.play(*[FadeOut(m) for m in gone])
        self.panel.group = None

    def finish(self, bullets: list[str], source: str | None = None, title: str = "À retenir", wait: float = 5) -> None:
        """End card: everything fades out, then the recap and the source of the course."""
        self.clear()
        card = [FadeIn(recap(title, *bullets).shift(DOWN * 0.3))]
        if source:
            card.append(FadeIn(source_line(source)))
        self.play(*card)
        self.wait(wait)


def live_value(label: str, value, decimals: int = 2, color=YELLOW, font_size: int = 30, unit: str | None = None) -> VGroup:
    """
    "label 0,73" whose number follows `value()` at every frame, e.g.
    `live_value("tan(α) =", lambda: math.tan(alpha.get_value()))`, or with a unit in plain text: `unit="°"`.
    Returns VGroup(label, number[, unit]). Before fading it out while its value still changes, freeze it with
    `.clear_updaters()` (its number of digits must not change during the fading); `CourseScene.clear` does it.
    """
    caption = colored(label, font_size, color)
    number = FrDecimal(value(), num_decimal_places=decimals, font_size=font_size, color=color)
    group = VGroup(caption, number)
    if unit:
        group.add(colored(unit, font_size, color))
    def place(_):
        number.set_value(value()).next_to(caption, RIGHT, buff=0.15).align_to(caption, DOWN)
        if unit:
            group[2].next_to(number, RIGHT, buff=0.05).align_to(caption, UP)
    place(None)
    number.add_updater(place)
    return group


def follow(mobject: Mobject, point, direction=UR, buff: float = 0.1) -> Mobject:
    """Keeps a label next to a moving point: `follow(Text("M"), lambda: dot.get_center())`."""
    mobject.add_updater(lambda m: m.next_to(point(), direction, buff=buff))
    return mobject


def steps(*lines, font_size: int = 30, buff: float = 0.3) -> VGroup:
    """Numbered or bullet lines aligned on the left (str, or (str, color)), to show one by one with FadeIn."""
    items = [(l, WHITE) if isinstance(l, str) else l for l in lines]
    return VGroup(*[colored(t, font_size, c) for t, c in items]).arrange(DOWN, aligned_edge=LEFT, buff=buff)


def recap(title: str, *bullets: str, font_size: int = 30) -> VGroup:
    """End card: a yellow title and "• bullet" lines, centered."""
    group = VGroup(colored(title, 42, YELLOW), *[Text(f"• {b}", font_size=font_size) for b in bullets])
    group.arrange(DOWN, aligned_edge=LEFT, buff=0.35)
    group[0].set_x(0)
    return group.move_to(ORIGIN)


def source_line(text: str) -> Text:
    """Small grey reference at the bottom right, e.g. "Polycopié ANA1, §1.6"."""
    return colored(text, 18, GREY_B).to_corner(DR, buff=0.25)


def value_table(header: tuple[str, str], rows: list[tuple], font_size: int = 30, color=YELLOW) -> VGroup:
    """Two-column table of values (header, then rows of (x, f(x))), numbers in the second column colored."""
    lines = [VGroup(Text(header[0], font_size=font_size), Text(header[1], font_size=font_size))]
    for x, y in rows:
        fmt = lambda v: str(v).replace(".", ",").replace("-", "−")
        lines.append(VGroup(Text(fmt(x), font_size=font_size), colored(fmt(y), font_size, color)))
    for line in lines:
        line.arrange(RIGHT, buff=1.2)
    return VGroup(*lines).arrange(DOWN, buff=0.3, aligned_edge=RIGHT)


def sign_line(x_range=(1, 3, 0.5), split: float = 2, left: str = "x - 2 < 0", right: str = "x - 2 > 0",
              width: float = 8, colors=(RED, GREEN)) -> VGroup:
    """
    Number line with a marked point and the sign on each side of it (Tex labels), e.g. the sign of a denominator.
    Returns VGroup(line, dot, left_zone, right_zone, left_label, right_label).
    """
    line = NumberLine(x_range, width=width, include_numbers=True,
                      decimal_number_config=dict(num_decimal_places=1, font_size=24))
    dot = Dot(line.n2p(split))
    lz = Line(line.n2p(x_range[0]), line.n2p(split), color=colors[0], stroke_width=10).shift(UP * 0.25)
    rz = Line(line.n2p(split), line.n2p(x_range[1]), color=colors[1], stroke_width=10).shift(UP * 0.25)
    ll = Tex(left, font_size=36, color=colors[0]).next_to(lz, UP, buff=0.2)
    rl = Tex(right, font_size=36, color=colors[1]).next_to(rz, UP, buff=0.2)
    return VGroup(line, dot, lz, rz, ll, rl)


def approach(scene: Scene, axes: Axes, f, x_from: float, x_to: float, color=YELLOW, run_time: float = 3,
             readout: bool = True, rate_func=smooth) -> VGroup:
    """
    Moves a dot along the graph of f from x_from to x_to, with a vertical guide line and, if readout, "x = … f(x) = …"
    in the bottom right corner. Returns the moving objects (to remove or fade out afterwards).
    """
    t = ValueTracker(x_from)
    dot = Dot().set_color(color).add_updater(lambda m: m.move_to(axes.c2p(t.get_value(), f(t.get_value()))))
    guide = Line(axes.c2p(x_from, 0), axes.c2p(x_from, f(x_from)) + 1e-6 * UP, color=GREY, stroke_width=2)
    guide.add_updater(lambda m: m.put_start_and_end_on(axes.c2p(t.get_value(), 0) + 1e-6 * UP,
                                                       axes.c2p(t.get_value(), f(t.get_value()))))
    group = VGroup(guide, dot)
    if readout:
        values = VGroup(live_value("x =", t.get_value, 3, color), live_value("f(x) =", lambda: f(t.get_value()), 4, color))
        values.arrange(RIGHT, buff=0.6).to_corner(DR).shift(UP * 0.2)
        group.add(values)
    scene.add(group)
    scene.play(t.animate.set_value(x_to), run_time=run_time, rate_func=rate_func)
    return group


def hole(axes: Axes, x: float, y: float, color=BLUE) -> Circle:
    """Empty circle on a graph where the function is not defined (a "hole")."""
    return Circle(radius=0.07).set_stroke(color, 3).set_fill(BLACK, 1).move_to(axes.c2p(x, y))


def vertical_asymptote(axes: Axes, x: float, label: str | None = None) -> VGroup:
    """Dashed vertical line x = a over the whole height of the axes, with an optional Tex label at the bottom."""
    y_min, y_max = axes.y_range[0], axes.y_range[1]
    line = DashedLine(axes.c2p(x, y_min), axes.c2p(x, y_max), color=GREY)
    group = VGroup(line)
    if label:
        group.add(Tex(label, font_size=30, color=GREY_A).next_to(axes.c2p(x, y_min), RIGHT, buff=0.15).shift(UP * 0.3))
    return group


def labeled_dot(name: str, color=WHITE, font_size: int = 22, direction=DOWN) -> VGroup:
    """A colored point with its name under it (or in `direction`): VGroup(dot, label)."""
    dot = Dot(radius=0.12).set_color(color)
    return VGroup(dot, colored(name, font_size, color).next_to(dot, direction, buff=0.12))


def group_box(*mobjects: Mobject, color=YELLOW, buff: float = 0.25) -> SurroundingRectangle:
    """Frame around a group of objects, e.g. an equivalence class."""
    return SurroundingRectangle(VGroup(*mobjects), buff=buff).set_stroke(color, 3)


def hasse(nodes: dict, edges: list, center=FIGURE, scale: float = 1.3, color=WHITE, font_size: int = 34) -> VGroup:
    """
    Hasse diagram: nodes {Tex label: (x, y)} (y grows upwards), edges [(lower, upper)]. Labels are outside the diagram
    (on the left for the nodes on its left half). Returns VGroup(lines, dots, labels), with `.pos[label]` the screen point
    of a node, e.g. hasse({"1": (0, -1), "2": (-1, 0), "3": (1, 0), "6": (0, 1)}, [("1", "2"), ("1", "3"), ("2", "6"), ("3", "6")]).
    """
    pos = {k: np.array(center, dtype=float) + scale * np.array([x, y, 0]) for k, (x, y) in nodes.items()}
    lines = VGroup(*[Line(pos[a], pos[b]).set_stroke(GREY_B, 3) for a, b in edges])
    dots = VGroup(*[Dot(pos[k], radius=0.09).set_color(color) for k in nodes])
    labels = VGroup(*[Tex(k, font_size=font_size).next_to(pos[k], LEFT if x < 0 else RIGHT, buff=0.15)
                      for k, (x, _) in nodes.items()])
    group = VGroup(lines, dots, labels)
    group.pos = pos
    return group


def incomparable(diagram: VGroup, a: str, b: str, color=RED) -> VGroup:
    """Red dashed line and ✗ between two nodes of a Hasse diagram that are not comparable."""
    line = DashedLine(diagram.pos[a], diagram.pos[b]).set_stroke(color, 3)
    return VGroup(line, colored("✗", 36, color).next_to(line, UP, buff=0.1))


class Matrix01(VGroup):
    """
    0/1 matrix of a relation between brackets: `m = Matrix01(["1 1 1", "0 1 1", "0 0 1"])`, then `m.entry(i, j)`,
    `m.box(i, j, GREEN)` (frame around an entry) and `m.diagonal()` (line along the main diagonal).
    """

    def __init__(self, rows: list[str], center=FIGURE, cell: float = 0.6, font_size: int = 36, **kwargs):
        super().__init__(**kwargs)
        n = len(rows)
        center = np.array(center, dtype=float)
        self.entries = VGroup(*[
            VGroup(*[Tex(v, font_size=font_size).move_to(center + cell * np.array([j - (n - 1) / 2, (n - 1) / 2 - i, 0]))
                     for j, v in enumerate(row.split())])
            for i, row in enumerate(rows)
        ])
        h, w = cell * n / 2 + 0.1, cell * n / 2 + 0.05
        left = VGroup(Line(center + [-w, h, 0], center + [-w, -h, 0]), Line(center + [-w, h, 0], center + [-w + 0.15, h, 0]),
                      Line(center + [-w, -h, 0], center + [-w + 0.15, -h, 0]))
        self.brackets = VGroup(left, left.copy().flip(UP, about_point=center)).set_stroke(GREY_A, 2)
        self.add(self.entries, self.brackets)

    def entry(self, i: int, j: int) -> Mobject:
        return self.entries[i][j]

    def box(self, i: int, j: int, color=YELLOW) -> SurroundingRectangle:
        return SurroundingRectangle(self.entry(i, j), buff=0.06).set_stroke(color, 3)

    def diagonal(self) -> Line:
        n = len(self.entries)
        return Line(self.entry(0, 0).get_center(), self.entry(n - 1, n - 1).get_center()).set_stroke(GREY_B, 2, opacity=0.6)


class UnitCircle(VGroup):
    """
    Trigonometric circle driven by an angle tracker: `c = UnitCircle(radius=1.8, center=LEFT * 3.3)`, then animate
    `c.alpha` (radians). Shows axes, the circle, M, cos (green), sin (red), the angle arc, and with tangent=True the line
    x = 1 and the point T whose ordinate is tan(α). Everything is updated in place.
    """

    def __init__(self, radius: float = 1.8, center=ORIGIN, alpha: float = PI / 5, tangent: bool = False,
                 tangent_limit: float = 1.8, **kwargs):
        super().__init__(**kwargs)
        self.R = radius
        self.O = np.array(center, dtype=float)
        self.alpha = ValueTracker(alpha)
        self.limit = tangent_limit
        p = self.p
        self.axes = VGroup(
            Arrow(p(-1.35, 0), p(1.6, 0), buff=0, stroke_width=2, color=GREY_B),
            Arrow(p(0, -tangent_limit), p(0, tangent_limit), buff=0, stroke_width=2, color=GREY_B),
        )
        self.circle = Circle(radius=radius).set_stroke(BLUE, 3).move_to(self.O)
        self.labels = VGroup(Text("O", font_size=24).next_to(self.O, DL, buff=0.08),
                             Tex("1", font_size=24).next_to(p(1, 0), DR, buff=0.08))
        self.cos_line = Line(color=GREEN, stroke_width=6)
        self.sin_line = Line(color=RED, stroke_width=6)
        self.radius_line = Line(stroke_width=3)
        self.M = Dot(radius=0.07)
        self.M_label = Text("M", font_size=26)
        self.arc = Arc(0, alpha, radius=0.35, arc_center=self.O).set_stroke(GREY_A, 2)
        self.add(self.axes, self.circle, self.labels, self.arc, self.cos_line, self.sin_line, self.radius_line,
                 self.M, self.M_label)
        if tangent:
            self.tangent_line = Line(p(1, -tangent_limit), p(1, tangent_limit), color=YELLOW, stroke_width=2).set_opacity(0.5)
            self.ray = Line(self.O, p(1, 1), color=GREY_B, stroke_width=2)
            self.tan_segment = Line(color=YELLOW, stroke_width=8)
            self.T = Dot(radius=0.07).set_color(YELLOW)
            self.T_label = colored("T", 26, YELLOW)
            self.add(self.tangent_line, self.ray, self.tan_segment, self.T, self.T_label)
        self.tangent = tangent
        self.add_updater(lambda m: m.refresh())
        self.refresh()

    def p(self, x: float, y: float) -> np.ndarray:
        """Screen point of the circle's coordinates (x, y)."""
        return self.O + self.R * np.array([x, y, 0])

    def refresh(self) -> None:
        a = self.alpha.get_value()
        c, s = math.cos(a), math.sin(a)
        p, eps = self.p, 1e-6 * RIGHT
        self.cos_line.put_start_and_end_on(self.O, p(c, 0) + eps)
        self.sin_line.put_start_and_end_on(p(c, 0), p(c, s) + 1e-6 * UP)
        self.radius_line.put_start_and_end_on(self.O, p(c, s) + eps)
        self.M.move_to(p(c, s))
        self.M_label.next_to(p(c, s), UR if c >= 0 else UL, buff=0.08)
        angle = a if abs(a) > 0.03 else 0.03
        self.arc.become(Arc(0, angle, radius=0.35, arc_center=self.O).set_stroke(GREY_A, 2))
        if self.tangent:
            visible = abs(c) > 1e-3 and abs(s / c) <= self.limit
            t = s / c if visible else math.copysign(self.limit, s if c >= 0 else -s)
            end = p(1, t) if visible else self.O + (1 if c >= 0 else -1) * (p(c, s) - self.O) * (self.limit / max(abs(s), 1e-6))
            self.ray.put_start_and_end_on(p(c, s), end + eps)
            for m in (self.tan_segment, self.T, self.T_label):
                m.set_opacity(1 if visible else 0)
            self.tan_segment.put_start_and_end_on(p(1, 0), p(1, t) + 1e-6 * UP)
            self.T.move_to(p(1, t))
            self.T_label.next_to(p(1, t), LEFT, buff=0.12).shift(UP * 0.12)

    def tan_value(self) -> float:
        """tan(α), or a very large number near π/2 + kπ (for a live_value)."""
        c = math.cos(self.alpha.get_value())
        return math.sin(self.alpha.get_value()) / c if abs(c) > 1e-9 else float("inf")

    def height_mark(self, degrees: float, label: str | None = None, color=RED) -> VGroup:
        """
        The height sin(α) of the point at `degrees` carried to the left of the circle by a dashed line, with a small
        label there (e.g. "√3/2"), where several values stay readable.
        """
        a = math.radians(degrees)
        guide = DashedLine(self.p(math.cos(a), math.sin(a)), self.p(-1.1, math.sin(a))).set_stroke(color, 2)
        group = VGroup(guide)
        if label:
            group.add(colored(label, 20, color).next_to(self.p(-1.1, math.sin(a)), LEFT, buff=0.08))
        return group

    def width_mark(self, degrees: float, label: str | None = None, color=GREEN) -> VGroup:
        """The abscissa cos(α) of the point at `degrees` carried below the circle, with a small label there."""
        a = math.radians(degrees)
        guide = DashedLine(self.p(math.cos(a), math.sin(a)), self.p(math.cos(a), -1.1)).set_stroke(color, 2)
        group = VGroup(guide)
        if label:
            group.add(colored(label, 20, color).next_to(self.p(math.cos(a), -1.1), DOWN, buff=0.08))
        return group

    def quadrant_signs(self, signs: str = "++--") -> VGroup:
        """Signs of quadrants I, II, III and IV ("++--" for sin, "+--+" for cos, "+-+-" for tan), green or red."""
        places = ((0.55, 0.45), (-0.55, 0.45), (-0.55, -0.45), (0.55, -0.45))
        return VGroup(*[colored("+" if s == "+" else "−", 40, GREEN if s == "+" else RED).move_to(self.p(x, y))
                        for s, (x, y) in zip(signs, places)])


def unroll(circle: UnitCircle, axes: Axes, f=math.sin, color=RED) -> VGroup:
    """
    The graph of f (math.sin or math.cos) drawn up to the circle's current angle, the point (α, f(α)) and a thin line
    from M to it: add it, then animate `circle.alpha` from 0 to 2π. Drawn from the current angle at every frame (never
    accumulated), so it is right in every part of a parallel rendering. The axes need the circle's vertical scale:
    `Axes((0, 2 * PI, PI / 2), (-1, 1, 0.5), width=6.6, height=2 * circle.R)`, shifted so that y = 0 is at the circle's
    center.
    """
    # Both computed from the angle itself: an updater reading another object's position would lag one frame behind.
    target = lambda: axes.c2p(circle.alpha.get_value(), f(circle.alpha.get_value()))
    start = lambda: circle.p(math.cos(circle.alpha.get_value()), math.sin(circle.alpha.get_value()))
    point = Dot(radius=0.07).set_color(color).add_updater(lambda m: m.move_to(target()))
    link = Line(start(), target() + 1e-6 * RIGHT).set_stroke(GREY_B, 1.5)
    link.add_updater(lambda m: m.put_start_and_end_on(start(), target() + 1e-6 * RIGHT))
    curve = always_redraw(lambda: axes.get_graph(f, x_range=(0, max(circle.alpha.get_value(), 0.02), 0.02)).set_stroke(color, 4))
    return VGroup(curve, link, point)
