/**
 * Schedules `npm run rag:update` every day, so that new documents and the courses of a new semester are indexed
 * without thinking about it: a LaunchAgent on macOS, a systemd user timer (or cron) on Linux, a scheduled task on
 * Windows. A computer asleep at that time runs the update when it wakes up (macOS, systemd).
 *
 * Usage: npm run autoupdate [-- --time 08:00] [-- --uninstall]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../src/paths.js";

const LABEL = "ch.heig-kit.update";
const NAME = "heig-kit-update";

const uninstall = process.argv.includes("--uninstall");
const timeIndex = process.argv.indexOf("--time");
const time = timeIndex >= 0 ? (process.argv[timeIndex + 1] ?? "") : "08:00";
if (!uninstall && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid --time "${time}", expected HH:MM`);
const [hour, minute] = time.split(":").map(Number);

function run(command: string, args: string[], allowFailure = false): void {
  // Removing a task that does not exist yet fails harmlessly: keep its output quiet.
  const result = spawnSync(command, args, { stdio: allowFailure ? "ignore" : "inherit" });
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(" ")} failed`);
}

function macos(): void {
  const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  const domain = `gui/${os.userInfo().uid}`;
  run("launchctl", ["bootout", `${domain}/${LABEL}`], true);
  if (uninstall) {
    rmSync(plist, { force: true });
    return;
  }
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  mkdirSync(path.dirname(plist), { recursive: true });
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>WorkingDirectory</key><string>${escape(ROOT)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>/bin/sh</string><string>-c</string><string>npm run -s rag:update</string>
  </array>
  <!-- npm, node and docker are found through the PATH of the installation, so updating Node.js does not break the task. -->
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${escape(process.env.PATH ?? "/usr/bin:/bin")}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
`,
  );
  run("launchctl", ["bootstrap", domain, plist]);
}

function linux(): void {
  const units = path.join(os.homedir(), ".config", "systemd", "user");
  const hasSystemd = spawnSync("systemctl", ["--user", "--version"], { stdio: "ignore" }).status === 0;
  if (!hasSystemd) return cron();

  const service = path.join(units, `${NAME}.service`);
  const timer = path.join(units, `${NAME}.timer`);
  run("systemctl", ["--user", "disable", "--now", `${NAME}.timer`], true);
  if (uninstall) {
    rmSync(service, { force: true });
    rmSync(timer, { force: true });
    return;
  }
  mkdirSync(units, { recursive: true });
  writeFileSync(
    service,
    `[Unit]\nDescription=HEIG-Kit knowledge base update\n\n[Service]\nType=oneshot\nWorkingDirectory=${ROOT}\n` +
      `Environment="PATH=${process.env.PATH}"\nExecStart=/bin/sh -c "npm run -s rag:update"\n`,
  );
  writeFileSync(
    timer,
    `[Unit]\nDescription=Daily HEIG-Kit knowledge base update\n\n[Timer]\nOnCalendar=*-*-* ${time}:00\nPersistent=true\n\n` +
      `[Install]\nWantedBy=timers.target\n`,
  );
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", `${NAME}.timer`]);
}

function cron(): void {
  const current = spawnSync("crontab", ["-l"], { encoding: "utf-8" }).stdout ?? "";
  const kept = current.split("\n").filter((line) => line.trim() && !line.includes(`# ${NAME}`));
  if (!uninstall) {
    kept.push(`${minute} ${hour} * * * cd "${ROOT}" && PATH="${process.env.PATH}" npm run -s rag:update # ${NAME}`);
  }
  execFileSync("crontab", ["-"], { input: `${kept.join("\n")}\n` });
}

function windows(): void {
  const task = "HEIG-Kit update";
  run("schtasks", ["/Delete", "/TN", task, "/F"], true);
  if (uninstall) return;
  run("schtasks", ["/Create", "/SC", "DAILY", "/TN", task, "/ST", time, "/F", "/TR", `cmd /c cd /d "${ROOT}" && npm.cmd run -s rag:update`]);
}

if (process.platform === "darwin") macos();
else if (process.platform === "win32") windows();
else linux();

console.log(
  uninstall
    ? "Daily knowledge base update removed."
    : `Daily knowledge base update scheduled at ${time}. Log: ${path.join("data", "logs", "update.log")}` +
        (existsSync(path.join(ROOT, ".env")) ? "" : "\nWarning: .env is missing, the update will fail until it is configured."),
);
