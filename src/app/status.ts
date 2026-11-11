/** What the status page shows: services, login state, syncs, ingestion, recent requests. */
import { existsSync } from "node:fs";
import type { Db } from "../rag/db.js";
import { embedderStatus } from "../rag/embed.js";
import { isDoclingAvailable } from "../rag/extract.js";
import type { JobQueue } from "../server/jobs.js";
import { webDir } from "../server/api/static.js";
import type { RequestLog } from "./requests.js";
import { snapshotAges } from "./snapshots.js";
import { type IngestCheck, type SyncRun, lastOkRuns, lastRuns, sessionState } from "./sync.js";

export interface ServiceStatus {
  id: string;
  label: string;
  state: "up" | "down" | "warning" | "off";
  detail?: string;
}

export interface StatusReport {
  at: string;
  services: ServiceStatus[];
  login: {
    sessionSavedAt?: string;
    cyberlearnToken: boolean;
    /** edu-ID asked for a two-step code: the user must reconnect from the page. */
    needsCode: boolean;
    lastGapsOk?: string;
    lastCyberlearnOk?: string;
  };
  syncs: SyncRun[];
  snapshots: Record<string, { fetchedAt: string; checkedAt: string }>;
  ingestion: {
    documents: number;
    chunks: number;
    courses: number;
    lastIndexedAt?: string;
    pending?: IngestCheck & { checkedAt: Date | string };
  };
  requests: { total: number; errors: number; unauthorized: number; lastUnauthorizedAt?: string; lastMcpAt?: string };
  syncing: boolean;
}

export interface StatusDeps {
  db: Db;
  requests: RequestLog;
  queue?: JobQueue;
  jobsDir?: string;
  syncing: boolean;
}

export async function collectStatus(deps: StatusDeps): Promise<StatusReport> {
  const { db } = deps;
  const services: ServiceStatus[] = [];

  let dbUp = false;
  try {
    await db.query("SELECT 1");
    dbUp = true;
  } catch {
    dbUp = false;
  }
  services.push({ id: "db", label: "Base de données", state: dbUp ? "up" : "down" });

  const embedder = await embedderStatus();
  services.push({ id: "embedder", label: "Embeddings (Ollama, bge-m3)", state: !embedder.up ? "down" : embedder.model ? "up" : "warning", detail: embedder.up && !embedder.model ? "modèle bge-m3 absent" : undefined });

  const docling = await isDoclingAvailable();
  services.push({ id: "docling", label: "Extraction (docling)", state: docling ? "up" : "off", detail: docling ? undefined : "démarré seulement pendant une ingestion" });

  if (deps.queue && deps.jobsDir) {
    const stale = deps.queue.staleJobs();
    services.push({
      id: "render",
      label: "Rendu isolé (render)",
      state: existsSync(deps.jobsDir) ? (stale > 0 ? "warning" : "up") : "down",
      detail: stale > 0 ? `${stale} travail(aux) en attente depuis plus de 5 min : le conteneur render tourne-t-il ?` : undefined,
    });
  } else {
    services.push({ id: "render", label: "Rendu isolé (render)", state: "off", detail: "HEIG_JOBS_DIR non défini" });
  }
  services.push({ id: "web", label: "Application web", state: webDir() ? "up" : "off" });

  const runs = dbUp ? await lastRuns(db) : [];
  const okRun = (kind: string) => runs.find((r) => r.kind === kind && r.ok)?.finishedAt;
  const lastOkByKind = dbUp ? await lastOkRuns(db) : {};
  const session = sessionState();
  const needsCode = session.pendingCode || runs.some((r) => r.ok === false && r.stats?.needsCode === true);

  const ingestRow = dbUp
    ? (
        await db.query(
          `SELECT (SELECT count(*) FROM documents WHERE removed_at IS NULL)::int AS documents,
                  (SELECT count(*) FROM chunks)::int AS chunks,
                  (SELECT count(DISTINCT course_code) FROM documents WHERE removed_at IS NULL)::int AS courses,
                  (SELECT max(indexed_at) FROM documents) AS last_indexed`,
        )
      ).rows[0]
    : { documents: 0, chunks: 0, courses: 0, last_indexed: null };
  const check = runs.find((r) => r.kind === "ingest-check" && r.ok)?.stats as (IngestCheck & { checkedAt: string }) | undefined;

  const ages = dbUp ? await snapshotAges(db) : {};
  return {
    at: new Date().toISOString(),
    services,
    login: {
      sessionSavedAt: session.sessionSavedAt?.toISOString(),
      cyberlearnToken: session.cyberlearnToken,
      needsCode,
      lastGapsOk: (lastOkByKind.gaps ?? okRun("gaps"))?.toISOString(),
      lastCyberlearnOk: (lastOkByKind.cyberlearn ?? okRun("cyberlearn"))?.toISOString(),
    },
    syncs: runs,
    snapshots: Object.fromEntries(Object.entries(ages).map(([k, v]) => [k, { fetchedAt: v.fetchedAt.toISOString(), checkedAt: v.checkedAt.toISOString() }])),
    ingestion: {
      documents: ingestRow.documents,
      chunks: ingestRow.chunks,
      courses: ingestRow.courses,
      lastIndexedAt: ingestRow.last_indexed ? new Date(ingestRow.last_indexed).toISOString() : undefined,
      pending: check,
    },
    requests: await summarize(deps.requests),
    syncing: deps.syncing,
  };
}

async function summarize(requests: RequestLog): Promise<StatusReport["requests"]> {
  try {
    const s = await requests.summary();
    return { ...s, lastUnauthorizedAt: s.lastUnauthorizedAt?.toISOString(), lastMcpAt: s.lastMcpAt?.toISOString() };
  } catch {
    return { total: 0, errors: 0, unauthorized: 0 };
  }
}
