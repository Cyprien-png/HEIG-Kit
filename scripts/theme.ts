/**
 * The graphic charter of the courses (themes/, docs/themes.md): one color per course, one mood for the backgrounds.
 *
 *   npm run theme                                  the courses, their colors and the moods
 *   npm run theme -- show RXI [--mood neon]        every color of a course
 *   npm run theme -- set RXI --color "#ec4899"     color of a course (adds the course if it is new)
 *   npm run theme -- set RXI --mood neon           mood of one course; --mood default goes back to the general one
 *   npm run theme -- mood encre                    mood of every course that has none of its own
 *   npm run theme -- preview                       a page showing every course in every mood, opened in the browser
 *
 * The settings are themes/themes.json, a file of the repository: commit it, and the server shows the same colors once
 * updated.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MOODS, alpha, courseTheme } from "../themes/index.js";
import { CACHE_DIR } from "../src/paths.js";
import { describeThemes, readThemeConfig, setTheme, themeFor } from "../src/themes.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { color: { type: "string" }, mood: { type: "string" } } });
const [command, arg] = positionals;

/** One card per course and mood, drawn like a video (background, halos, header, panel, chips) and like a document. */
function previewPage(): string {
  const config = readThemeConfig();
  const cards = Object.keys(config.courses ?? {})
    .sort()
    .map((code) => {
      const moods = Object.keys(MOODS).map((mood) => {
        const { video: v } = courseTheme(code, config, mood);
        return `<div class="video" style="background: radial-gradient(420px 280px at 55% 35%, ${v.bg1}, ${v.bg0} 70%); color: ${v.text}">
  <div class="halo" style="left: -60px; bottom: -90px; background: radial-gradient(${alpha(v.haloA, Math.min(0.6, 0.2 * v.halo))}, transparent 70%)"></div>
  <div class="halo" style="right: -70px; top: -100px; background: radial-gradient(${alpha(v.haloB, Math.min(0.5, 0.13 * v.halo))}, transparent 70%)"></div>
  <div class="tag" style="color: ${v.one}">${code} · ${mood}</div><div class="title">Titre de la scène</div>
  <div class="panel" style="background: ${alpha(v.panel, 0.85)}; border-color: ${v.line}; border-left-color: ${v.one}">
    <span style="color: ${v.one}">accent</span> <span style="color: ${v.sel}">sélection</span> <span style="color: ${v.varA}">A</span> <span style="color: ${v.varB}">B</span> <span style="color: ${v.dim}">discret</span>
  </div></div>`;
      });
      const { doc, chip, color, mood } = courseTheme(code, config);
      return `<section><h2><span class="dot" style="background: ${color}"></span>${code} <small>${color} · mood ${mood}</small></h2>
<div class="row">${moods.join("")}
<div class="doc"><div style="color: ${doc.ink}; border-bottom: 3px solid ${doc.accent}; font-weight: 700; padding-bottom: 4px">Document ${code}</div>
  <div style="margin-top: 8px; border: 1px solid ${doc.rule}"><div style="background: ${doc.soft}; color: ${doc.ink}; padding: 3px 8px; font-weight: 600">Tableau</div><div style="padding: 3px 8px">valeur</div></div>
  <div style="margin-top: 8px"><span class="chip" style="background: ${chip.soft}; color: ${chip.text}; border-color: ${chip.bg}">${code}</span> calendrier</div></div>
</div></section>`;
    });
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Thèmes des cours</title><style>
  body { font: 14px system-ui, sans-serif; margin: 24px; background: #f3f4f6; color: #111827; } h2 { margin: 26px 0 10px; } small { font-weight: 400; color: #6b7280; }
  .dot { display: inline-block; width: 14px; height: 14px; border-radius: 7px; margin-right: 8px; } .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .video { position: relative; overflow: hidden; width: 300px; height: 170px; border-radius: 12px; padding: 14px 16px; box-sizing: border-box; }
  .halo { position: absolute; width: 300px; height: 300px; border-radius: 50%; } .tag { position: relative; font-size: 10px; letter-spacing: 2px; font-weight: 600; text-transform: uppercase; }
  .title { position: relative; font-size: 19px; font-weight: 700; margin-top: 2px; } .panel { position: relative; margin-top: 26px; padding: 9px 12px; border: 1px solid; border-left-width: 4px; border-radius: 9px; font-weight: 700; font-size: 13px; }
  .doc { width: 220px; height: 170px; box-sizing: border-box; background: #fff; border-radius: 12px; padding: 14px 16px; font-size: 13px; } .chip { border: 1px solid; border-radius: 6px; padding: 1px 7px; font-weight: 600; font-size: 12px; }
</style><h1>Thèmes des cours</h1><p>Mood général : <b>${config.mood}</b>. Chaque ligne montre un cours dans les ${Object.keys(MOODS).length} moods (${Object.keys(MOODS).join(", ")}), puis ses couleurs de document et de calendrier.</p>${cards.join("")}</html>`;
}

try {
  if (!command || command === "list") console.log(describeThemes(process.stdout.isTTY && !process.env.NO_COLOR));
  else if (command === "show" && arg) console.log(JSON.stringify(themeFor(arg, [], values.mood), null, 2));
  else if (command === "set" && arg && (values.color || values.mood)) {
    const theme = setTheme({ course: arg, color: values.color, mood: values.mood === "default" ? null : values.mood });
    console.log(`${theme.course}: ${theme.color}, mood ${theme.mood}`);
  } else if (command === "mood" && arg) {
    setTheme({ mood: arg });
    console.log(describeThemes(process.stdout.isTTY && !process.env.NO_COLOR));
  } else if (command === "preview") {
    const file = path.join(CACHE_DIR, "tmp", "themes.html");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, previewPage());
    console.log(file);
    if (process.platform === "darwin") spawnSync("open", [file]);
    else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", '""', file], { shell: true });
    else spawnSync("xdg-open", [file], { stdio: "ignore" });
  } else {
    console.error('Usage: npm run theme -- [list | show <COURSE> [--mood <name>] | set <COURSE> [--color "#rrggbb"] [--mood <name>|default] | mood <name> | preview]');
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
