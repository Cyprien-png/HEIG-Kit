/**
 * Installs shell shortcuts for the HEIG-Kit commands, usable from any directory:
 * `heig:planning`, `heig:deadlines`, `heig:courses`, `heig:course` on macOS/Linux (zsh, bash), and
 * `heig-planning`, … on Windows (PowerShell does not allow `:` in command names).
 *
 * Usage: npm run aliases [-- --uninstall]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../src/paths.js";

const BEGIN = "# >>> heig-kit aliases >>>";
const END = "# <<< heig-kit aliases <<<";

/** Shortcut name (without prefix) → npm script and the arguments it always gets. */
const COMMANDS: Record<string, string> = {
  planning: "schedule -- --table",
  deadlines: "deadlines --",
  courses: "courses --",
  course: "course --",
};

async function main(): Promise<void> {
  const uninstall = process.argv.includes("--uninstall");
  const targets = process.platform === "win32" ? powershellProfiles() : unixRcFiles();
  if (targets.length === 0) throw new Error("No supported shell configuration found (zsh, bash or PowerShell).");

  for (const { file, block } of targets) {
    const current = existsSync(file) ? await readFile(file, "utf-8") : "";
    const updated = withBlock(current, uninstall ? "" : block);
    if (updated === current) {
      console.log(`${file}: nothing to change`);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, updated);
    console.log(`${file}: ${uninstall ? "shortcuts removed" : "shortcuts installed"}`);
  }

  if (!uninstall) {
    const names = Object.keys(COMMANDS).map((name) => (process.platform === "win32" ? `heig-${name}` : `heig:${name}`));
    console.log(`\nOpen a new terminal, then use: ${names.join(", ")}`);
  }
}

/** zsh and bash configuration files of the current user, with alias definitions. */
function unixRcFiles(): { file: string; block: string }[] {
  const home = os.homedir();
  const shell = path.basename(process.env.SHELL ?? "");
  const lines = Object.entries(COMMANDS).map(
    ([name, script]) => `alias heig:${name}=${shellQuote(`npm --prefix ${shellQuote(ROOT)} run -s ${script}`)}`,
  );
  const block = [BEGIN, ...lines, END].join("\n");

  const files = new Set<string>();
  if (shell === "zsh" || existsSync(path.join(home, ".zshrc"))) files.add(path.join(home, ".zshrc"));
  if (shell === "bash" || existsSync(path.join(home, ".bashrc"))) files.add(path.join(home, ".bashrc"));
  // Terminal windows on macOS start bash as a login shell, which reads ~/.bash_profile rather than ~/.bashrc.
  if (process.platform === "darwin" && (shell === "bash" || existsSync(path.join(home, ".bash_profile")))) {
    files.add(path.join(home, ".bash_profile"));
  }
  return [...files].map((file) => ({ file, block }));
}

/** Profiles of Windows PowerShell and PowerShell 7 (when installed), with function definitions. */
function powershellProfiles(): { file: string; block: string }[] {
  const lines = Object.entries(COMMANDS).map(
    // npm.cmd rather than npm: the npm.ps1 shim can swallow the `--` separating npm's options from the script's.
    ([name, script]) => `function heig-${name} { npm.cmd --prefix '${ROOT.replace(/'/g, "''")}' run -s ${script} @args }`,
  );
  const block = [BEGIN, ...lines, END].join("\r\n");

  const files = new Set<string>();
  for (const exe of ["powershell.exe", "pwsh.exe"]) {
    try {
      const file = execFileSync(exe, ["-NoProfile", "-Command", "$PROFILE.CurrentUserCurrentHost"], { encoding: "utf-8" });
      if (file.trim()) files.add(file.trim());
    } catch {
      // This PowerShell edition is not installed.
    }
  }
  return [...files].map((file) => ({ file, block }));
}

/** Replaces the marked block in `content` (or appends it); an empty block removes it. */
function withBlock(content: string, block: string): string {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  const rest =
    start >= 0 && end > start ? content.slice(0, start) + content.slice(end + END.length).replace(/^\r?\n/, "") : content;
  if (!block) return rest;
  return `${rest}${rest && !rest.endsWith("\n") ? "\n" : ""}${block}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
