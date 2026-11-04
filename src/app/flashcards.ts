/**
 * Flashcards: decks of two-sided cards (Markdown with LaTeX) per course, studied with a small spaced repetition
 * scheme (four grades: again, hard, good, easy).
 */
import type { Db } from "../rag/db.js";

export interface Deck {
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

const DECK_COLUMNS = `d.*,
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

export async function createDeck(db: Db, input: { title: string; course?: string; description?: string }): Promise<Deck> {
  const { rows } = await db.query("INSERT INTO decks (title, course, description) VALUES ($1, $2, $3) RETURNING id", [input.title, input.course ?? null, input.description ?? null]);
  return (await listDecks(db)).find((d) => d.id === Number(rows[0].id))!;
}

export async function updateDeck(db: Db, id: number, patch: { title?: string; course?: string | null; description?: string | null }): Promise<Deck | undefined> {
  await db.query(
    `UPDATE decks SET title = coalesce($2, title), course = CASE WHEN $3::boolean THEN $4 ELSE course END,
       description = CASE WHEN $5::boolean THEN $6 ELSE description END, updated_at = now() WHERE id = $1`,
    [id, patch.title ?? null, patch.course !== undefined, patch.course ?? null, patch.description !== undefined, patch.description ?? null],
  );
  const deck = await getDeck(db, id);
  return deck ? deckRow({ ...deck, created_at: deck.createdAt, updated_at: deck.updatedAt }) : undefined;
}

export async function deleteDeck(db: Db, id: number): Promise<boolean> {
  return (await db.query("DELETE FROM decks WHERE id = $1", [id])).rowCount === 1;
}

/** Appends cards to a deck. */
export async function addCards(db: Db, deckId: number, cards: CardInput[]): Promise<Card[]> {
  if (cards.length === 0) return [];
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

export async function updateCard(db: Db, id: number, patch: Partial<CardInput>): Promise<Card | undefined> {
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
     ON CONFLICT (card_id) DO UPDATE SET due_at = EXCLUDED.due_at, interval_days = EXCLUDED.interval_days, ease = EXCLUDED.ease,
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
