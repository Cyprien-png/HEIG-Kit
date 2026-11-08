/**
 * Past exams (« anciens TE », docs/app.md): the scanned written tests of former years, filed by branch, year and test.
 *
 *   npm run exams -- import <folder> [--branch MAD] [--dry-run] [--overwrite]   files the PDFs of an archive folder (<branch>/<year>/<files>) into the exams folder
 *   npm run exams -- list [--branch PRG1] [--course INF1]                       the exams, with what each one has (scan, corrigé, énoncé…) and the student's attempts
 *   npm run exams -- show <id|words>                                            one exam: files, sources, attempts
 *   npm run exams -- pages <id> [--which original|vierge|corrige]              renders the pages of a scan as PNG images (pages/p01.png…) for the agent to read
 *   npm run exams -- render <id>                                                renders enonce.md and corrige.md as PDF next to them
 *   npm run exams -- push | pull | sync [--dry-run]                             syncs the exams folder with the remote server
 *   npm run exams -- where                                                      the exams folder
 *
 * On a computer connected to a server (HEIG_REMOTE_URL) `list` and `show` read the server; `import`, `pages` and
 * `render` work on this computer's folder, which `push` sends to the server.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type HeigApi, LocalApi, RemoteApi } from "../src/app/api.js";
import { type PastExam, examsDir, findPastExam, formatPastExams, listPastExamsOnDisk, planImport, renderPages, runImport, withAttempts } from "../src/app/pastexams.js";
import { ROOT } from "../src/paths.js";
import { migrate, openDb } from "../src/rag/db.js";
import { RemoteClient } from "../src/remote/client.js";
import { syncExams } from "../src/remote/exams.js";
import { formatReport } from "../src/remote/library.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    branch: { type: "string" },
    course: { type: "string" },
    which: { type: "string", default: "original" },
    "dry-run": { type: "boolean", default: false },
    overwrite: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
const [action = "list", arg] = positionals;

async function withApi<T>(use: (api: HeigApi) => Promise<T>): Promise<T> {
  const client = await RemoteClient.fromEnv();
  if (client) return use(new RemoteApi(client));
  const db = openDb();
  await migrate(db);
  try {
    return await use(new LocalApi(db));
  } finally {
    await db.end();
  }
}

const dated = (exams: Awaited<ReturnType<HeigApi["pastExams"]>>): PastExam[] =>
  exams.map((e) => ({ ...e, attempts: e.attempts.map((a) => ({ ...a, createdAt: new Date(a.createdAt), correctedAt: a.correctedAt ? new Date(a.correctedAt) : undefined })), last: e.last ? { ...e.last, createdAt: new Date(e.last.createdAt), correctedAt: e.last.correctedAt ? new Date(e.last.correctedAt) : undefined } : undefined }));

/** The exams of this computer's folder, without attempts (for the local commands). */
const local = () => withAttempts(listPastExamsOnDisk(), []);

async function main(): Promise<void> {
  switch (action) {
    case "where":
      return console.log(examsDir());
    case "import": {
      if (!arg) throw new Error("Usage: npm run exams -- import <folder> [--branch MAD] [--dry-run] [--overwrite]");
      const plan = planImport(path.resolve(arg), values.branch);
      console.log(`${plan.items.length} exam(s) found${plan.skipped.length ? `, ${plan.skipped.length} file(s) that are not written tests skipped` : ""}:`);
      for (const item of plan.items) console.log(`  ${item.id}  ←  ${item.copies.map((c) => `${path.basename(c.from)} → ${c.to}`).join(", ")}`);
      if (plan.skipped.length) console.log(`Skipped:\n  ${plan.skipped.join("\n  ")}`);
      if (values["dry-run"]) return console.log("\nDry run: nothing copied.");
      const result = runImport(plan, values.overwrite);
      return console.log(`\n${result.imported.length} exam(s) imported, ${result.kept.length} already there, in ${examsDir()}.\nNext: npm run exams -- push`);
    }
    case "list": {
      const exams = await withApi((api) => api.pastExams({ branch: values.branch, course: values.course }));
      return console.log(values.json ? JSON.stringify(exams, null, 2) : formatPastExams(dated(exams)));
    }
    case "show": {
      if (!arg) throw new Error("Usage: npm run exams -- show <id|words>");
      const exam = findPastExam(dated(await withApi((api) => api.pastExams())), arg);
      if (values.json) return console.log(JSON.stringify(exam, null, 2));
      console.log(`${exam.meta.title}\nid: exam:${exam.id}\nbranch: ${exam.branch.join(" / ")} · year ${exam.year}${exam.meta.solutionsIncluded ? " · solutions written in the scan" : ""}`);
      console.log(`files:\n${exam.files.map((f) => `  ${f.name}  (${Math.round(f.size / 1024)} kB, ${f.modifiedAt.slice(0, 10)})${exam.meta.sources[f.name] ? `  ← ${exam.meta.sources[f.name]}` : ""}`).join("\n")}`);
      console.log(`attempts: ${exam.attempts.length ? exam.attempts.map((a) => `${a.id} (${a.state}${a.score ? `, ${a.score.grade.toFixed(1)}/6` : ""})`).join(", ") : "none"}`);
      return console.log(`status: ${exam.status}${exam.has.statement ? "" : "\nNo énoncé yet: npm run exams -- pages <id>, read the pages, write enonce.md, then npm run exams -- render <id> && npm run exams -- push"}`);
    }
    case "pages": {
      if (!arg) throw new Error("Usage: npm run exams -- pages <id> [--which original|vierge|corrige]");
      const exam = findPastExam(local(), arg);
      const which = values.which === "vierge" ? "original-vierge.pdf" : values.which === "corrige" ? "original-corrige.pdf" : "original.pdf";
      const pages = renderPages(exam.id, which);
      const folder = path.join(examsDir(), ...exam.id.split("/"));
      return console.log(`${pages.length} page(s) of ${exam.id}/${which}:\n${pages.map((p) => path.join(folder, p)).join("\n")}`);
    }
    case "render": {
      if (!arg) throw new Error("Usage: npm run exams -- render <id>");
      const exam = findPastExam(local(), arg);
      const folder = path.join(examsDir(), ...exam.id.split("/"));
      const sources = ["enonce.md", "corrige.md"].filter((n) => existsSync(path.join(folder, n)));
      if (sources.length === 0) throw new Error(`No enonce.md nor corrige.md in ${folder}`);
      for (const source of sources) {
        const run = spawnSync(process.execPath, [path.join(ROOT, "node_modules", ".bin", "tsx"), path.join(ROOT, "modules", "documents", "render.ts"), path.join(folder, source), "--pdf", "--out", folder], { stdio: "inherit" });
        if (run.status !== 0) throw new Error(`Rendering ${source} failed`);
      }
      return console.log(`Rendered in ${folder}. Next: npm run exams -- push`);
    }
    case "push":
    case "pull":
    case "sync": {
      const client = await RemoteClient.fromEnv();
      if (!client) throw new Error("Set HEIG_REMOTE_URL in .env and run `npm run remote -- login` first");
      const direction = action === "sync" ? "both" : action;
      const report = await syncExams(client, direction, values["dry-run"], (line) => console.log(line));
      return console.log(formatReport(report, direction, values["dry-run"]));
    }
    default:
      throw new Error("Usage: npm run exams -- import <folder> | list | show <id> | pages <id> | render <id> | push | pull | sync | where");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
