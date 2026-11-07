import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Correction } from "../src/app/corrections.js";
import { findPastExam, formatPastExams, listPastExamsOnDisk, parseExamName, parseExamPath, planImport, runImport, savePastExamFile, withAttempts } from "../src/app/pastexams.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "heig-exams-"));
process.env.HEIG_EXAMS_DIR = path.join(tmp, "exams");
after(() => rmSync(tmp, { recursive: true, force: true }));

test("file names of the archives say the course, the teacher, the year, the test and the role", () => {
  assert.deepEqual(parseExamName("MAD_JHH_24-25_TE1.pdf"), { course: "MAD", teacher: "JHH", year: "2024-2025", number: "TE1", variant: undefined, role: "filled" });
  assert.deepEqual(parseExamName("MAD_RTE_16-17_TE1_corrigé.pdf"), { course: "MAD", teacher: "RTE", year: "2016-2017", number: "TE1", variant: undefined, role: "solutions" });
  assert.equal(parseExamName("MAD_JHH_16-17_TE1_corrige_inclu.pdf")?.role, "included");
  assert.deepEqual(parseExamName("PRG1_GMB_23-24_TE1a_blanc.pdf"), { course: "PRG1", teacher: "GMB", year: "2023-2024", number: "TE1", variant: "a", role: "blank" });
  assert.equal(parseExamName("PRG1_GMB_21-22_TE2_vierge.pdf")?.role, "blank");
  assert.deepEqual(parseExamName("PRG1_21-22_EXA_partie2.pdf"), { course: "PRG1", teacher: undefined, year: "2021-2022", number: "EXA", variant: "partie2", role: "filled" });
  assert.equal(parseExamName("MAD_examen_14-15.pdf")?.number, "EXA");
  assert.equal(parseExamName("PRG1_GMB_23-24-TE3_blanc.pdf")?.number, "TE3");
  assert.equal(parseExamName("MAD_JHH_12-13_TE2_2.pdf")?.variant, "2");
  assert.equal(parseExamName("Labo_01.pdf"), undefined);
  assert.equal(parseExamName("Quiz_00 - corrige.pdf"), undefined);
  assert.equal(parseExamName("exercices recapitulatifs.pdf"), undefined);
});

test("paths of the tree: branch, year, exam, file, with an optional pages folder", () => {
  assert.deepEqual(parseExamPath("MAD/2024-2025/MAD_JHH_24-25_TE1/original.pdf"), { exam: "MAD/2024-2025/MAD_JHH_24-25_TE1", name: "original.pdf" });
  assert.deepEqual(parseExamPath("PRG1/INF1/2016-2017/INF1_RRH_16-17_TE1/pages/p01.png"), { exam: "PRG1/INF1/2016-2017/INF1_RRH_16-17_TE1", name: "pages/p01.png" });
  assert.equal(parseExamPath("MAD/2024-2025/original.pdf"), undefined, "no exam folder");
  assert.equal(parseExamPath("MAD/2024-2025/x/../original.pdf"), undefined);
  assert.equal(parseExamPath("MAD/2024-2025/x/.hidden.pdf"), undefined);
  assert.equal(parseExamPath("MAD/2024-2025/x/notes.txt"), undefined);
  assert.equal(parseExamPath("MAD/2024-2025/x/other/p.png"), undefined, "only a pages folder");
  assert.equal(parseExamPath("MAD/year/x/original.pdf"), undefined, "the year folder is YYYY-YYYY");
});

test("an archive folder is planned into one exam per test, originals named by role, then imported and listed", () => {
  const archive = path.join(tmp, "archive");
  const files = [
    "MAD/MAD/2024-2025/MAD_JHH_24-25_TE1.pdf",
    "MAD/MAD/2016-2017/MAD_JHH_16-17_TE2.pdf",
    "MAD/MAD/2016-2017/MAD_JHH_16-17_TE2_corrige_inclu.pdf",
    "MAD/MAD/2016-2017/MAD_JHH_16-17_TE1_corrige_inclu.pdf",
    "MAD/MAD/2016-2017/MAD_RTE_1A_16-17_TE1/MAD_RTE_16-17_TE1_corrigé.pdf",
    "MAD/MAD/2016-2017/MAD_RTE_1A_16-17_TE1/MAD_RTE_16-17_TE1.pdf",
    "PRG1/PRG1/2021-2022/PRG1_GMB_21-22_TE2_corrige.pdf",
    "PRG1/PRG1/2021-2022/PRG1_GMB_21-22_TE2_vierge.pdf",
    "PRG1/PRG1/2021-2022/PRG1_GMB_21-22_TE2.pdf",
    "PRG1/PRG1/INF1/2016-2017/INF1_OCE_16-17_TE3/INF_OCE_16-17_TE3.pdf",
    "PRG1/PRG1/INF1/2016-2017/INF1_GMB_Labos/01_repas.pdf",
    "PRG1/PRG1/Voir aussi BA2",
  ];
  for (const f of files) {
    mkdirSync(path.dirname(path.join(archive, f)), { recursive: true });
    writeFileSync(path.join(archive, f), `%PDF ${f}`);
  }
  const plan = planImport(path.join(archive, "MAD"));
  assert.deepEqual(plan.items.map((i) => [i.id, i.copies.map((c) => c.to).join(",")]), [
    ["MAD/2016-2017/MAD_JHH_16-17_TE1", "original.pdf"],
    ["MAD/2016-2017/MAD_JHH_16-17_TE2", "original.pdf,original-corrige.pdf"],
    ["MAD/2016-2017/MAD_RTE_16-17_TE1_1A", "original.pdf,original-corrige.pdf"],
    ["MAD/2024-2025/MAD_JHH_24-25_TE1", "original.pdf"],
  ]);
  assert.equal(plan.items[0].meta.solutionsIncluded, true, "a lone « corrigé inclus » scan stands for the original");
  assert.equal(plan.items[1].meta.sources["original-corrige.pdf"], "MAD/2016-2017/MAD_JHH_16-17_TE2_corrige_inclu.pdf");
  assert.equal(plan.items[2].meta.title, "MAD TE1 (1A) · 2016-2017 · RTE");
  assert.deepEqual(plan.skipped, []);

  const prg = planImport(path.join(archive, "PRG1"));
  assert.deepEqual(prg.items.map((i) => [i.id, i.copies.map((c) => c.to).join(","), i.meta.course]), [
    ["PRG1/2021-2022/PRG1_GMB_21-22_TE2", "original.pdf,original-vierge.pdf,original-corrige.pdf", "PRG1"],
    ["PRG1/INF1/2016-2017/INF1_OCE_16-17_TE3", "original.pdf", "INF1"],
  ]);
  assert.deepEqual(prg.skipped, ["PRG1/INF1/2016-2017/INF1_GMB_Labos/01_repas.pdf", "PRG1/Voir aussi BA2"]);

  const result = runImport(plan);
  assert.equal(result.imported.length, 4);
  assert.equal(runImport(plan).kept.length, 4, "a second import keeps what is there");
  runImport(prg);
  const meta = JSON.parse(readFileSync(path.join(process.env.HEIG_EXAMS_DIR!, "MAD/2016-2017/MAD_JHH_16-17_TE2/exam.json"), "utf-8"));
  assert.equal(meta.teacher, "JHH");

  savePastExamFile("MAD/2024-2025/MAD_JHH_24-25_TE1/enonce.md", Buffer.from("# TE1\n"));
  assert.throws(() => savePastExamFile("MAD/2024-2025/MAD_JHH_24-25_TE1/../x.md", Buffer.from("")), /not an acceptable/);
  const onDisk = listPastExamsOnDisk();
  assert.equal(onDisk.length, 6);
  const te1 = onDisk.find((e) => e.id === "MAD/2024-2025/MAD_JHH_24-25_TE1")!;
  assert.deepEqual([te1.branch, te1.year, te1.has.statement, te1.has.statementPdf, te1.has.original], [["MAD"], "2024-2025", true, false, true]);
  assert.deepEqual(onDisk.find((e) => e.id === "PRG1/INF1/2016-2017/INF1_OCE_16-17_TE3")!.branch, ["PRG1", "INF1"]);

  const correction = (id: string, exam: string, state: Correction["state"]): Correction => ({ id, title: id, state, exam, createdAt: new Date(`2026-11-0${id}T10:00:00Z`), updatedAt: new Date(), photos: [], result: state === "corrected" ? { summary: "", exercises: [{ number: "1", answer: "", verdict: "correct", feedback: "", topics: [], points: { obtained: 9, total: 10 } }] } : undefined });
  const exams = withAttempts(onDisk, [correction("1", "exam:MAD/2024-2025/MAD_JHH_24-25_TE1", "corrected"), correction("2", "exam:MAD/2016-2017/MAD_JHH_16-17_TE2", "received"), correction("3", "document:other", "corrected")]);
  assert.equal(exams.find((e) => e.id === te1.id)!.status, "done");
  assert.equal(exams.find((e) => e.id === te1.id)!.last!.score!.grade, 5.5);
  assert.equal(exams.find((e) => e.id === "MAD/2016-2017/MAD_JHH_16-17_TE2")!.status, "pending");
  assert.equal(exams[0].branch[0], "MAD", "sorted by branch, then the most recent year first");
  assert.equal(exams[0].year, "2024-2025");

  assert.equal(findPastExam(exams, "exam:MAD/2024-2025/MAD_JHH_24-25_TE1").id, te1.id);
  assert.equal(findPastExam(exams, "MAD_JHH_24-25_TE1").id, te1.id);
  assert.equal(findPastExam(exams, "mad 2024 te1").id, te1.id);
  assert.throws(() => findPastExam(exams, "MAD 2016-2017"), /Several/);
  assert.throws(() => findPastExam(exams, "RXI"), /No past exam/);
  assert.match(formatPastExams(exams), /## MAD\n2024-2025  MAD TE1 · 2024-2025 · JHH  \[scan, énoncé\]  done · 5\.5\/6/);
});
