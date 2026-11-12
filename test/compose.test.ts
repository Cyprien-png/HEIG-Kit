import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPOSE_FILE, GPU_COMPOSE_FILE, type GpuProbe, composeArgs, detectNvidiaGpu, dockerRuntimes, gpuMode, useGpu } from "../src/compose.js";

const NVIDIA_DOCKER = JSON.stringify({ Runtimes: { "io.containerd.runc.v2": {}, nvidia: { path: "nvidia-container-runtime" }, runc: {} } });
const PLAIN_DOCKER = JSON.stringify({ Runtimes: { "io.containerd.runc.v2": {}, runc: {} } });

/** A probe answering as a machine would, counting the calls. */
function probe(nvidiaSmi: boolean, dockerInfo: string | undefined): GpuProbe & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    nvidiaSmi: () => (calls.push("nvidia-smi"), nvidiaSmi),
    dockerInfo: () => (calls.push("docker info"), dockerInfo),
  };
}

const UP = ["up", "-d", "--build", "--wait"];

test("HEIG_GPU is auto by default, and accepts nvidia and cpu in any case", () => {
  assert.equal(gpuMode(undefined), "auto");
  assert.equal(gpuMode(""), "auto");
  assert.equal(gpuMode(" Auto "), "auto");
  assert.equal(gpuMode("NVIDIA"), "nvidia");
  assert.equal(gpuMode("cpu"), "cpu");
  assert.throws(() => gpuMode("cuda"), /HEIG_GPU must be auto, nvidia or cpu/);
});

test("auto: the GPU file is added on a machine with an NVIDIA GPU that Docker can use", () => {
  assert.equal(useGpu(UP, "auto", probe(true, NVIDIA_DOCKER)), true);
});

test("auto: no GPU file without an NVIDIA GPU, and Docker is not even asked", () => {
  const mac = probe(false, PLAIN_DOCKER);
  assert.equal(useGpu(UP, "auto", mac), false);
  assert.deepEqual(mac.calls, ["nvidia-smi"]);
});

test("auto: no GPU file when Docker cannot give the GPU to containers or does not answer", () => {
  assert.equal(useGpu(UP, "auto", probe(true, PLAIN_DOCKER)), false);
  assert.equal(useGpu(UP, "auto", probe(true, undefined)), false);
  assert.equal(useGpu(UP, "auto", probe(true, "not json")), false);
});

test("nvidia: the GPU file is always added, without detection", () => {
  const machine = probe(false, undefined);
  assert.equal(useGpu(UP, "nvidia", machine), true);
  assert.deepEqual(machine.calls, []);
});

test("cpu: the GPU file is never added, without detection", () => {
  const machine = probe(true, NVIDIA_DOCKER);
  assert.equal(useGpu(UP, "cpu", machine), false);
  assert.deepEqual(machine.calls, []);
});

test("commands that create no container skip the detection", () => {
  for (const args of [["--profile", "ingest", "down"], ["stop", "docling"], ["--profile", "server", "pull", "server", "render"], ["ps"]]) {
    const machine = probe(true, NVIDIA_DOCKER);
    assert.equal(useGpu(args, "auto", machine), false, args.join(" "));
    assert.deepEqual(machine.calls, []);
  }
  assert.equal(useGpu(["--profile", "server", "up", "-d", "--wait"], "auto", probe(true, NVIDIA_DOCKER)), true);
  assert.equal(useGpu(["config"], "nvidia"), true);
});

test("the GPU file comes after the main file and before the command", () => {
  assert.deepEqual(composeArgs(["--profile", "server", "up", "-d"], true), ["compose", "-f", COMPOSE_FILE, "-f", GPU_COMPOSE_FILE, "--profile", "server", "up", "-d"]);
  assert.deepEqual(composeArgs(["up", "-d"], false), ["compose", "-f", COMPOSE_FILE, "up", "-d"]);
});

test("Docker runtimes are read from docker info", () => {
  assert.deepEqual(dockerRuntimes(NVIDIA_DOCKER), ["io.containerd.runc.v2", "nvidia", "runc"]);
  assert.deepEqual(dockerRuntimes(JSON.stringify({ ServerVersion: "29.0" })), []);
  assert.deepEqual(dockerRuntimes(undefined), []);
  assert.equal(detectNvidiaGpu(probe(true, NVIDIA_DOCKER)), true);
});
