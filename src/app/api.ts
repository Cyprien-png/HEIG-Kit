/**
 * The study features (calendar, flashcards, corrections, profile) behind one interface, for the MCP tools and the CLI:
 * on the server and on a stand-alone computer the local database; on a computer connected to a server, its API.
 * Values are JSON-shaped (dates as ISO strings) so that both sides agree.
 */
import { readFileSync } from "node:fs";
import type { Db } from "../rag/db.js";
import type { RemoteClient } from "../remote/client.js";
import * as calendar from "./calendar.js";
import * as corrections from "./corrections.js";
import * as exams from "./exams.js";
import * as flashcards from "./flashcards.js";
import * as library from "./library.js";
import * as pastexams from "./pastexams.js";
import * as profile from "./profile.js";
import * as quizzes from "./quizzes.js";

type Json<T> = T extends Date ? string : T extends Buffer ? Buffer : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

export type CalendarEvent = Json<calendar.CalendarEvent>;
export type EventInput = Json<calendar.EventInput>;
export type EventPatch = Json<calendar.EventPatch>;
export type Calendar = Json<calendar.Calendar>;
export type CalendarInput = calendar.CalendarInput;
export type CalendarPatch = calendar.CalendarPatch;
export type ListOptions = calendar.ListOptions;
export type Deck = Json<flashcards.Deck>;
export type Card = Json<flashcards.Card>;
export type Correction = Json<corrections.Correction>;
export type MockExam = Json<exams.MockExam>;
export type PastExam = Json<pastexams.PastExam>;
export type ProfileNote = Json<profile.ProfileNote>;
export type ProfileSummary = Json<profile.ProfileSummary>;
export type QuizSummary = Json<quizzes.QuizSummary>;
export type Quiz = Json<quizzes.QuizSummary & { questionList: quizzes.Question[] }>;
export type QuizProgress = Json<quizzes.Progress>;
export type QuizAnswered = Json<Awaited<ReturnType<typeof quizzes.answerQuestion>>>;
export type QuizResult = Json<quizzes.AttemptResult>;
export type LibraryItem = library.LibraryItem;
export type LibraryTagPatch = library.LibraryTagPatch;

export interface HeigApi {
  calendars(): Promise<Calendar[]>;
  calendarCreate(input: CalendarInput): Promise<Calendar>;
  calendarEdit(id: number, patch: CalendarPatch): Promise<Calendar>;
  calendarDelete(id: number): Promise<void>;
  calendarList(from: string, to: string, options?: ListOptions): Promise<CalendarEvent[]>;
  calendarAdd(input: EventInput): Promise<CalendarEvent>;
  calendarUpdate(key: string, patch: EventPatch): Promise<CalendarEvent>;
  calendarRemove(key: string): Promise<void>;
  calendarReset(key: string): Promise<CalendarEvent | undefined>;
  calendarHistory(key: string): Promise<CalendarEvent[]>;
  calendarOverrides(): Promise<CalendarEvent[]>;

  decks(course?: string): Promise<Deck[]>;
  deck(id: number): Promise<(Deck & { cardList: Card[] }) | undefined>;
  createDeck(input: { title: string; course?: string; description?: string }, cards?: flashcards.CardInput[]): Promise<Deck>;
  addCards(deckId: number, cards: flashcards.CardInput[]): Promise<Card[]>;
  updateCard(id: number, patch: Partial<flashcards.CardInput>): Promise<Card | undefined>;
  deleteCard(id: number): Promise<boolean>;
  deleteDeck(id: number): Promise<boolean>;
  study(deckId?: number, limit?: number): Promise<Card[]>;
  review(cardId: number, grade: flashcards.Grade): Promise<Card | undefined>;
  studyStats(): Promise<Json<flashcards.StudyStats>>;

  corrections(options?: { course?: string; state?: corrections.CorrectionState; exam?: string }): Promise<Correction[]>;
  correction(id: string): Promise<Correction | undefined>;
  createCorrection(input?: corrections.CorrectionInput): Promise<Correction & { captureUrl: string }>;
  updateCorrection(id: string, patch: corrections.CorrectionPatch): Promise<Correction>;
  /** The mock exams of the library with the student's attempts and grades (src/app/exams.ts). */
  mockExams(course?: string): Promise<MockExam[]>;
  captureLink(id: string): Promise<string>;
  correctionPhotos(id: string): Promise<{ id: number; contentType: string; data: Buffer }[]>;
  submitCorrection(id: string, result: corrections.CorrectionResult): Promise<Correction>;
  deleteCorrection(id: string): Promise<boolean>;

  profile(course?: string): Promise<ProfileSummary>;
  profileNotes(options?: { course?: string; kind?: profile.NoteKind; topic?: string; resolved?: boolean }): Promise<ProfileNote[]>;
  searchNotes(query: string, course?: string): Promise<ProfileNote[]>;
  addNotes(notes: profile.NoteInput[]): Promise<ProfileNote[]>;
  resolveNote(id: number, resolved?: boolean): Promise<ProfileNote | undefined>;
  /** Changes the chapter (null clears it) or the topic of a note. */
  updateNote(id: number, patch: { chapter?: string | null; section?: string | null; topic?: string }): Promise<ProfileNote | undefined>;
  /** The chapters of a course (of every course without one), the axes of the profile. */
  chapters(course?: string): Promise<profile.Chapter[]>;
  setChapters(course: string, chapters: profile.ChapterInput[]): Promise<profile.Chapter[]>;
  /** Writes its chapter on each note of the course that has none (every note with `all`), by the chapters' keywords. */
  fileNotes(course: string, all?: boolean): Promise<{ filed: number; unassigned: string[] }>;

  quizzes(course?: string): Promise<QuizSummary[]>;
  quiz(id: number): Promise<Quiz | undefined>;
  createQuiz(input: { title: string; course?: string; description?: string }, questions: quizzes.QuestionInput[]): Promise<Quiz>;
  deleteQuiz(id: number): Promise<boolean>;
  startQuiz(quizId: number, mode?: quizzes.AttemptMode, shuffle?: boolean): Promise<QuizProgress>;
  answerQuiz(attemptId: number, answer: boolean, questionId?: number): Promise<QuizAnswered>;
  finishQuiz(attemptId: number): Promise<QuizResult>;
  quizResult(attemptId: number): Promise<QuizResult | undefined>;

  /** The generated documents and videos with their course and tags (on the server when remote). */
  library(keywords?: string[]): Promise<LibraryItem[]>;
  /** Sets the course and tags of an item named by a file, a key (document:name), a name or a title. */
  tagLibraryItem(ref: string, patch: LibraryTagPatch): Promise<LibraryItem>;

  /** The past exams (« anciens TE ») with the student's attempts (src/app/pastexams.ts). */
  pastExams(options?: { branch?: string; course?: string }): Promise<PastExam[]>;
  /** A file of a past exam (`<id>/enonce.md`, `<id>/pages/p01.png`), or undefined. */
  readPastExamFile(id: string): Promise<Buffer | undefined>;
  /** Writes a file of a past exam (the agent's `enonce.md` or `corrige.md`). */
  writePastExamFile(id: string, content: Buffer): Promise<pastexams.ExamTreeFile>;
}

const json = <T>(value: T): Json<T> => (value === undefined ? value : JSON.parse(JSON.stringify(value))) as Json<T>;

const date = (value: string, name: string): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be an ISO date`);
  return d;
};

export interface LocalApiOptions {
  /** Makes the capture link of a correction (needs the server's public address and keys). */
  captureUrl?: (id: string) => Promise<string>;
  author?: calendar.Author;
}

export class LocalApi implements HeigApi {
  constructor(
    private readonly db: Db,
    private readonly options: LocalApiOptions = {},
  ) {}

  private get author(): calendar.Author {
    return this.options.author ?? "agent";
  }

  async calendars() {
    return json(await calendar.listCalendars(this.db));
  }
  async calendarCreate(input: CalendarInput) {
    return json(await calendar.createCalendar(this.db, input));
  }
  async calendarEdit(id: number, patch: CalendarPatch) {
    return json(await calendar.updateCalendar(this.db, id, patch));
  }
  calendarDelete(id: number) {
    return calendar.deleteCalendar(this.db, id);
  }
  async calendarList(from: string, to: string, options: ListOptions = {}) {
    return json(await calendar.listEvents(this.db, date(from, "from"), date(to, "to"), options));
  }
  async calendarAdd(input: EventInput) {
    return json(await calendar.addEvent(this.db, { ...input, startsAt: date(input.startsAt, "startsAt"), endsAt: input.endsAt ? date(input.endsAt, "endsAt") : undefined }, this.author));
  }
  async calendarUpdate(key: string, patch: EventPatch) {
    return json(await calendar.updateEvent(this.db, key, { ...patch, startsAt: patch.startsAt ? date(patch.startsAt, "startsAt") : undefined, endsAt: patch.endsAt === null ? null : patch.endsAt ? date(patch.endsAt, "endsAt") : undefined }, this.author));
  }
  calendarRemove(key: string) {
    return calendar.removeEvent(this.db, key, this.author);
  }
  async calendarReset(key: string) {
    return json(await calendar.resetEvent(this.db, key));
  }
  async calendarHistory(key: string) {
    return json(await calendar.eventHistory(this.db, key));
  }
  async calendarOverrides() {
    return json(await calendar.overriddenEvents(this.db));
  }

  async decks(course?: string) {
    return json(await flashcards.listDecks(this.db, course));
  }
  async deck(id: number) {
    return json(await flashcards.getDeck(this.db, id));
  }
  async createDeck(input: { title: string; course?: string; description?: string }, cards: flashcards.CardInput[] = []) {
    const deck = await flashcards.createDeck(this.db, input);
    const added = await flashcards.addCards(this.db, deck.id, cards);
    return json({ ...deck, cards: added.length, fresh: added.length });
  }
  async addCards(deckId: number, cards: flashcards.CardInput[]) {
    if (!(await flashcards.getDeck(this.db, deckId))) throw new Error(`No deck ${deckId}`);
    return json(await flashcards.addCards(this.db, deckId, cards));
  }
  async updateCard(id: number, patch: Partial<flashcards.CardInput>) {
    return json(await flashcards.updateCard(this.db, id, patch));
  }
  deleteCard(id: number) {
    return flashcards.deleteCard(this.db, id);
  }
  deleteDeck(id: number) {
    return flashcards.deleteDeck(this.db, id);
  }
  async study(deckId?: number, limit?: number) {
    return json(await flashcards.studyQueue(this.db, deckId, limit));
  }
  async review(cardId: number, grade: flashcards.Grade) {
    return json(await flashcards.review(this.db, cardId, grade));
  }
  async studyStats() {
    return json(await flashcards.studyStats(this.db));
  }

  async corrections(options: { course?: string; state?: corrections.CorrectionState; exam?: string } = {}) {
    return json(await corrections.listCorrections(this.db, options));
  }
  async mockExams(course?: string) {
    return json(await exams.listMockExams(this.db, course));
  }
  async correction(id: string) {
    return json(await corrections.getCorrection(this.db, id));
  }
  async createCorrection(input: corrections.CorrectionInput = {}) {
    if (!this.options.captureUrl) throw new Error("Corrections need the remote server: the phone must reach it to send photos (HEIG_REMOTE_URL, docs/app.md)");
    const created = await corrections.createCorrection(this.db, input);
    return { ...json(created), captureUrl: await this.options.captureUrl(created.id) };
  }
  async updateCorrection(id: string, patch: corrections.CorrectionPatch) {
    const updated = await corrections.updateCorrection(this.db, id, patch);
    if (!updated) throw new Error(`No correction ${id}`);
    return json(updated);
  }
  async captureLink(id: string) {
    if (!this.options.captureUrl) throw new Error("Corrections need the remote server (docs/app.md)");
    const found = await corrections.getCorrection(this.db, id);
    if (!found) throw new Error(`No correction ${id}`);
    if (found.state === "corrected") throw new Error("This correction is done");
    return this.options.captureUrl(id);
  }
  async correctionPhotos(id: string) {
    return (await corrections.photosWithData(this.db, id)).map((p) => ({ id: p.id, contentType: p.contentType, data: p.data }));
  }
  async submitCorrection(id: string, result: corrections.CorrectionResult) {
    const saved = await corrections.submitResult(this.db, id, result);
    if (!saved) throw new Error(`No correction ${id}`);
    return json(saved);
  }
  deleteCorrection(id: string) {
    return corrections.deleteCorrection(this.db, id);
  }

  async profile(course?: string) {
    return json(await profile.profileSummary(this.db, course));
  }
  async profileNotes(options: { course?: string; kind?: profile.NoteKind; topic?: string; resolved?: boolean } = {}) {
    return json(await profile.listNotes(this.db, options));
  }
  async searchNotes(query: string, course?: string) {
    return json(await profile.searchNotes(this.db, query, course));
  }
  async addNotes(notes: profile.NoteInput[]) {
    return json(await profile.addNotes(this.db, notes));
  }
  async resolveNote(id: number, resolved = true) {
    return json(await profile.resolveNote(this.db, id, resolved));
  }
  async updateNote(id: number, patch: { chapter?: string | null; section?: string | null; topic?: string }) {
    return json(await profile.updateNote(this.db, id, patch));
  }
  chapters(course?: string) {
    return profile.listChapters(this.db, course);
  }
  setChapters(course: string, chapters: profile.ChapterInput[]) {
    return profile.setChapters(this.db, course, chapters);
  }
  fileNotes(course: string, all = false) {
    return profile.fileNotes(this.db, course, all);
  }

  async quizzes(course?: string) {
    return json(await quizzes.listQuizzes(this.db, course));
  }
  async quiz(id: number) {
    return json(await quizzes.getQuiz(this.db, id));
  }
  async createQuiz(input: { title: string; course?: string; description?: string }, questions: quizzes.QuestionInput[]) {
    return json(await quizzes.createQuiz(this.db, input, questions));
  }
  deleteQuiz(id: number) {
    return quizzes.deleteQuiz(this.db, id);
  }
  async startQuiz(quizId: number, mode: quizzes.AttemptMode = "web", shuffle = false) {
    return json(await quizzes.startAttempt(this.db, quizId, mode, { shuffle }));
  }
  async answerQuiz(attemptId: number, answer: boolean, questionId?: number) {
    return json(await quizzes.answerQuestion(this.db, attemptId, answer, questionId));
  }
  async finishQuiz(attemptId: number) {
    return json(await quizzes.finishAttempt(this.db, attemptId));
  }
  async quizResult(attemptId: number) {
    return json(await quizzes.attemptResult(this.db, attemptId));
  }

  async library(keywords: string[] = []) {
    return library.annotatedLibrary(this.db, keywords);
  }
  async tagLibraryItem(ref: string, patch: LibraryTagPatch) {
    const item = library.findLibraryItem(await library.annotatedLibrary(this.db), ref);
    await library.setLibraryTags(this.db, library.libraryItemKey(item), patch);
    return library.annotateLibrary([item], await library.listLibraryTags(this.db), await library.knownCourses(this.db))[0];
  }
  async pastExams(options: { branch?: string; course?: string } = {}) {
    return json(await pastexams.listPastExams(this.db, options));
  }
  async readPastExamFile(id: string) {
    const file = pastexams.pastExamFile(id);
    return file ? readFileSync(file) : undefined;
  }
  async writePastExamFile(id: string, content: Buffer) {
    return pastexams.savePastExamFile(id, content);
  }
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const text = search.toString();
  return text ? `?${text}` : "";
};

const notFound = (error: unknown) => (error as { status?: number }).status === 404;

export class RemoteApi implements HeigApi {
  constructor(private readonly client: RemoteClient) {}

  async calendars() {
    return (await this.client.get<{ calendars: Calendar[] }>("/api/calendars")).calendars;
  }
  calendarCreate(input: CalendarInput) {
    return this.client.post<Calendar>("/api/calendars", input);
  }
  calendarEdit(id: number, patch: CalendarPatch) {
    return this.client.patch<Calendar>(`/api/calendars/${id}`, patch);
  }
  calendarDelete(id: number) {
    return this.client.delete(`/api/calendars/${id}`);
  }
  async calendarList(from: string, to: string, options: ListOptions = {}) {
    const query = qs({ from, to, kinds: options.kinds?.join(","), course: options.course, calendars: options.calendars?.join(","), visible: options.visibleOnly ? "true" : undefined });
    return (await this.client.get<{ events: CalendarEvent[] }>(`/api/calendar${query}`)).events;
  }
  calendarAdd(input: EventInput) {
    return this.client.post<CalendarEvent>("/api/calendar/events", input);
  }
  calendarUpdate(key: string, patch: EventPatch) {
    return this.client.patch<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(key)}`, patch);
  }
  calendarRemove(key: string) {
    return this.client.delete(`/api/calendar/events/${encodeURIComponent(key)}`);
  }
  async calendarReset(key: string) {
    const result = await this.client.post<CalendarEvent | { reset: true }>(`/api/calendar/events/${encodeURIComponent(key)}/reset`);
    return "key" in result ? result : undefined;
  }
  async calendarHistory(key: string) {
    return (await this.client.get<{ versions: CalendarEvent[] }>(`/api/calendar/events/${encodeURIComponent(key)}/history`)).versions;
  }
  async calendarOverrides() {
    return (await this.client.get<{ events: CalendarEvent[] }>("/api/calendar/overrides")).events;
  }

  async decks(course?: string) {
    return (await this.client.get<{ decks: Deck[] }>(`/api/decks${qs({ course })}`)).decks;
  }
  async deck(id: number) {
    return this.client.get<Deck & { cardList: Card[] }>(`/api/decks/${id}`).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  createDeck(input: { title: string; course?: string; description?: string }, cards: flashcards.CardInput[] = []) {
    return this.client.post<Deck>("/api/decks", { ...input, cards });
  }
  async addCards(deckId: number, cards: flashcards.CardInput[]) {
    return (await this.client.post<{ cards: Card[] }>(`/api/decks/${deckId}/cards`, { cards })).cards;
  }
  async updateCard(id: number, patch: Partial<flashcards.CardInput>) {
    return this.client.patch<Card>(`/api/cards/${id}`, patch).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  async deleteCard(id: number) {
    return this.client.delete(`/api/cards/${id}`).then(() => true, (e) => (notFound(e) ? false : Promise.reject(e)));
  }
  async deleteDeck(id: number) {
    return this.client.delete(`/api/decks/${id}`).then(() => true, (e) => (notFound(e) ? false : Promise.reject(e)));
  }
  async study(deckId?: number, limit?: number) {
    return (await this.client.get<{ cards: Card[] }>(`/api/study${qs({ deck: deckId, limit })}`)).cards;
  }
  async review(cardId: number, grade: flashcards.Grade) {
    return this.client.post<Card>(`/api/cards/${cardId}/review`, { grade }).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  async studyStats() {
    return (await this.client.get<{ stats: Json<flashcards.StudyStats> }>("/api/decks")).stats;
  }

  async corrections(options: { course?: string; state?: corrections.CorrectionState; exam?: string } = {}) {
    return (await this.client.get<{ corrections: Correction[] }>(`/api/corrections${qs(options)}`)).corrections;
  }
  async mockExams(course?: string) {
    return (await this.client.get<{ exams: MockExam[] }>(`/api/exams${qs({ course })}`)).exams;
  }
  async correction(id: string) {
    return this.client.get<Correction>(`/api/corrections/${id}`).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  createCorrection(input: corrections.CorrectionInput = {}) {
    return this.client.post<Correction & { captureUrl: string }>("/api/corrections", input);
  }
  updateCorrection(id: string, patch: corrections.CorrectionPatch) {
    return this.client.patch<Correction>(`/api/corrections/${id}`, patch);
  }
  async captureLink(id: string) {
    return (await this.client.post<{ captureUrl: string }>(`/api/corrections/${id}/capture-link`)).captureUrl;
  }
  async correctionPhotos(id: string) {
    const correction = await this.correction(id);
    if (!correction) throw new Error(`No correction ${id}`);
    const photos: { id: number; contentType: string; data: Buffer }[] = [];
    for (const p of correction.photos) {
      const res = await this.client.request("GET", `/api/corrections/${id}/photos/${p.id}`);
      photos.push({ id: p.id, contentType: p.contentType, data: Buffer.from(await res.arrayBuffer()) });
    }
    return photos;
  }
  submitCorrection(id: string, result: corrections.CorrectionResult) {
    return this.client.json<Correction>("PUT", `/api/corrections/${id}/result`, { result });
  }
  async deleteCorrection(id: string) {
    return this.client.delete(`/api/corrections/${id}`).then(() => true, (e) => (notFound(e) ? false : Promise.reject(e)));
  }

  profile(course?: string) {
    return this.client.get<ProfileSummary>(`/api/profile${qs({ course })}`);
  }
  async profileNotes(options: { course?: string; kind?: profile.NoteKind; topic?: string; resolved?: boolean } = {}) {
    return (await this.client.get<{ notes: ProfileNote[] }>(`/api/profile/notes${qs({ ...options, resolved: options.resolved ? 1 : undefined })}`)).notes;
  }
  async searchNotes(query: string, course?: string) {
    return (await this.client.get<{ notes: ProfileNote[] }>(`/api/profile/notes${qs({ q: query, course })}`)).notes;
  }
  async addNotes(notes: profile.NoteInput[]) {
    return (await this.client.post<{ notes: ProfileNote[] }>("/api/profile/notes", { notes })).notes;
  }
  async resolveNote(id: number, resolved = true) {
    return this.client.post<ProfileNote>(`/api/profile/notes/${id}/resolve`, { resolved }).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  async updateNote(id: number, patch: { chapter?: string | null; section?: string | null; topic?: string }) {
    return this.client.patch<ProfileNote>(`/api/profile/notes/${id}`, patch).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  async chapters(course?: string) {
    return (await this.client.get<{ chapters: profile.Chapter[] }>(`/api/profile/chapters${qs({ course })}`)).chapters;
  }
  async setChapters(course: string, chapters: profile.ChapterInput[]) {
    return (await this.client.put<{ chapters: profile.Chapter[] }>(`/api/profile/chapters/${encodeURIComponent(course)}`, { chapters })).chapters;
  }
  fileNotes(course: string, all = false) {
    return this.client.post<{ filed: number; unassigned: string[] }>(`/api/profile/chapters/${encodeURIComponent(course)}/file`, { all });
  }

  async quizzes(course?: string) {
    return (await this.client.get<{ quizzes: QuizSummary[] }>(`/api/quizzes${qs({ course })}`)).quizzes;
  }
  async quiz(id: number) {
    return this.client.get<Quiz>(`/api/quizzes/${id}`).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }
  createQuiz(input: { title: string; course?: string; description?: string }, questions: quizzes.QuestionInput[]) {
    return this.client.post<Quiz>("/api/quizzes", { ...input, questions });
  }
  async deleteQuiz(id: number) {
    return this.client.delete(`/api/quizzes/${id}`).then(() => true, (e) => (notFound(e) ? false : Promise.reject(e)));
  }
  startQuiz(quizId: number, mode: quizzes.AttemptMode = "web", shuffle = false) {
    return this.client.post<QuizProgress>(`/api/quizzes/${quizId}/attempts`, { mode, shuffle });
  }
  answerQuiz(attemptId: number, answer: boolean, questionId?: number) {
    return this.client.post<QuizAnswered>(`/api/quiz-attempts/${attemptId}/answers`, { answer, questionId });
  }
  finishQuiz(attemptId: number) {
    return this.client.post<QuizResult>(`/api/quiz-attempts/${attemptId}/finish`);
  }
  async quizResult(attemptId: number) {
    return this.client.get<QuizResult>(`/api/quiz-attempts/${attemptId}`).catch((e) => (notFound(e) ? undefined : Promise.reject(e)));
  }

  async library(keywords: string[] = []) {
    return (await this.client.get<{ items: LibraryItem[] }>(`/api/library${qs({ q: keywords.join(" ") })}`)).items;
  }
  async pastExams(options: { branch?: string; course?: string } = {}) {
    return (await this.client.get<{ exams: PastExam[] }>(`/api/past-exams${qs(options)}`)).exams;
  }
  async readPastExamFile(id: string) {
    try {
      const res = await this.client.request("GET", `/api/past-exams/files/${id.split("/").map(encodeURIComponent).join("/")}?download=1`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (notFound(e)) return undefined;
      throw e;
    }
  }
  async writePastExamFile(id: string, content: Buffer) {
    const res = await this.client.request("PUT", `/api/past-exams/files/${id.split("/").map(encodeURIComponent).join("/")}`, { body: new Uint8Array(content), headers: { "Content-Type": "application/octet-stream" } });
    return (await res.json()) as pastexams.ExamTreeFile;
  }
  async tagLibraryItem(ref: string, patch: LibraryTagPatch) {
    const item = library.findLibraryItem(await this.library(), ref);
    return this.client.patch<LibraryItem>(`/api/library/items/${item.kind}/${encodeURIComponent(item.name)}`, patch);
  }
}
