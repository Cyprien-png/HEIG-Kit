/** Past exams sync between this computer's exams folder and the remote server (same rules as the library). */
import { readFile } from "node:fs/promises";
import { planSync } from "../app/library.js";
import { type ExamTreeFile, listPastExamFiles, pastExamFile, savePastExamFile } from "../app/pastexams.js";
import type { RemoteClient } from "./client.js";
import type { Direction, SyncReport } from "./library.js";

const encode = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export async function remoteExamFiles(client: RemoteClient): Promise<ExamTreeFile[]> {
  return (await client.get<{ files: ExamTreeFile[] }>("/api/past-exams/files")).files;
}

export async function uploadExamFile(client: RemoteClient, file: ExamTreeFile): Promise<void> {
  const local = pastExamFile(file.id);
  if (!local) throw new Error(`${file.id} is not a past exam file`);
  await client.request("PUT", `/api/past-exams/files/${encode(file.id)}`, { body: new Uint8Array(await readFile(local)), headers: { "Content-Type": "application/octet-stream", "X-File-Mtime": file.modifiedAt } });
}

export async function downloadExamFile(client: RemoteClient, file: ExamTreeFile): Promise<void> {
  const res = await client.request("GET", `/api/past-exams/files/${encode(file.id)}?download=1`);
  savePastExamFile(file.id, Buffer.from(await res.arrayBuffer()), new Date(file.modifiedAt));
}

/** Copies what each side lacks (or has an older copy of) in the asked direction; `dryRun` only plans. */
export async function syncExams(client: RemoteClient, direction: Direction, dryRun = false, log: (line: string) => void = () => {}): Promise<SyncReport<ExamTreeFile>> {
  const plan = planSync(listPastExamFiles(), await remoteExamFiles(client));
  const report: SyncReport<ExamTreeFile> = { plan, pushed: [], pulled: [] };
  if (dryRun) return report;
  if (direction !== "pull") {
    for (const file of plan.push) {
      log(`↑ ${file.id}`);
      await uploadExamFile(client, file);
      report.pushed.push(file.id);
    }
  }
  if (direction !== "push") {
    for (const file of plan.pull) {
      log(`↓ ${file.id}`);
      await downloadExamFile(client, file);
      report.pulled.push(file.id);
    }
  }
  return report;
}
