/**
 * Flashcards: decks of two-sided cards (Markdown with LaTeX) per course, studied with a small spaced repetition
 * scheme (four grades: again, hard, good, easy).
 */
import { type Authorship, authorColumns, authorship, requireEditable } from "./sharing.js";
import type { Db } from "../rag/db.js";
import { type Existing, type ReuseClaim, requireNew } from "./reuse.js";

export interface Deck extends Authorship {
  id: number;
  course?: string;
  title: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  cards: number;
  due: number;
  fresh: number;
}

export interface CardInput {
  front: string;
  back: string;
  hint?: string;
  tags?: string[];
  source?: string;
}

export interface CardState {
  dueAt: Date;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastGrade?: number;
  reviewedAt?: Date;
}

export interface Card extends CardInput {
  id: number;
  deckId: number;
  position: number;
  createdAt: Date;
  state?: CardState;
}

export type Grade = 0 | 1 | 2 | 3;

const MIN_EASE = 1.3;
const START_EASE = 2.5;
const AGAIN_MINUTES = 10;

function deckRow(r: Record<string, unknown>): Deck {
  return {
    id: Number(r.id),
    course: (r.course as string | null) ?? undefined,
    title: r.title as string,
    description: (r.description as string | null) ?? undefined,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    ...authorship(r),
    cards: Number(r.cards ?? 0),
    due: Number(r.due ?? 0),
    fresh: Number(r.fresh ?? 0),
  };
}

function cardRow(r: Record<string, unknown>): Card {
  return {
    id: Number(r.id),
    deckId: Number(r.deck_id),
    position: r.position as number,
    front: r.front as string,
    back: r.back as string,
    hint: (r.hint as string | null) ?? undefined,
    tags: (r.tags as string[]) ?? [],
    source: (r.source as string | null) ?? undefined,
    createdAt: r.created_at as Date,
    state: r.due_at
      ? {
          dueAt: r.due_at as Date,
          intervalDays: Number(r.interval_days),
          ease: Number(r.ease),
          reps: r.reps as number,
          lapses: r.lapses as number,
          lastGrade: (r.last_grade as number | null) ?? undefined,
          reviewedAt: (r.reviewed_at as Date | null) ?? undefined,
        }
      : undefined,
  };
}

const DECK_COLUMNS = `d.*, ${authorColumns("d")},
  (SELECT count(*) FROM cards c WHERE c.deck_id = d.id)::int AS cards,
  (SELECT count(*) FROM cards c JOIN card_state s ON s.card_id = c.id WHERE c.deck_id = d.id AND s.due_at <= now())::int AS due,
  (SELECT count(*) FROM cards c LEFT JOIN card_state s ON s.card_id = c.id WHERE c.deck_id = d.id AND s.card_id IS NULL)::int AS fresh`;

export async function listDecks(db: Db, course?: string): Promise<Deck[]> {
  const { rows } = await db.query(`SELECT ${DECK_COLUMNS} FROM decks d WHERE $1::text IS NULL OR lower(d.course) = lower($1) ORDER BY d.updated_at DESC`, [course ?? null]);
  return rows.map(deckRow);
}

export async function getDeck(db: Db, id: number): Promise<(Deck & { cardList: Card[] }) | undefined> {
  const { rows } = await db.query(`SELECT ${DECK_COLUMNS} FROM decks d WHERE d.id = $1`, [id]);
  if (!rows[0]) return undefined;
  const cards = await db.query("SELECT c.*, s.due_at, s.interval_days, s.ease, s.reps, s.lapses, s.last_grade, s.reviewed_at FROM cards c LEFT JOIN card_state s ON s.card_id = c.id WHERE c.deck_id = $1 ORDER BY c.position, c.id", [id]);
  return { ...deckRow(rows[0]), cardList: cards.rows.map(cardRow) };
}

const asExisting = (kind: string) => (item: { id: number; title: string; course?: string; author?: string; mine: boolean }): Existing => ({ ref: `${kind} ${item.id}`, title: item.title, course: item.course, author: item.author, mine: item.mine });

/** Creates a deck, unless similar ones exist and the caller did not say why another is needed (src/app/reuse.ts). */
export async function createDeck(db: Db, input: { title: string; course?: string; description?: string; reuse?: ReuseClaim }): Promise<Deck> {
  requireNew("deck", input, (await listDecks(db)).map(asExisting("deck")), input.reuse, "Read them with list_decks, and add what is missing to a deck of yours with add_flashcards.");
  const { rows } = await db.query("INSERT INTO decks (title, course, description) VALUES ($1, $2, $3) RETURNING id", [input.title, input.course ?? null, input.description ?? null]);
  return (await listDecks(db)).find((d) => d.id === Number(rows[0].id))!;
}

export async function updateDeck(db: Db, id: number, patch: { title?: string; course?: string | null; description?: string | null }): Promise<Deck | undefined> {
  if (!(await requireEditable(db, "decks", id))) return undefined;
  await db.query(
    `UPDATE decks SET title = coalesce($2, title), course = CASE WHEN $3::boolean THEN $4 ELSE course END,
       description = CASE WHEN $5::boolean THEN $6 ELSE description END, updated_at = now() WHERE id = $1`,
    [id, patch.title ?? null, patch.course !== undefined, patch.course ?? null, patch.description !== undefined, patch.description ?? null],
  );
  return (await listDecks(db)).find((d) => d.id === id);
}

export async function deleteDeck(db: Db, id: number): Promise<boolean> {
  if (!(await requireEditable(db, "decks", id))) return false;
  return (await db.query("DELETE FROM decks WHERE id = $1", [id])).rowCount === 1;
}

/** Appends cards to a deck. */
export async function addCards(db: Db, deckId: number, cards: CardInput[]): Promise<Card[]> {
  if (cards.length === 0) return [];
  if (!(await requireEditable(db, "decks", deckId))) throw new Error(`No deck ${deckId}`);
  const { rows: last } = await db.query<{ position: number | null }>("SELECT max(position) AS position FROM cards WHERE deck_id = $1", [deckId]);
  let position = (last[0]?.position ?? -1) + 1;
  const inserted: Card[] = [];
  for (const card of cards) {
    const { rows } = await db.query(
      "INSERT INTO cards (deck_id, position, front, back, hint, tags, source) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [deckId, position++, card.front, card.back, card.hint ?? null, card.tags ?? [], card.source ?? null],
    );
    inserted.push(cardRow(rows[0]));
  }
  await db.query("UPDATE decks SET updated_at = now() WHERE id = $1", [deckId]);
  return inserted;
}

/** The deck of a card, checked to be editable by the current account; undefined when the card does not exist. */
async function editableDeckOf(db: Db, cardId: number): Promise<number | undefined> {
  const { rows } = await db.query<{ deck_id: string }>("SELECT deck_id FROM cards WHERE id = $1", [cardId]);
  if (!rows[0]) return undefined;
  await requireEditable(db, "decks", Number(rows[0].deck_id));
  return Number(rows[0].deck_id);
}

export async function updateCard(db: Db, id: number, patch: Partial<CardInput>): Promise<Card | undefined> {
  if ((await editableDeckOf(db, id)) === undefined) return undefined;
  const { rows } = await db.query(
    `UPDATE cards SET front = coalesce($2, front), back = coalesce($3, back), hint = coalesce($4, hint), tags = coalesce($5, tags), source = coalesce($6, source)
     WHERE id = $1 RETURNING *`,
    [id, patch.front ?? null, patch.back ?? null, patch.hint ?? null, patch.tags ?? null, patch.source ?? null],
  );
  if (!rows[0]) return undefined;
  await db.query("UPDATE decks SET updated_at = now() WHERE id = $1", [rows[0].deck_id]);
  return cardRow(rows[0]);
}

export async function deleteCard(db: Db, id: number): Promise<boolean> {
  if ((await editableDeckOf(db, id)) === undefined) return false;
  return (await db.query("DELETE FROM cards WHERE id = $1", [id])).rowCount === 1;
}

/** Cards to study now: due ones first (most overdue first), then new ones in deck order. */
export async function studyQueue(db: Db, deckId: number | undefined, limit = 20): Promise<Card[]> {
  const { rows } = await db.query(
    `SELECT c.*, s.due_at, s.interval_days, s.ease, s.reps, s.lapses, s.last_grade, s.reviewed_at
     FROM cards c LEFT JOIN card_state s ON s.card_id = c.id
     WHERE ($1::bigint IS NULL OR c.deck_id = $1) AND (s.card_id IS NULL OR s.due_at <= now())
     ORDER BY (s.card_id IS NULL), s.due_at, c.deck_id, c.position
     LIMIT $2`,
    [deckId ?? null, limit],
  );
  return rows.map(cardRow);
}

/** Next interval and ease after a grade, a simplified SM-2. */
export function schedule(state: CardState | undefined, grade: Grade, now = new Date()): CardState {
  const reps = (state?.reps ?? 0) + 1;
  let ease = state?.ease ?? START_EASE;
  let interval = state?.intervalDays ?? 0;
  let lapses = state?.lapses ?? 0;
  const learned = (state?.intervalDays ?? 0) >= 1;
  if (grade === 0) {
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = AGAIN_MINUTES / 1440;
    if (learned) lapses++;
  } else if (grade === 1) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    interval = learned ? Math.max(1, interval * 1.2) : 1;
  } else if (grade === 2) {
    interval = learned ? interval * ease : 1;
  } else {
    ease += 0.15;
    interval = learned ? interval * ease * 1.3 : 3;
  }
  interval = Math.min(interval, 365);
  return { dueAt: new Date(now.getTime() + interval * 86_400_000), intervalDays: interval, ease, reps, lapses, lastGrade: grade, reviewedAt: now };
}

export async function review(db: Db, cardId: number, grade: Grade): Promise<Card | undefined> {
  const { rows } = await db.query("SELECT c.*, s.due_at, s.interval_days, s.ease, s.reps, s.lapses, s.last_grade, s.reviewed_at FROM cards c LEFT JOIN card_state s ON s.card_id = c.id WHERE c.id = $1", [cardId]);
  if (!rows[0]) return undefined;
  const card = cardRow(rows[0]);
  const next = schedule(card.state, grade);
  await db.query(
    `INSERT INTO card_state (card_id, due_at, interval_days, ease, reps, lapses, last_grade, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, card_id) DO UPDATE SET due_at = EXCLUDED.due_at, interval_days = EXCLUDED.interval_days, ease = EXCLUDED.ease,
       reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, last_grade = EXCLUDED.last_grade, reviewed_at = EXCLUDED.reviewed_at`,
    [cardId, next.dueAt, next.intervalDays, next.ease, next.reps, next.lapses, grade, next.reviewedAt],
  );
  await db.query("INSERT INTO card_reviews (card_id, grade, interval_days) VALUES ($1, $2, $3)", [cardId, grade, next.intervalDays]);
  return { ...card, state: next };
}

export interface StudyStats {
  due: number;
  fresh: number;
  reviewedToday: number;
  /** Reviews per day over the last 14 days, oldest first. */
  days: { day: string; reviews: number; again: number }[];
}

export async function studyStats(db: Db): Promise<StudyStats> {
  const counts = await db.query(
    `SELECT (SELECT count(*) FROM card_state WHERE due_at <= now())::int AS due,
            (SELECT count(*) FROM cards c LEFT JOIN card_state s ON s.card_id = c.id WHERE s.card_id IS NULL)::int AS fresh,
            (SELECT count(*) FROM card_reviews WHERE reviewed_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich')::int AS today`,
  );
  const days = await db.query(
    `SELECT to_char(reviewed_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS day, count(*)::int AS reviews, count(*) FILTER (WHERE grade = 0)::int AS again
     FROM card_reviews WHERE reviewed_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`,
  );
  return { due: counts.rows[0].due, fresh: counts.rows[0].fresh, reviewedToday: counts.rows[0].today, days: days.rows };
}

// Review sessions: the queue of a review kept on the server, so that it resumes where it was left, on any device.

export interface StudySlot {
  slot: number;
  card: Card;
  grade?: Grade;
  answeredAt?: Date;
}

export interface StudySession {
  id: number;
  deckId?: number;
  shuffled: boolean;
  /** Index of the card shown last (where the session resumes). */
  position: number;
  startedAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
  slots: StudySlot[];
  answered: number;
  again: number;
}

function shuffleIds(ids: number[]): number[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function sessionFromRow(db: Db, row: Record<string, unknown>): Promise<StudySession> {
  const order = (row.card_order as number[]) ?? [];
  const { rows: cards } = await db.query(
    "SELECT c.*, s.due_at, s.interval_days, s.ease, s.reps, s.lapses, s.last_grade, s.reviewed_at FROM cards c LEFT JOIN card_state s ON s.card_id = c.id WHERE c.id = ANY($1::int[])",
    [order],
  );
  const byId = new Map(cards.map((r) => [Number(r.id), cardRow(r)]));
  const { rows: answers } = await db.query("SELECT slot, grade, answered_at FROM study_session_answers WHERE session_id = $1", [row.id]);
  const graded = new Map(answers.map((a) => [a.slot as number, a]));
  // Cards deleted since the session started are skipped; their slot numbers are kept so answers stay attached.
  const slots: StudySlot[] = [];
  order.forEach((id, slot) => {
    const card = byId.get(id);
    if (!card) return;
    const a = graded.get(slot);
    slots.push({ slot, card, grade: a ? (a.grade as Grade) : undefined, answeredAt: a ? (a.answered_at as Date) : undefined });
  });
  return {
    id: Number(row.id),
    deckId: row.deck_id === null ? undefined : Number(row.deck_id),
    shuffled: row.shuffled as boolean,
    position: row.position as number,
    startedAt: row.started_at as Date,
    updatedAt: row.updated_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? undefined,
    slots,
    answered: slots.filter((s) => s.grade !== undefined).length,
    again: slots.filter((s) => s.grade === 0).length,
  };
}

/** The session in progress for a deck (or for all the due cards when `deckId` is undefined), if any. */
export async function currentStudySession(db: Db, deckId: number | undefined): Promise<StudySession | undefined> {
  const { rows } = await db.query("SELECT * FROM study_sessions WHERE deck_id IS NOT DISTINCT FROM $1::int AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1", [deckId ?? null]);
  return rows[0] ? sessionFromRow(db, rows[0]) : undefined;
}

export async function getStudySession(db: Db, id: number): Promise<StudySession | undefined> {
  const { rows } = await db.query("SELECT * FROM study_sessions WHERE id = $1", [id]);
  return rows[0] ? sessionFromRow(db, rows[0]) : undefined;
}

/**
 * Resumes the session in progress of a deck (or of all the due cards), or starts one from the study queue. Starting
 * a session is what the student does when nothing is left to resume; `discard` first drops the one in progress.
 */
export async function openStudySession(db: Db, deckId: number | undefined, options: { shuffle?: boolean; limit?: number; discard?: boolean } = {}): Promise<{ session: StudySession; resumed: boolean }> {
  const current = await currentStudySession(db, deckId);
  if (current && !options.discard) return { session: current, resumed: true };
  if (current) await deleteStudySession(db, current.id);
  const queue = await studyQueue(db, deckId, options.limit ?? 50);
  const ids = queue.map((c) => c.id);
  const { rows } = await db.query("INSERT INTO study_sessions (deck_id, card_order, shuffled) VALUES ($1, $2, $3) RETURNING *", [deckId ?? null, options.shuffle ? shuffleIds(ids) : ids, options.shuffle ?? false]);
  return { session: await sessionFromRow(db, rows[0]), resumed: false };
}

/**
 * Grades the card at a slot: the card's spaced repetition state is updated as for any review, the answer is kept (a
 * second answer at the same slot replaces the first), a card to see again is appended to the session unless it is
 * still to come, and the session moves on to the next slot.
 */
export async function answerStudySession(db: Db, id: number, slot: number, grade: Grade): Promise<StudySession | undefined> {
  const { rows } = await db.query("SELECT * FROM study_sessions WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return undefined;
  const order = row.card_order as number[];
  const cardId = order[slot];
  if (cardId === undefined) throw new Error(`No slot ${slot} in this session`);
  if (row.finished_at) throw new Error("This session is finished");
  if (!(await review(db, cardId, grade))) throw new Error("This card no longer exists");
  await db.query(
    "INSERT INTO study_session_answers (session_id, slot, card_id, grade) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id, slot) DO UPDATE SET grade = EXCLUDED.grade, answered_at = now()",
    [id, slot, cardId, grade],
  );
  const pendingLater = order.slice(slot + 1).includes(cardId);
  const next = grade === 0 && !pendingLater ? [...order, cardId] : order;
  await db.query("UPDATE study_sessions SET card_order = $2, position = $3, updated_at = now() WHERE id = $1", [id, next, Math.min(slot + 1, next.length - 1)]);
  return getStudySession(db, id);
}

/** Remembers where the student is (navigating back and forth), or closes the session. */
export async function updateStudySession(db: Db, id: number, patch: { position?: number; finished?: boolean }): Promise<StudySession | undefined> {
  await db.query(
    `UPDATE study_sessions SET position = coalesce($2, position), finished_at = CASE WHEN $3::boolean THEN coalesce(finished_at, now()) ELSE finished_at END, updated_at = now() WHERE id = $1`,
    [id, patch.position ?? null, patch.finished ?? false],
  );
  return getStudySession(db, id);
}

export async function deleteStudySession(db: Db, id: number): Promise<boolean> {
  return (await db.query("DELETE FROM study_sessions WHERE id = $1", [id])).rowCount === 1;
}
