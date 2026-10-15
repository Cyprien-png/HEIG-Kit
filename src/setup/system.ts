import { spawnSync } from "node:child_process";

export type PackageManager = "brew" | "winget" | "apt" | "dnf" | "pacman";

/** System packages the modules may need, by package manager. */
const PACKAGES: Record<string, Partial<Record<PackageManager, string[]>>> = {
  ffmpeg: { brew: ["ffmpeg"], winget: ["Gyan.FFmpeg"], apt: ["ffmpeg"], dnf: ["ffmpeg-free"], pacman: ["ffmpeg"] },
  pandoc: { brew: ["pandoc"], winget: ["JohnMacFarlane.Pandoc"], apt: ["pandoc"], dnf: ["pandoc"], pacman: ["pandoc"] },
  git: { brew: ["git"], winget: ["Git.Git"], apt: ["git"], dnf: ["git"], pacman: ["git"] },
  python: {
    brew: ["python@3.12"],
    winget: ["Python.Python.3.12"],
    apt: ["python3", "python3-venv", "python3-dev"],
    dnf: ["python3", "python3-devel"],
    pacman: ["python"],
  },
  docker: { brew: ["--cask", "docker"], winget: ["Docker.DockerDesktop"] },
  // Libraries the headless Chromium of the documents module needs on Linux.
  "chrome-libs": {
    apt: ["libnss3", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0", "libxcomposite1", "libxdamage1", "libxrandr2", "libgbm1", "libpango-1.0-0", "libcairo2", "libasound2t64"],
    dnf: ["nss", "atk", "at-spi2-atk", "cups-libs", "libdrm", "libxkbcommon", "libXcomposite", "libXdamage", "libXrandr", "mesa-libgbm", "pango", "alsa-lib"],
    pacman: ["nss", "atk", "at-spi2-atk", "libcups", "libdrm", "libxkbcommon", "libxcomposite", "libxdamage", "libxrandr", "mesa", "pango", "alsa-lib"],
  },
  // Libraries ManimGL builds against on Linux (OpenGL, Cairo, Pango).
  "manim-libs": {
    apt: ["libcairo2-dev", "libpango1.0-dev", "pkg-config", "libgl1-mesa-dev", "xvfb"],
    dnf: ["cairo-devel", "pango-devel", "pkgconf-pkg-config", "mesa-libGL-devel", "xorg-x11-server-Xvfb"],
    pacman: ["cairo", "pango", "pkgconf", "mesa", "xorg-server-xvfb"],
    brew: ["pkg-config", "cairo", "pango"],
  },
};

export const isWindows = process.platform === "win32";
/** npm executable: the npm.ps1 shim of Windows PowerShell can swallow arguments, npm.cmd does not. */
export const NPM = isWindows ? "npm.cmd" : "npm";

export function commandExists(command: string): boolean {
  const probe = isWindows ? spawnSync("where", [command], { stdio: "ignore" }) : spawnSync("sh", ["-c", `command -v "${command}"`], { stdio: "ignore" });
  return probe.status === 0;
}

export function detectPackageManager(): PackageManager | undefined {
  if (process.platform === "darwin") return commandExists("brew") ? "brew" : undefined;
  if (isWindows) return commandExists("winget") ? "winget" : undefined;
  return (["apt", "dnf", "pacman"] as const).find((pm) => commandExists(pm === "apt" ? "apt-get" : pm));
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Capture the output instead of showing it. */
  quiet?: boolean;
}

/** Runs a command, showing its output; throws when it fails. */
export function run(command: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf-8",
    shell: isWindows,
  });
  if (result.status !== 0) {
    throw new Error(`\`${[command, ...args].join(" ")}\` failed${result.stderr ? `: ${result.stderr.trim().slice(-500)}` : ""}`);
  }
  return result.stdout ?? "";
}

/** Installs a system package with the OS package manager (Homebrew, winget, apt, dnf or pacman). */
export function installPackage(name: string): void {
  const pm = detectPackageManager();
  const packages = pm && PACKAGES[name]?.[pm];
  if (!pm) throw new Error(`No supported package manager found to install ${name}: ${packageManagerHint()}`);
  if (!packages) throw new Error(`${name} cannot be installed automatically with ${pm}: install it manually`);
  console.log(`  installing ${name} with ${pm}…`);
  switch (pm) {
    case "brew":
      return void run("brew", ["install", ...packages]);
    case "winget":
      for (const id of packages) {
        run("winget", ["install", "--id", id, "-e", "--accept-source-agreements", "--accept-package-agreements"]);
      }
      return;
    case "apt":
      run("sudo", ["apt-get", "update"]);
      return void run("sudo", ["apt-get", "install", "-y", ...packages]);
    case "dnf":
      return void run("sudo", ["dnf", "install", "-y", ...packages]);
    case "pacman":
      return void run("sudo", ["pacman", "-S", "--needed", "--noconfirm", ...packages]);
  }
}

/** Installs `name` unless `command` is already available. */
export function ensureCommand(command: string, name = command): void {
  if (commandExists(command)) return;
  installPackage(name);
  if (!commandExists(command) && !isWindows) {
    throw new Error(`${command} is still not available after installing ${name}: open a new terminal and run the setup again`);
  }
}

export function packageManagerHint(): string {
  if (process.platform === "darwin") return "install Homebrew from https://brew.sh";
  if (isWindows) return "install App Installer (winget) from the Microsoft Store";
  return "use a distribution with apt, dnf or pacman";
}

/** Opens a file with the default application of the OS. */
export function openFile(file: string): void {
  if (process.platform === "darwin") run("open", [file], { quiet: true });
  else if (isWindows) run("cmd", ["/c", "start", '""', `"${file}"`], { quiet: true });
  else run("xdg-open", [file], { quiet: true });
}

function dockerRunning(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore", shell: isWindows }).status === 0;
}

/** Starts Docker Desktop if needed (macOS, Windows) and waits up to 3 minutes for the Docker engine. */
export async function ensureDockerRunning(): Promise<void> {
  if (dockerRunning()) return;
  if (process.platform === "darwin") spawnSync("open", ["-ga", "Docker"]);
  else if (isWindows) spawnSync("cmd", ["/c", "start", '""', '"%ProgramFiles%\\Docker\\Docker\\Docker Desktop.exe"'], { shell: true });
  for (let i = 0; i < 36 && !dockerRunning(); i++) await new Promise((resolve) => setTimeout(resolve, 5000));
  if (!dockerRunning()) {
    throw new Error("Docker is not running: start Docker Desktop (accept its terms on first launch), then run the command again");
  }
}
