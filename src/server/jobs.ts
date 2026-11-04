/**
 * Rendering queue of the remote server. Rendering runs code written by the AI (manim scenes, HTML in a browser), so it
 * happens in a worker container without network and secrets (src/server/worker.ts). They only share a folder holding one
 * subfolder per job: this side writes the request; everything coming back is treated as untrusted data.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import { outputDir } from "../vendor.js";

export type JobState = "queued" | "running" | "done" | "failed";

export type JobRequest =
  | { kind: "document"; name: string; formats: ("pdf" | "docx" | "html")[] }
  | { kind: "animation"; name: string; scene: string; quality: "low" | "medium" | "high"; voice: boolean };

export interface JobRecord {
  id: string;
  kind: JobRequest["kind"];
  name: string;
  state: JobState;
  createdAt: number;
  /** Source file saved in the output folder: `documents/x.md` or `videos/x.py`. */
  source: string;
  /** Generated files: `videos/Scene.mp4`. */
  files: string[];
  log: string;
  /** The worker's key frames were kept. */
  frames: boolean;
}

export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** File names accepted back from the worker. */
const SAFE_NAME = /^[\p{L}\p{N}_-][\p{L}\p{N}._-]*$/u;
const ALLOWED = { document: new Set([".pdf", ".docx", ".html"]), animation: new Set([".mp4", ".mov", ".gif"]) };
const MAX_ACTIVE = 3;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 4 * 1024 ** 3;
const MAX_STATUS_BYTES = 256 * 1024;
const MAX_FRAMES_BYTES = 32 * 1024 ** 2;
const TIMEOUT_MS = 60 * 60_000;

/** A regular file, never a link the worker could have left to reach something else. */
function regularFile(file: string, maxBytes: number): boolean {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && stat.size <= maxBytes;
  } catch {
    return false;
  }
}

/** File name safe on every OS, without extension. */
export function safeBaseName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|-+$/g, "").slice(0, 100) || "document";
}

export class JobQueue {
  private readonly records: string;

  constructor(private readonly jobsDir: string, recordsDir = path.join(DATA_DIR, "jobs")) {
    this.records = recordsDir;
    mkdirSync(this.records, { recursive: true, mode: 0o700 });
    mkdirSync(this.jobsDir, { recursive: true });
  }

  private recordFile(id: string): string {
    return path.join(this.records, `${id}.json`);
  }

  private save(record: JobRecord): void {
    const partial = `${this.recordFile(record.id)}.partial`;
    writeFileSync(partial, JSON.stringify(record));
    renameSync(partial, this.recordFile(record.id));
  }

  private all(): JobRecord[] {
    return readdirSync(this.records)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(this.records, f), "utf-8")) as JobRecord);
  }

  /** The source is saved in the output folder, so that list_generated finds it; the job appears atomically to the worker. */
  submit(request: JobRequest, sourceName: string, content: string, videos: string[] = []): JobRecord {
    if (this.all().filter((r) => r.state === "queued" || r.state === "running").length >= MAX_ACTIVE) {
      throw new Error("Too many renderings are already waiting: try again when one has finished (get_job)");
    }
    const id = randomUUID();
    const kind = request.kind === "document" ? "documents" : "videos";
    const folder = outputDir(kind);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, sourceName), content);

    const temp = path.join(this.jobsDir, `.incoming-${id}`);
    const input = path.join(temp, "input", kind);
    mkdirSync(input, { recursive: true });
    writeFileSync(path.join(input, sourceName), content);
    if (videos.length > 0) {
      const copies = path.join(temp, "input", "videos");
      mkdirSync(copies, { recursive: true });
      for (const video of videos) copyFileSync(video, path.join(copies, path.basename(video)));
    }
    writeFileSync(path.join(temp, "request.json"), JSON.stringify({ ...request, source: `input/${kind}/${sourceName}` }));
    const record: JobRecord = { id, kind: request.kind, name: request.name, state: "queued", createdAt: Date.now(), source: `${kind}/${sourceName}`, files: [], log: "", frames: false };
    this.save(record);
    renameSync(temp, path.join(this.jobsDir, id));
    return record;
  }

  /** The videos of the output folder that a Markdown document embeds: the only ones the worker gets to see. */
  embeddedVideos(markdown: string): string[] {
    const found = new Set<string>();
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+\.(?:mp4|webm|mov|m4v))\)/gi)) {
      const name = path.basename(decodeURI(match[1]));
      const file = path.join(outputDir("videos"), name);
      if (!name.startsWith(".") && regularFile(file, MAX_FILE_BYTES)) found.add(file);
    }
    return [...found];
  }

  get(id: string): JobRecord | undefined {
    if (!JOB_ID.test(id)) return undefined;
    this.collect();
    const file = this.recordFile(id);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as JobRecord) : undefined;
  }

  /** Jobs queued for more than five minutes without being taken: the render container is probably not running. */
  staleJobs(): number {
    return this.all().filter((r) => r.state === "queued" && Date.now() - r.createdAt > 5 * 60_000).length;
  }

  /** The most recent jobs, newest first. */
  recent(limit = 20): JobRecord[] {
    this.collect();
    return this.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  framesFile(id: string): string {
    return path.join(this.records, `${id}.png`);
  }

  /** Brings back what the worker finished. Run regularly, and before answering about a job. */
  collect(): void {
    for (const record of this.all()) {
      if (record.state === "queued" || record.state === "running") this.collectOne(record);
    }
  }

  private collectOne(record: JobRecord): void {
    const dir = path.join(this.jobsDir, record.id);
    const statusFile = path.join(dir, "status.json");
    let status: { state?: unknown; log?: unknown; files?: unknown; frames?: unknown } | undefined;
    if (regularFile(statusFile, MAX_STATUS_BYTES)) {
      try {
        status = JSON.parse(readFileSync(statusFile, "utf-8"));
      } catch {
        // Being written, or corrupted: looked at again next time, until the job times out.
      }
    }
    const log = typeof status?.log === "string" ? status.log.slice(-12_000) : "";

    if (status?.state === "done" || status?.state === "failed") {
      const files = status.state === "done" ? this.bringBack(record, dir, status.files) : [];
      const failed = status.state === "failed" || files.length === 0;
      const frames = !failed && this.bringBackFrames(record, dir);
      this.save({ ...record, state: failed ? "failed" : "done", files, log: log || (failed ? "The worker produced no usable file." : ""), frames });
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (Date.now() - record.createdAt > TIMEOUT_MS) {
      this.save({ ...record, state: "failed", log: "Timed out: the render worker did not finish this job." });
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (status?.state === "running" && record.state !== "running") this.save({ ...record, state: "running" });
  }

  private bringBack(record: JobRecord, dir: string, listed: unknown): string[] {
    if (!Array.isArray(listed)) return [];
    const kind = record.kind === "document" ? "documents" : "videos";
    const destination = outputDir(kind);
    mkdirSync(destination, { recursive: true });
    const files: string[] = [];
    for (const name of listed.slice(0, MAX_FILES)) {
      if (typeof name !== "string" || !SAFE_NAME.test(name) || !ALLOWED[record.kind].has(path.extname(name).toLowerCase())) continue;
      const source = path.join(dir, "output", name);
      if (!regularFile(source, MAX_FILE_BYTES)) continue;
      const partial = path.join(destination, `.${name}.partial`);
      copyFileSync(source, partial);
      renameSync(partial, path.join(destination, name));
      files.push(`${kind}/${name}`);
    }
    return files;
  }

  private bringBackFrames(record: JobRecord, dir: string): boolean {
    const source = path.join(dir, "output", "frames.png");
    if (!regularFile(source, MAX_FRAMES_BYTES)) return false;
    copyFileSync(source, this.framesFile(record.id));
    return true;
  }
}
