export type DocType = "lecture" | "exercises" | "solutions" | "exam" | "lab" | "planning" | "other";

/** A document offered by a source, with what is needed to decide whether to (re)index it. */
export interface SourceDocument {
  source: string;
  /** Stable id within the source: the same document keeps it across runs. */
  externalId: string;
  title: string;
  url?: string;
  /** Cheap source-side version (modification date, size…): unchanged versions are skipped without loading. */
  version: string;
  /** File name, whose extension decides how the document is extracted (`.md` for text from web pages). */
  filename: string;
  /** Where the original is kept, relative to the project root (or absolute for local folders). */
  localPath: string;
  courseCode?: string;
  courseName?: string;
  teachers: string[];
  chapter?: string;
  docType: DocType;
  uploadedAt?: Date;
  load(): Promise<Buffer>;
}

export interface Source {
  name: string;
  list(): Promise<SourceDocument[]>;
}

/** Guesses the kind of document from its title, file name and chapter (French or English course names). */
export function guessDocType(...names: (string | undefined)[]): DocType {
  // NFC: Moodle sometimes stores accents decomposed ("e" + combining accent).
  const text = names.filter(Boolean).join(" ").normalize("NFC").toLowerCase();
  if (/corrig|correction|solution/.test(text)) return "solutions";
  if (/\bte\s?\d|\btests?\s?\d|tests? d'entra[iî]nement|travail écrit|travaux écrits|examen|exam\b|épreuve/.test(text)) return "exam";
  if (/planning|planification|travail à faire|programme/.test(text)) return "planning";
  if (/labo|laboratoire|\blab\b|\bl\d{2}/.test(text)) return "lab";
  if (/exercice|exercise|série|serie|révision|énoncé|enonce|\bex[\s_-]?\d/.test(text)) return "exercises";
  if (/cours|polycop|chapitre|slides|lecture|notes/.test(text)) return "lecture";
  return "other";
}

/** File or folder name safe on every OS. */
export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "_";
}
