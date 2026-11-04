/**
 * Calendar, flashcards, corrections and profile from the terminal (used by the heig:* skills). On a computer connected
 * to a server (HEIG_REMOTE_URL) everything happens there; otherwise in the local database.
 *
 *   npm run calendar -- [--from D] [--to D] [--kind exam] [--course MAD] [--calendar <id|name>] [--json]   events (default: 14 days)
 *   npm run calendar -- show <key>                                                 one event with its details
 *   npm run calendar -- add "TE 2 MAD" 2026-12-05T08:30 [--end …] [--kind exam] [--course MAD] [--location B01] [--calendar …]
 *   npm run calendar -- set <key> [--title …] [--start …] [--end …] [--location …] [--kind …] [--calendar …]
 *   npm run calendar -- remove <key> | reset <key> | history <key> | overrides
 *   npm run calendar -- calendars | calendars add "Révision MAD" [--color #7c3aed] [--description …]
 *   npm run calendar -- calendars set <id> [--name …] [--color …] [--description …] [--visible true|false] | calendars remove <id>
 *   npm run calendar -- import plan.json      a calendar with its events: {"calendar": {"name", "color", "description"} | "<id|name>", "events": [...]}
 *   npm run cards -- [list [--course MAD]] | show <deck id> | create "Title" --course MAD --file cards.json
 *   npm run cards -- add <deck id> --file cards.json | study [<deck id>] | delete-deck <id> | delete-card <id>
 *   npm run correction -- new "Série 3 MAD" [--course MAD] [--topic …] [--notes …]   creates it and prints the QR code
 *   npm run correction -- list | show <id> [--photos <dir>] | link <id> | submit <id> --file result.json | delete <id>
 *   npm run profile -- [--course MAD] [--json] | notes [--course …] [--kind …] [--query …] | add --file notes.json | resolve <id>
 *   npm run quiz -- [list [--course RXI]] | show <id> | create --file quiz.json | play <id> [--shuffle] | result <attempt id> | delete <id>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { type HeigApi, LocalApi, RemoteApi } from "../src/app/api.js";
import { formatProfile } from "../src/app/profile.js";
import { TIME_ZONE } from "../src/dates.js";
import { migrate, openDb } from "../src/rag/db.js";
import { RemoteClient } from "../src/remote/client.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string" },
    to: { type: "string" },
    kind: { type: "string" },
    course: { type: "string" },
    topic: { type: "string" },
    notes: { type: "string" },
    title: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    location: { type: "string" },
    url: { type: "string" },
    details: { type: "string" },
    calendar: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
    description: { type: "string" },
    visible: { type: "string" },
    file: { type: "string" },
    photos: { type: "string" },
    query: { type: "string" },
    limit: { type: "string" },
    json: { type: "boolean", default: false },
    "all-day": { type: "boolean", default: false },
    shuffle: { type: "boolean", default: false },
  },
});

const [command, action, ...rest] = positionals;
const when = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** Local times without offset are Europe/Zurich, like everywhere in HEIG-Kit. */
function isoLocal(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) || !/T/.test(value)) return value;
  const probe = new Date(`${value}Z`);
  const offset = -new Date(probe.toLocaleString("en-US", { timeZone: TIME_ZONE })).getTime() + new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(probe.getTime() + offset).toISOString();
}

function readJsonFile<T>(file: string | undefined, what: string): T {
  if (!file) throw new Error(`--file <${what}.json> is required`);
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

const out = (value: unknown) => console.log(values.json ? JSON.stringify(value, null, 2) : value);

async function openApi(): Promise<{ api: HeigApi; close: () => Promise<void> }> {
  const remote = await RemoteClient.fromEnv();
  if (remote) return { api: new RemoteApi(remote), close: async () => {} };
  const db = openDb();
  await migrate(db).catch((error: unknown) => {
    throw new Error(`Database unreachable: run \`npm run rag:start\`, or set HEIG_REMOTE_URL to use your server (${error instanceof Error ? error.message : error})`);
  });
  return { api: new LocalApi(db, { author: "user" }), close: () => db.end() };
}

type EventJson = Awaited<ReturnType<HeigApi["calendarList"]>>[number];
type CalendarJson = Awaited<ReturnType<HeigApi["calendars"]>>[number];

/** A calendar by id, built-in slug or name, as typed on the command line. */
async function pickCalendar(api: HeigApi, ref: string | undefined): Promise<CalendarJson | undefined> {
  if (!ref) return undefined;
  const calendars = await api.calendars();
  const found = calendars.find((c) => String(c.id) === ref || c.slug === ref || c.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new Error(`No calendar "${ref}". Calendars: ${calendars.map((c) => `${c.id} ${c.name}`).join(", ")}`);
  return found;
}

async function calendar(api: HeigApi): Promise<void> {
  const names = new Map(
    (
      await api.calendars().catch((error: unknown) => {
        if ((error as { status?: number }).status === 404) throw new Error("This server does not know calendars yet: update it (npm run server:update on the server).");
        throw error;
      })
    ).map((c) => [c.id, c.name]),
  );
  const fmt = (events: EventJson[]) =>
    events.length === 0
      ? "No events."
      : events.map((e) => `${when.format(new Date(e.startsAt))}${e.endsAt ? `–${time.format(new Date(e.endsAt))}` : ""}  ${e.kind.padEnd(8)} ${(e.course ?? "").padEnd(6)} ${e.title}${e.location ? ` @ ${e.location}` : ""}  [${names.get(e.calendarId) ?? e.calendarId}]${e.overridden ? "  (modified by hand)" : e.source === "manual" ? "  (manual)" : ""}\n    key: ${e.key}`).join("\n");
  const fmtCalendars = (calendars: CalendarJson[]) => calendars.map((c) => `${String(c.id).padStart(3)}  ${c.visible ? "●" : "○"} ${c.color}  ${c.name}${c.slug ? `  (built in: ${c.slug})` : ""}${c.description ? `\n       ${c.description}` : ""}`).join("\n");
  const kind = values.kind as "lesson" | "deadline" | "exam" | "event" | undefined;
  const calendarId = (await pickCalendar(api, values.calendar))?.id;
  switch (action) {
    case undefined:
    case "list": {
      const from = values.from ? new Date(values.from) : new Date(new Date().setHours(0, 0, 0, 0));
      const to = values.to ? new Date(new Date(values.to).getTime() + (/T/.test(values.to) ? 0 : 86_400_000)) : new Date(from.getTime() + 14 * 86_400_000);
      const events = await api.calendarList(from.toISOString(), to.toISOString(), { kinds: kind ? [kind] : undefined, course: values.course, calendars: calendarId ? [calendarId] : undefined });
      return out(values.json ? events : fmt(events));
    }
    case "show": {
      if (!rest[0]) throw new Error("Usage: npm run calendar -- show <key>");
      const versions = await api.calendarHistory(rest[0]);
      const event = versions[0];
      if (!event || event.deleted) throw new Error(`No event ${rest[0]}`);
      return out(values.json ? event : `${fmt([event])}${event.url ? `\n    ${event.url}` : ""}${event.details ? `\n\n${event.details}` : ""}`);
    }
    case "add": {
      const [title, start] = rest;
      if (!title || !start) throw new Error('Usage: npm run calendar -- add "Title" <start> [--end …] [--kind exam] [--course MAD] [--calendar <id|name>]');
      return out(fmt([await api.calendarAdd({ kind: kind ?? "event", title, course: values.course, startsAt: isoLocal(start)!, endsAt: isoLocal(values.end), allDay: values["all-day"], location: values.location, url: values.url, details: values.details, calendarId })]));
    }
    case "set": {
      if (!rest[0]) throw new Error("Usage: npm run calendar -- set <key> [--title …] [--start …] [--end …] [--location …] [--kind …] [--course …] [--calendar …]");
      return out(fmt([await api.calendarUpdate(rest[0], { kind, title: values.title, course: values.course, startsAt: isoLocal(values.start), endsAt: isoLocal(values.end), location: values.location, url: values.url, details: values.details, allDay: values["all-day"] || undefined, calendarId })]));
    }
    case "remove":
      if (!rest[0]) throw new Error("Usage: npm run calendar -- remove <key>");
      await api.calendarRemove(rest[0]);
      return out(`Removed ${rest[0]}`);
    case "reset": {
      if (!rest[0]) throw new Error("Usage: npm run calendar -- reset <key>");
      const event = await api.calendarReset(rest[0]);
      return out(event ? fmt([event]) : "Manual changes forgotten.");
    }
    case "history": {
      if (!rest[0]) throw new Error("Usage: npm run calendar -- history <key>");
      const versions = await api.calendarHistory(rest[0]);
      return out(values.json ? versions : versions.map((v) => `${v.fetchedAt}  ${v.source}/${v.author}${v.deleted ? " deleted" : ""}  ${v.title}  ${v.startsAt}${v.endsAt ? ` → ${v.endsAt}` : ""}${v.location ? ` @ ${v.location}` : ""}  [${names.get(v.calendarId) ?? v.calendarId}]`).join("\n"));
    }
    case "overrides": {
      const events = await api.calendarOverrides();
      return out(values.json ? events : fmt(events));
    }
    case "calendars": {
      const [sub, ...args] = rest;
      if (!sub) return out(values.json ? await api.calendars() : fmtCalendars(await api.calendars()));
      if (sub === "add") {
        if (!args[0]) throw new Error('Usage: npm run calendar -- calendars add "Name" [--color #7c3aed] [--description …]');
        const created = await api.calendarCreate({ name: args[0], color: values.color, description: values.description });
        return out(values.json ? created : fmtCalendars([created]));
      }
      const target = await pickCalendar(api, args[0]);
      if (!target) throw new Error("Usage: npm run calendar -- calendars [add | set <id> | remove <id>]");
      if (sub === "set") {
        const visible = values.visible === undefined ? undefined : values.visible !== "false";
        const edited = await api.calendarEdit(target.id, { name: values.name, color: values.color, description: values.description, visible });
        return out(values.json ? edited : fmtCalendars([edited]));
      }
      if (sub === "remove") {
        await api.calendarDelete(target.id);
        return out(`Removed calendar ${target.name} and its events.`);
      }
      throw new Error("Usage: npm run calendar -- calendars [add | set <id> | remove <id>]");
    }
    case "import": {
      interface Plan {
        calendar?: string | { name: string; color?: string; description?: string };
        events: { kind?: "lesson" | "deadline" | "exam" | "event"; title: string; course?: string; start: string; end?: string; allDay?: boolean; location?: string; url?: string; details?: string }[];
      }
      const plan = readJsonFile<Plan>(rest[0] ?? values.file, "plan");
      const target = typeof plan.calendar === "object" ? await api.calendarCreate(plan.calendar) : await pickCalendar(api, plan.calendar);
      const added: EventJson[] = [];
      for (const e of plan.events ?? []) {
        added.push(await api.calendarAdd({ kind: e.kind ?? "event", title: e.title, course: e.course, startsAt: isoLocal(e.start)!, endsAt: isoLocal(e.end), allDay: e.allDay, location: e.location, url: e.url, details: e.details, calendarId: target?.id }));
      }
      if (target) names.set(target.id, target.name);
      return out(`${target ? `Calendar ${target.id} "${target.name}"\n` : ""}${fmt(added)}`);
    }
    default:
      throw new Error("Usage: npm run calendar -- [list] | show | add | set | remove | reset | history | overrides | calendars | import");
  }
}

async function cards(api: HeigApi): Promise<void> {
  switch (action) {
    case undefined:
    case "list": {
      const decks = await api.decks(values.course);
      return out(values.json ? decks : decks.length === 0 ? "No decks." : decks.map((d) => `[${d.id}] ${d.course ? `${d.course} · ` : ""}${d.title}: ${d.cards} cards, ${d.due} due, ${d.fresh} new`).join("\n"));
    }
    case "show": {
      const deck = await api.deck(Number(rest[0]));
      if (!deck) throw new Error(`No deck ${rest[0]}`);
      return out(values.json ? deck : [`# ${deck.title} (${deck.course ?? "-"})`, ...deck.cardList.map((c) => `[${c.id}] ${c.front}\n    → ${c.back}`)].join("\n"));
    }
    case "create": {
      if (!rest[0]) throw new Error('Usage: npm run cards -- create "Title" --course MAD --file cards.json');
      const list = readJsonFile<{ cards?: unknown[] } | unknown[]>(values.file, "cards");
      const deck = await api.createDeck({ title: rest[0], course: values.course, description: values.details }, (Array.isArray(list) ? list : (list.cards ?? [])) as never);
      return out(`Deck ${deck.id} "${deck.title}" created with ${deck.cards} cards.`);
    }
    case "add": {
      const list = readJsonFile<{ cards?: unknown[] } | unknown[]>(values.file, "cards");
      const added = await api.addCards(Number(rest[0]), (Array.isArray(list) ? list : (list.cards ?? [])) as never);
      return out(`${added.length} cards added.`);
    }
    case "study": {
      const queue = await api.study(rest[0] ? Number(rest[0]) : undefined, values.limit ? Number(values.limit) : undefined);
      return out(values.json ? queue : queue.length === 0 ? "Nothing due." : queue.map((c) => `[${c.id}] ${c.front}`).join("\n"));
    }
    case "delete-deck":
      return out((await api.deleteDeck(Number(rest[0]))) ? "Deck deleted." : "No such deck.");
    case "delete-card":
      return out((await api.deleteCard(Number(rest[0]))) ? "Card deleted." : "No such card.");
    default:
      throw new Error("Usage: npm run cards -- [list] | show | create | add | study | delete-deck | delete-card");
  }
}

async function correction(api: HeigApi): Promise<void> {
  switch (action) {
    case "new": {
      if (!rest[0]) throw new Error('Usage: npm run correction -- new "Série 3 MAD" [--course MAD] [--topic …] [--notes …]');
      const c = await api.createCorrection({ title: rest[0], course: values.course, topic: values.topic, notes: values.notes });
      if (values.json) return out(c);
      console.log(`Correction ${c.id} created. Scan this code with your phone to photograph your work:\n`);
      console.log(await QRCode.toString(c.captureUrl, { type: "terminal", small: true }));
      console.log(`Link (valid 6 hours): ${c.captureUrl}`);
      return;
    }
    case "link": {
      if (!rest[0]) throw new Error("Usage: npm run correction -- link <id>");
      const link = await api.captureLink(rest[0]);
      if (values.json) return out({ captureUrl: link });
      console.log(await QRCode.toString(link, { type: "terminal", small: true }));
      return console.log(link);
    }
    case undefined:
    case "list": {
      const list = await api.corrections({ course: values.course });
      return out(values.json ? list : list.length === 0 ? "No corrections." : list.map((c) => `${c.id}  ${c.state.padEnd(9)} ${(c.course ?? "").padEnd(6)} ${c.title}  (${c.photos.length} photos, ${c.createdAt.slice(0, 16)})`).join("\n"));
    }
    case "show": {
      if (!rest[0]) throw new Error("Usage: npm run correction -- show <id> [--photos <folder>]");
      const c = await api.correction(rest[0]);
      if (!c) throw new Error(`No correction ${rest[0]}`);
      if (values.photos) {
        mkdirSync(values.photos, { recursive: true });
        const saved: string[] = [];
        for (const [i, p] of (await api.correctionPhotos(c.id)).entries()) {
          const file = path.join(values.photos, `${String(i + 1).padStart(2, "0")}-${p.id}.${p.contentType.split("/")[1].replace("jpeg", "jpg")}`);
          writeFileSync(file, p.data);
          saved.push(file);
        }
        if (!values.json) console.log(`Photos saved:\n${saved.join("\n")}`);
      }
      return out(values.json ? c : `${c.title} (${c.course ?? "-"}) · ${c.state} · ${c.photos.length} photos${c.notes ? `\nNotes: ${c.notes}` : ""}${c.result ? `\n\n${c.result.summary}\n${c.result.exercises.map((e) => `- ${e.number}: ${e.verdict}${e.cause ? ` (${e.cause})` : ""}`).join("\n")}` : ""}`);
    }
    case "submit": {
      if (!rest[0]) throw new Error("Usage: npm run correction -- submit <id> --file result.json");
      const result = readJsonFile<{ result?: unknown }>(values.file, "result");
      const c = await api.submitCorrection(rest[0], ((result as { result?: unknown }).result ?? result) as never);
      return out(`Correction ${c.id} stored: ${c.result?.exercises.length} exercises.`);
    }
    case "delete":
      return out((await api.deleteCorrection(rest[0] ?? "")) ? "Correction deleted." : "No such correction.");
    default:
      throw new Error("Usage: npm run correction -- new | list | show | link | submit | delete");
  }
}

async function profile(api: HeigApi): Promise<void> {
  switch (action) {
    case undefined:
    case "summary": {
      const summary = await api.profile(values.course);
      return out(values.json ? summary : formatProfile(summary as never));
    }
    case "notes": {
      const notes = values.query ? await api.searchNotes(values.query, values.course) : await api.profileNotes({ course: values.course, kind: values.kind as never, topic: values.topic });
      return out(values.json ? notes : notes.length === 0 ? "No notes." : notes.map((n) => `[${n.id}] ${n.createdAt.slice(0, 10)}  ${(n.course ?? "").padEnd(6)} ${n.kind.padEnd(8)} ${n.topic}: ${n.text}`).join("\n"));
    }
    case "add": {
      const list = readJsonFile<{ notes?: unknown[] } | unknown[]>(values.file, "notes");
      return out(`${(await api.addNotes((Array.isArray(list) ? list : (list.notes ?? [])) as never)).length} notes recorded.`);
    }
    case "resolve":
      return out((await api.resolveNote(Number(rest[0]))) ? "Note resolved." : "No such note.");
    default:
      throw new Error("Usage: npm run profile -- [summary] | notes | add | resolve");
  }
}

async function quiz(api: HeigApi): Promise<void> {
  type Result = Awaited<ReturnType<HeigApi["finishQuiz"]>>;
  const fmtResult = (r: Result) => {
    const lines = [`${r.quiz.course ? `${r.quiz.course} · ` : ""}${r.quiz.title}: ${r.attempt.score}/${r.attempt.total}${r.attempt.finishedAt ? "" : " (en cours)"}`];
    for (const a of r.answers) lines.push(`  ${a.correct ? "✓" : "✗"} ${a.position}. ${a.statement}  [${a.expected ? "VRAI" : "FAUX"}${a.answer === undefined ? ", sans réponse" : a.correct ? "" : `, répondu ${a.answer ? "vrai" : "faux"}`}]${!a.correct && a.explanation ? `\n      ${a.explanation}${a.source ? ` (${a.source})` : ""}` : ""}`);
    return lines.join("\n");
  };
  switch (action) {
    case undefined:
    case "list": {
      const quizzes = await api.quizzes(values.course);
      return out(values.json ? quizzes : quizzes.length === 0 ? "No quizzes." : quizzes.map((q) => `[${q.id}] ${(q.course ?? "").padEnd(6)} ${q.title}: ${q.questions} questions, ${q.attempts} attempts${q.last ? `, last ${q.last.score}/${q.last.total}` : ""}${q.best ? `, best ${q.best.score}/${q.best.total}` : ""}`).join("\n"));
    }
    case "show": {
      const q = await api.quiz(Number(rest[0]));
      if (!q) throw new Error(`No quiz ${rest[0]}`);
      return out(values.json ? q : `[${q.id}] ${q.course ? `${q.course} · ` : ""}${q.title}${q.description ? `\n${q.description}` : ""}\n${q.questionList.map((x) => `${x.position}. ${x.statement} → ${x.answer ? "VRAI" : "FAUX"}${x.explanation ? `\n   ${x.explanation}` : ""}${x.source ? ` (${x.source})` : ""}`).join("\n")}`);
    }
    case "create": {
      const plan = readJsonFile<{ title: string; course?: string; description?: string; questions: { statement: string; answer: boolean; explanation?: string; source?: string; topic?: string }[] }>(values.file, "quiz");
      const q = await api.createQuiz({ title: plan.title, course: plan.course ?? values.course, description: plan.description }, plan.questions);
      return out(`Quiz ${q.id} "${q.title}" created with ${q.questionList.length} questions.`);
    }
    case "play": {
      if (!rest[0]) throw new Error("Usage: npm run quiz -- play <id> [--shuffle]");
      let progress = await api.startQuiz(Number(rest[0]), "cli", values.shuffle);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (progress.next) {
          const reply = (await rl.question(`${progress.next.position}/${progress.attempt.total}  ${progress.next.statement}\n  vrai (v) / faux (f) / quitter (q) > `)).trim().toLowerCase();
          if (reply.startsWith("q")) break;
          if (!/^[vfyntojn]/.test(reply)) continue;
          const answer = /^[vyotj]/.test(reply);
          const r = await api.answerQuiz(progress.attempt.id, answer, progress.next.id);
          progress = r;
          if (r.result) return out(`\n${fmtResult(r.result)}`);
        }
      } finally {
        rl.close();
      }
      return out(`\n${fmtResult(await api.finishQuiz(progress.attempt.id))}`);
    }
    case "result": {
      const r = await api.quizResult(Number(rest[0]));
      if (!r) throw new Error(`No attempt ${rest[0]}`);
      return out(values.json ? r : fmtResult(r));
    }
    case "delete":
      return out((await api.deleteQuiz(Number(rest[0]))) ? "Quiz deleted." : "No such quiz.");
    default:
      throw new Error("Usage: npm run quiz -- [list] | show <id> | create --file quiz.json | play <id> [--shuffle] | result <attempt id> | delete <id>");
  }
}

async function main(): Promise<void> {
  const commands: Record<string, (api: HeigApi) => Promise<void>> = { calendar, cards, correction, profile, quiz };
  const run = commands[command];
  if (!run) throw new Error("Usage: npm run calendar|cards|correction|profile|quiz -- …");
  const { api, close } = await openApi();
  try {
    await run(api);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
