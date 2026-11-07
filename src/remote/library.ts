/** Library sync between this computer's output folder and the remote server. */
import { readFile } from "node:fs/promises";
import { type LibraryFile, type SyncFile, type SyncPlan, libraryFile, listLibraryFiles, planSync, saveLibraryFile } from "../app/library.js";
import type { RemoteClient } from "./client.js";

export type Direction = "push" | "pull" | "both";

export interface SyncReport<T extends SyncFile = LibraryFile> {
  plan: SyncPlan<T>;
  pushed: string[];
  pulled: string[];
}

export async function remoteFiles(client: RemoteClient): Promise<LibraryFile[]> {
  return (await client.get<{ files: LibraryFile[] }>("/api/library/files")).files;
}

export async function uploadFile(client: RemoteClient, file: LibraryFile): Promise<void> {
  const local = libraryFile(file.id);
  if (!local) throw new Error(`${file.id} is not a library file`);
  await client.request("PUT", `/api/library/files/${file.id}`, { body: new Uint8Array(await readFile(local)), headers: { "Content-Type": "application/octet-stream", "X-File-Mtime": file.modifiedAt } });
}

export async function downloadFile(client: RemoteClient, file: LibraryFile): Promise<void> {
  const res = await client.request("GET", `/api/library/files/${file.id}?download=1`);
  saveLibraryFile(file.id, Buffer.from(await res.arrayBuffer()), new Date(file.modifiedAt));
}

/** Copies what each side lacks (or has an older copy of) in the asked direction; `dryRun` only plans. */
export async function syncLibrary(client: RemoteClient, direction: Direction, dryRun = false, log: (line: string) => void = () => {}): Promise<SyncReport> {
  const plan = planSync(listLibraryFiles(), await remoteFiles(client));
  const report: SyncReport = { plan, pushed: [], pulled: [] };
  if (dryRun) return report;
  if (direction !== "pull") {
    for (const file of plan.push) {
      log(`↑ ${file.id}`);
      await uploadFile(client, file);
      report.pushed.push(file.id);
    }
  }
  if (direction !== "push") {
    for (const file of plan.pull) {
      log(`↓ ${file.id}`);
      await downloadFile(client, file);
      report.pulled.push(file.id);
    }
  }
  return report;
}

export function formatReport<T extends SyncFile>(report: SyncReport<T>, direction: Direction, dryRun: boolean): string {
  const lines: string[] = [];
  const verb = dryRun ? "would be" : "";
  if (direction !== "pull") lines.push(`${report.plan.push.length} file(s) ${verb} sent to the server${report.plan.push.length ? `: ${report.plan.push.map((f) => f.id).join(", ")}` : ""}`);
  if (direction !== "push") lines.push(`${report.plan.pull.length} file(s) ${verb} fetched from the server${report.plan.pull.length ? `: ${report.plan.pull.map((f) => f.id).join(", ")}` : ""}`);
  return lines.join("\n");
}
