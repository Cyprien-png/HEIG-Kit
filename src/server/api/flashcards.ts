import { type CardInput, type Grade, addCards, answerStudySession, createDeck, currentStudySession, deleteCard, deleteDeck, deleteStudySession, getDeck, getStudySession, listDecks, openStudySession, review, studyQueue, studyStats, updateCard, updateDeck, updateStudySession } from "../../app/flashcards.js";
import type { App } from "../app.js";
import type { Router } from "./router.js";
import { HttpError, intParam, readJson, stringField } from "./util.js";

const MAX_CARDS_PER_CALL = 200;

/** One card from a JSON object; throws readable errors. */
export function cardFrom(value: unknown, index: number): CardInput {
  if (!value || typeof value !== "object") throw new HttpError(400, `card ${index + 1} must be an object`);
  const body = value as Record<string, unknown>;
  const tags = body.tags;
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) throw new HttpError(400, `card ${index + 1}: tags must be strings`);
  return {
    front: stringField(body, "front", { max: 4000 })!,
    back: stringField(body, "back", { max: 8000 })!,
    hint: stringField(body, "hint", { optional: true, max: 1000 }),
    tags: tags as string[] | undefined,
    source: stringField(body, "source", { optional: true, max: 300 }),
  };
}

export function registerFlashcardRoutes(router: Router, app: App): void {
  router.get("/api/decks", async ({ url }) => ({ decks: await listDecks(app.db, url.searchParams.get("course") ?? undefined), stats: await studyStats(app.db) }));

  router.post("/api/decks", async ({ req }) => {
    const body = await readJson(req);
    const deck = await createDeck(app.db, { title: stringField(body, "title", { max: 200 })!, course: stringField(body, "course", { optional: true, max: 40 }), description: stringField(body, "description", { optional: true, max: 2000 }) });
    const cards = Array.isArray(body.cards) ? body.cards : [];
    if (cards.length > MAX_CARDS_PER_CALL) throw new HttpError(400, `at most ${MAX_CARDS_PER_CALL} cards per call`);
    const added = await addCards(app.db, deck.id, cards.map(cardFrom));
    return { ...deck, cards: added.length, fresh: added.length };
  });

  router.get("/api/decks/:id", async ({ params }) => {
    const deck = await getDeck(app.db, intParam(params.id, "id"));
    if (!deck) throw new HttpError(404, "no such deck");
    return deck;
  });

  router.patch("/api/decks/:id", async ({ req, params }) => {
    const body = await readJson(req);
    const nullable = (name: string, max: number) => (body[name] === null ? null : stringField(body, name, { optional: true, max }));
    const deck = await updateDeck(app.db, intParam(params.id, "id"), { title: stringField(body, "title", { optional: true, max: 200 }), course: nullable("course", 40), description: nullable("description", 2000) });
    if (!deck) throw new HttpError(404, "no such deck");
    return deck;
  });

  router.delete("/api/decks/:id", async ({ params }) => {
    if (!(await deleteDeck(app.db, intParam(params.id, "id")))) throw new HttpError(404, "no such deck");
    return undefined;
  });

  router.post("/api/decks/:id/cards", async ({ req, params }) => {
    const body = await readJson(req);
    const cards = Array.isArray(body.cards) ? body.cards : [body];
    if (cards.length === 0 || cards.length > MAX_CARDS_PER_CALL) throw new HttpError(400, `between 1 and ${MAX_CARDS_PER_CALL} cards per call`);
    const id = intParam(params.id, "id");
    if (!(await getDeck(app.db, id))) throw new HttpError(404, "no such deck");
    return { cards: await addCards(app.db, id, cards.map(cardFrom)) };
  });

  router.patch("/api/cards/:id", async ({ req, params }) => {
    const body = await readJson(req);
    const tags = body.tags;
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) throw new HttpError(400, "tags must be strings");
    const card = await updateCard(app.db, intParam(params.id, "id"), {
      front: stringField(body, "front", { optional: true, max: 4000 }),
      back: stringField(body, "back", { optional: true, max: 8000 }),
      hint: stringField(body, "hint", { optional: true, max: 1000 }),
      tags: tags as string[] | undefined,
      source: stringField(body, "source", { optional: true, max: 300 }),
    });
    if (!card) throw new HttpError(404, "no such card");
    return card;
  });

  router.delete("/api/cards/:id", async ({ params }) => {
    if (!(await deleteCard(app.db, intParam(params.id, "id")))) throw new HttpError(404, "no such card");
    return undefined;
  });

  /** The cards to study now, of one deck or of all. */
  router.get("/api/study", async ({ url }) => {
    const deck = url.searchParams.get("deck");
    const limit = url.searchParams.get("limit");
    return { cards: await studyQueue(app.db, deck ? intParam(deck, "deck") : undefined, limit ? Math.min(intParam(limit, "limit"), 100) : undefined) };
  });

  router.post("/api/cards/:id/review", async ({ req, params }) => {
    const body = await readJson(req);
    const card = await review(app.db, intParam(params.id, "id"), gradeOf(body.grade));
    if (!card) throw new HttpError(404, "no such card");
    return card;
  });

  // Review sessions: resumed where they were left, until the student finishes or discards them.
  router.get("/api/study/sessions", async ({ url }) => {
    const deck = url.searchParams.get("deck");
    return { session: (await currentStudySession(app.db, deck ? intParam(deck, "deck") : undefined)) ?? null };
  });
  router.post("/api/study/sessions", async ({ req }) => {
    const body = await readJson(req);
    const deck = body.deck === undefined || body.deck === null ? undefined : Number(body.deck);
    if (deck !== undefined && !Number.isInteger(deck)) throw new HttpError(400, "deck must be an integer");
    const limit = body.limit === undefined ? undefined : Number(body.limit);
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 200)) throw new HttpError(400, "limit must be between 1 and 200");
    return openStudySession(app.db, deck, { shuffle: body.shuffle === true, discard: body.discard === true, limit });
  });
  router.get("/api/study/sessions/:id", async ({ params }) => {
    const session = await getStudySession(app.db, intParam(params.id, "id"));
    if (!session) throw new HttpError(404, "no such session");
    return session;
  });
  router.post("/api/study/sessions/:id/answers", async ({ req, params }) => {
    const body = await readJson(req);
    const slot = Number(body.slot);
    if (!Number.isInteger(slot) || slot < 0) throw new HttpError(400, "slot must be a positive integer");
    const session = await domain(() => answerStudySession(app.db, intParam(params.id, "id"), slot, gradeOf(body.grade)));
    if (!session) throw new HttpError(404, "no such session");
    return session;
  });
  router.patch("/api/study/sessions/:id", async ({ req, params }) => {
    const body = await readJson(req);
    const position = body.position === undefined ? undefined : Number(body.position);
    if (position !== undefined && !(Number.isInteger(position) && position >= 0)) throw new HttpError(400, "position must be a positive integer");
    const session = await updateStudySession(app.db, intParam(params.id, "id"), { position, finished: body.finished === true });
    if (!session) throw new HttpError(404, "no such session");
    return session;
  });
  router.delete("/api/study/sessions/:id", async ({ params }) => {
    if (!(await deleteStudySession(app.db, intParam(params.id, "id")))) throw new HttpError(404, "no such session");
    return { ok: true };
  });
}

function gradeOf(value: unknown): Grade {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) throw new HttpError(400, "grade must be 0 (again), 1 (hard), 2 (good) or 3 (easy)");
  return value;
}

/** Domain errors ("No slot…", "This session is finished") become 400s instead of 500s. */
async function domain<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && /^(No |This )/.test(error.message)) throw new HttpError(400, error.message);
    throw error;
  }
}
