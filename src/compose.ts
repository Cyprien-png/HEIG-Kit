/**
 * Docker Compose commands of the services in rag/compose.yml, shared by the npm scripts (scripts/compose.ts), the CLI and
 * the setup. rag/compose.gpu.yml gives the NVIDIA GPU to the embedder; it is added according to HEIG_GPU in .env:
 * "auto" (default) when nvidia-smi finds a GPU and Docker has the nvidia runtime, "nvidia" always, "cpu" never.
 * Docker cannot create the embedder with a GPU that is not there, so in doubt the embedder runs on the processor.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./paths.js";
import { isWindows } from "./setup/system.js";

export const COMPOSE_FILE = path.join(ROOT, "rag", "compose.yml");
export const GPU_COMPOSE_FILE = path.join(ROOT, "rag", "compose.gpu.yml");

export type GpuMode = "auto" | "nvidia" | "cpu";

/** The commands that create containers or show the configuration: the only ones the GPU file changes. */
const GPU_COMMANDS = new Set(["up", "create", "run", "config"]);
/** A probe that hangs (Docker Desktop starting, a stuck driver) must not hold the command up. */
const PROBE_TIMEOUT_MS = 10_000;

export function gpuMode(value = process.env.HEIG_GPU): GpuMode {
  const mode = value?.trim().toLowerCase() || "auto";
  if (mode === "auto" || mode === "nvidia" || mode === "cpu") return mode;
  throw new Error(`HEIG_GPU must be auto, nvidia or cpu in .env (it is "${value}")`);
}

/** What the automatic detection looks at, replaced in the tests. */
export interface GpuProbe {
  /** Whether `nvidia-smi -L` finds a GPU (an NVIDIA GPU and its driver). */
  nvidiaSmi(): boolean;
  /** Output of `docker info --format json`, undefined when Docker does not answer. */
  dockerInfo(): string | undefined;
}

export const systemProbe: GpuProbe = {
  nvidiaSmi: () => {
    const result = spawnSync("nvidia-smi", ["-L"], { stdio: "ignore", timeout: PROBE_TIMEOUT_MS, shell: isWindows });
    return result.status === 0;
  },
  dockerInfo: () => {
    const result = spawnSync("docker", ["info", "--format", "json"], { encoding: "utf-8", timeout: PROBE_TIMEOUT_MS, shell: isWindows });
    return result.status === 0 ? result.stdout : undefined;
  },
};

/** Container runtimes of `docker info --format json` (e.g. runc, nvidia); none when it cannot be read. */
export function dockerRuntimes(info: string | undefined): string[] {
  if (!info) return [];
  try {
    const runtimes = (JSON.parse(info) as { Runtimes?: unknown }).Runtimes;
    return runtimes && typeof runtimes === "object" ? Object.keys(runtimes) : [];
  } catch {
    return [];
  }
}

/** An NVIDIA GPU Docker can give to containers. nvidia-smi first: machines without one never wait for Docker. */
export function detectNvidiaGpu(probe: GpuProbe = systemProbe): boolean {
  return probe.nvidiaSmi() && dockerRuntimes(probe.dockerInfo()).includes("nvidia");
}

/** Whether a compose command with these arguments gets the GPU file; detects the GPU only when it matters. */
export function useGpu(args: string[], mode: GpuMode = gpuMode(), probe: GpuProbe = systemProbe): boolean {
  if (mode === "cpu" || !args.some((arg) => GPU_COMMANDS.has(arg))) return false;
  return mode === "nvidia" || detectNvidiaGpu(probe);
}

/** Arguments of `docker` for `docker compose <args>` on the HEIG-Kit services. */
export function composeArgs(args: string[], gpu: boolean): string[] {
  return ["compose", "-f", COMPOSE_FILE, ...(gpu ? ["-f", GPU_COMPOSE_FILE] : []), ...args];
}

/** Runs `docker compose <args>` on the HEIG-Kit services, showing its output; throws when it fails. */
export function runCompose(...args: string[]): void {
  const mode = gpuMode();
  const gpu = useGpu(args, mode);
  if (args.includes("up")) {
    console.error(
      gpu
        ? "Embedding model on the NVIDIA GPU (rag/compose.gpu.yml)"
        : `Embedding model on the processor (${mode === "cpu" ? "HEIG_GPU=cpu" : "no NVIDIA GPU available to Docker; HEIG_GPU=nvidia forces it"})`,
    );
  }
  const result = spawnSync("docker", composeArgs(args, gpu), { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`\`docker compose ${args.join(" ")}\` failed`);
}
