import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MOODS, NEUTRAL_VIDEO, type ThemeConfig, alpha, contrast, courseColor, courseTheme, detectCourse, hexToHsl, hslToHex } from "../themes/index.js";

const config: ThemeConfig = { mood: "nuit", aliases: { ANA: "ANA1" }, courses: { ANA1: { color: "#10b981" }, RXI: { color: "#ec4899", mood: "neon" } } };
const shipped = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "themes", "themes.json"), "utf8")) as ThemeConfig;

const hueGap = (a: string, b: string) => {
  const d = Math.abs(hexToHsl(a)[0] - hexToHsl(b)[0]);
  return Math.min(d, 360 - d);
};

test("a color survives the conversion to HSL and back", () => {
  for (const hex of ["#ec4899", "#10b981", "#070b18", "#ffffff", "#000000"]) assert.equal(hslToHex(...hexToHsl(hex)), hex);
  assert.equal(alpha("#121c3a", 0.85), "rgba(18,28,58,0.85)");
});

test("a course has the color of the settings, under any of its codes", () => {
  assert.equal(courseColor("rxi", config), "#ec4899");
  assert.equal(courseColor("ANA", config), "#10b981", "an alias is the same course");
  assert.equal(courseTheme(" ana ", config).course, "ANA1");
  assert.equal(courseColor("XYZ", config), courseColor("xyz", config), "a course without settings keeps one color");
});

test("the mood comes from the course, then from the settings, and an explicit one wins", () => {
  assert.equal(courseTheme("RXI", config).mood, "neon");
  assert.equal(courseTheme("ANA1", config).mood, "nuit");
  assert.equal(courseTheme("RXI", config, "encre").mood, "encre");
  assert.throws(() => courseTheme("RXI", config, "disco"), /Unknown mood "disco"/);
  assert.notDeepEqual(courseTheme("RXI", config, "encre").video, courseTheme("RXI", config, "neon").video);
});

test("without a course, a video keeps the look it always had", () => {
  assert.deepEqual(courseTheme(undefined, config).video, NEUTRAL_VIDEO);
  assert.equal(courseTheme("", config).course, null);
});

test("the course is read from the start of a name, a title or a comment, and only when it is a known one", () => {
  assert.equal(detectCourse(["rxi-ch5-masque-sous-reseau"], config), "RXI");
  assert.equal(detectCourse([undefined, "ANA-limite-sin5x.py"], config), "ANA1");
  assert.equal(detectCourse(["RXI – Labo 2b « Performances »"], config), "RXI");
  assert.equal(detectCourse(["Limite en moins l'infini", "notes"], config), null);
  assert.equal(detectCourse(["rxitruc-video"], config), null, "a word that only starts like a code is not the course");
});

test("the courses of the shipped settings are told apart at a glance, in every mood", () => {
  const codes = Object.keys(shipped.courses ?? {});
  assert.ok(codes.length >= 2);
  for (const [i, a] of codes.entries()) {
    for (const b of codes.slice(i + 1)) assert.ok(hueGap(courseColor(a, shipped), courseColor(b, shipped)) >= 25, `${a} and ${b} have close colors`);
  }
  assert.ok(MOODS[shipped.mood ?? "nuit"], "the mood of the settings exists");
});

test("every theme stays readable: text and accent on the backgrounds, second colors away from the accent", () => {
  for (const code of Object.keys(shipped.courses ?? {})) {
    for (const mood of Object.keys(MOODS)) {
      const { video: v, doc } = courseTheme(code, shipped, mood);
      const where = `${code} in ${mood}`;
      assert.ok(contrast(v.text, v.panel) >= 7, `text on a panel, ${where}`);
      assert.ok(contrast(v.one, v.panel) >= 4.5, `accent on a panel, ${where}`);
      assert.ok(contrast(v.dim, v.bg1) >= 4.5, `dim text on the background, ${where}`);
      for (const second of [v.sel, v.varA, v.varB]) {
        assert.match(second, /^#[0-9a-f]{6}$/, `three second colors, ${where}`);
        assert.ok(hueGap(second, v.one) > 30, `${second} is too close to the accent, ${where}`);
      }
      assert.equal(new Set([v.sel, v.varA, v.varB]).size, 3);
      assert.ok(contrast(doc.ink, "#ffffff") >= 7 && contrast(doc.accent, "#ffffff") >= 4.5, `document colors on paper, ${where}`);
      assert.ok(contrast(courseTheme(code, shipped).chip.text, "#ffffff") >= 4.5, `chip text in the light app, ${where}`);
    }
  }
});
