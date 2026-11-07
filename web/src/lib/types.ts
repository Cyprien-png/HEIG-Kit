/** Shapes of the API answers used by the pages (mirrors src/app/*.ts on the server). */

export type EventKind = "lesson" | "deadline" | "exam" | "event";

export type BuiltinCalendar = "schedule" | "exams" | "deadlines";

/** A calendar (layer): the built-in ones receive the source events, the user's own hold revision plans and the rest. */
export interface Calendar {
  id: number;
  slug?: BuiltinCalendar;
  name: string;
  color: string;
  description?: string;
  visible: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  key: string;
  calendarId: number;
  source: "gaps" | "cyberlearn" | "manual";
  kind: EventKind;
  title: string;
  course?: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  url?: string;
  details?: string;
  deleted: boolean;
  fetchedAt: string;
  author: "sync" | "user" | "agent";
  overridden: boolean;
}

export interface Lesson {
  start: string;
  end: string;
  summary: string;
  location: string;
  description: string;
}

export interface Deadline {
  id: number;
  due: string;
  name: string;
  module: string;
  course: string;
  courseShortName: string;
  action: string;
  overdue: boolean;
  url: string;
}

export interface Snapshot<T> {
  kind: string;
  fetchedAt: string;
  checkedAt: string;
  data: T;
}

export interface CourseGrades {
  course: string;
  average: string;
  parts: { type: string; average: string; weight: string; assessments: { date: string; title: string; classAverage: string; coefficient: string; grade: string }[] }[];
}

export interface Transcript {
  header: string[];
  lines: { cells: string[] }[];
  totalCredits: string;
}

export interface PlanUnit {
  year: string;
  module: { name: string; code: string; sheet: string };
  unit: { name: string; code: string; sheet: string };
  credits: { period: string; credits: number }[];
  status: string;
}

export interface AbsenceRow {
  unit: string;
  periods: number;
  justified: number;
  relativeRate: string;
  absoluteRate: string;
  totalPeriods: number;
}

export interface CyberlearnCourse {
  id: number;
  shortName: string;
  fullName: string;
  teachers: string[];
}

export interface KbCourse {
  course: string | null;
  name: string | null;
  teachers: string[] | null;
  documents: number;
  docTypes: string[];
}

export interface KbDocument {
  id: number;
  title: string;
  docType: string;
  chapter: string | null;
  uploadedAt: string | null;
  url: string | null;
}

export interface SearchResult {
  score: number;
  documentId: number;
  title: string;
  course: string | null;
  chapter: string | null;
  docType: string;
  pages: string;
  headingPath: string | null;
  exercise: string | null;
  url: string | null;
  text: string;
}

export interface DocumentText {
  id: number;
  title: string;
  course: string | null;
  chapter: string | null;
  docType: string;
  url: string | null;
  pageCount: number;
  text: string;
}

export interface StudySlot {
  slot: number;
  card: Card;
  grade?: number;
  answeredAt?: string;
}

/** A review session kept on the server: the cards in order, what was answered, where the student is. */
export interface StudySession {
  id: number;
  deckId?: number;
  shuffled: boolean;
  position: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  slots: StudySlot[];
  answered: number;
  again: number;
}

export interface LibraryFile {
  id: string;
  kind: "documents" | "videos";
  name: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

export interface LibraryItem {
  kind: "document" | "video";
  name: string;
  title: string;
  modifiedAt: string;
  files: LibraryFile[];
  /** Course code and tags, saved by the agent (tagged) or guessed from the name and title. */
  course?: string;
  tags: string[];
  tagged: boolean;
}

export interface Deck {
  id: number;
  course?: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  cards: number;
  due: number;
  fresh: number;
}

export interface CardState {
  dueAt: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastGrade?: number;
  reviewedAt?: string;
}

export interface Card {
  id: number;
  deckId: number;
  position: number;
  front: string;
  back: string;
  hint?: string;
  tags: string[];
  source?: string;
  createdAt: string;
  state?: CardState;
}

export interface StudyStats {
  due: number;
  fresh: number;
  reviewedToday: number;
  days: { day: string; reviews: number; again: number }[];
}

export type Verdict = "correct" | "partial" | "wrong" | "missing";

export interface CorrectedExercise {
  number: string;
  title?: string;
  statement?: string;
  answer: string;
  verdict: Verdict;
  points?: { obtained: number; total: number };
  feedback: string;
  solution?: string;
  cause?: string;
  topics: string[];
}

export interface Correction {
  id: string;
  title: string;
  course?: string;
  topic?: string;
  state: "capture" | "received" | "corrected";
  notes?: string;
  /** The mock exam this work answers: the library item of its statement (`document:<name>`). */
  exam?: string;
  result?: { summary: string; exercises: CorrectedExercise[]; toRevise?: string[] };
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  correctedAt?: string;
  photos: { id: number; position: number; contentType: string; bytes: number; createdAt: string }[];
}

// Mock exams (mirrors src/app/exams.ts)

export type ExamStatus = "todo" | "pending" | "done";

export interface ExamScore {
  obtained: number;
  total: number;
  percent: number;
  /** Swiss grade, 1 to 6, to a tenth. */
  grade: number;
}

export interface ExamAttempt {
  id: string;
  title: string;
  state: Correction["state"];
  createdAt: string;
  correctedAt?: string;
  score?: ExamScore;
}

export interface MockExam {
  /** The statement's item key (`document:<name>`). */
  key: string;
  course?: string;
  title: string;
  statement?: LibraryItem;
  solutions?: LibraryItem;
  items: LibraryItem[];
  createdAt: string;
  attempts: ExamAttempt[];
  status: ExamStatus;
  last?: ExamAttempt;
  best?: ExamScore;
}

// Past exams (mirrors src/app/pastexams.ts)

export interface PastExamFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface PastExam {
  /** `MAD/2024-2025/MAD_JHH_24-25_TE1` */
  id: string;
  branch: string[];
  year: string;
  slug: string;
  meta: { title: string; course: string; teacher?: string; year: string; number: string; variant?: string; solutionsIncluded?: boolean; importedAt: string; sources: Record<string, string> };
  files: PastExamFile[];
  has: { original: boolean; blank: boolean; teacherSolutions: boolean; statement: boolean; statementPdf: boolean; solutions: boolean; solutionsPdf: boolean; pages: number };
  attempts: ExamAttempt[];
  status: ExamStatus;
  last?: ExamAttempt;
  best?: ExamScore;
}

export interface ProfileNote {
  id: number;
  course?: string;
  chapter?: string;
  section?: string;
  topic: string;
  kind: "weakness" | "strength" | "mistake" | "note";
  text: string;
  severity: 1 | 2 | 3;
  correctionId?: string;
  exercise?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TopicSummary {
  course: string | null;
  topic: string;
  count: number;
  severity: number;
  lastAt: string;
  examples: string[];
}

export type ChapterStatus = "mastered" | "fragile" | "struggling" | "unassessed";

export interface Section {
  position: number;
  title: string;
  keywords: string[];
}

export interface Chapter {
  id: number;
  course: string;
  position: number;
  title: string;
  keywords: string[];
  sections: Section[];
}

/** What the notes and quiz answers say about a chapter or a section. */
export interface Assessment {
  status: ChapterStatus;
  level: number;
  strengths: number;
  weaknesses: number;
  mistakes: number;
  quizCorrect: number;
  quizWrong: number;
  topics: string[];
}

export interface SectionSummary extends Section, Assessment {}

export interface ChapterSummary extends Chapter, Assessment {
  sections: SectionSummary[];
  unsectioned: string[];
}

export interface ProfileSummary {
  courses: {
    course: string | null;
    weaknesses: TopicSummary[];
    strengths: TopicSummary[];
    mistakes: TopicSummary[];
    verdicts?: { corrections: number; correct: number; partial: number; wrong: number; missing: number };
    /** The overall grade on the course's exercises (corrected exercises and quiz answers), Swiss scale. */
    score?: { exercises: { credit: number; total: number }; quiz: { correct: number; total: number }; ratio: number; grade: number };
    chapters: ChapterSummary[];
    unassigned: string[];
  }[];
  toRevise: (TopicSummary & { score: number })[];
  openNotes: number;
}

export interface SyncRun {
  id: number;
  kind: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  message?: string;
  stats?: Record<string, unknown>;
}

export interface StatusReport {
  at: string;
  services: { id: string; label: string; state: "up" | "down" | "warning" | "off"; detail?: string }[];
  login: { sessionSavedAt?: string; cyberlearnToken: boolean; needsCode: boolean; lastGapsOk?: string; lastCyberlearnOk?: string };
  syncs: SyncRun[];
  snapshots: Record<string, { fetchedAt: string; checkedAt: string }>;
  ingestion: { documents: number; chunks: number; courses: number; lastIndexedAt?: string; pending?: { checkedAt: string; added: number; changed: number; removed: number; indexed: number; courses: string[]; examples: string[] } };
  requests: { total: number; errors: number; unauthorized: number; lastUnauthorizedAt?: string; lastMcpAt?: string };
  syncing: boolean;
}

export interface RequestEntry {
  at: string;
  client: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  tool?: string;
  note?: string;
}

// Quizzes (mirrors src/app/quizzes.ts)

export interface QuizSummary {
  id: number;
  course?: string;
  title: string;
  description?: string;
  createdAt: string;
  questions: number;
  attempts: number;
  last?: { attemptId: number; score: number; total: number; finishedAt: string };
  best?: { score: number; total: number };
}

export interface QuizQuestion {
  id: number;
  quizId: number;
  position: number;
  statement: string;
  answer: boolean;
  explanation?: string;
  source?: string;
  topic?: string;
  chapter?: string;
  section?: string;
}

export interface QuizAttempt {
  id: number;
  quizId: number;
  mode: "web" | "voice" | "cli";
  startedAt: string;
  finishedAt?: string;
  total: number;
  answered: number;
  score: number;
}

export interface QuizAnswer {
  questionId: number;
  position: number;
  statement: string;
  expected: boolean;
  answer?: boolean;
  correct: boolean;
  explanation?: string;
  source?: string;
  topic?: string;
}

export interface QuizResult {
  attempt: QuizAttempt;
  quiz: { id: number; title: string; course?: string };
  answers: QuizAnswer[];
  mistakes: QuizAnswer[];
}

export interface QuizProgress {
  attempt: QuizAttempt;
  next?: { id: number; position: number; statement: string; topic?: string };
  result?: QuizResult;
}
