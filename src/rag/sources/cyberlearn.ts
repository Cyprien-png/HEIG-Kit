import { createHash } from "node:crypto";
import path from "node:path";
import { htmlToText } from "../../courses.js";
import type { Course, CyberlearnClient, Module, Section } from "../../cyberlearn/client.js";
import { courseLabel } from "../../deadlines.js";
import { EXTRACTABLE } from "../extract.js";
import { type DocType, type Source, type SourceDocument, guessDocType, safeName } from "./source.js";

/** Shorter texts on course pages are titles ("Support de cours"), not content. */
const MIN_TEXT_CHARS = 40;

/**
 * Cyberlearn courses: files of resources and folders, and the text written on course pages (section
 * descriptions, labels, pages, activity instructions), where teachers publish plannings and homework.
 */
export interface CourseSelection {
  /** Only these courses (timetable codes, ids or parts of names), whatever the other settings. */
  only?: string[];
  /** Every Cyberlearn course instead of the timetable's courses only. */
  all?: boolean;
  /** Courses added to the timetable's ones (e.g. a course without lessons in GAPS). */
  extra?: string[];
  /** Courses never indexed. */
  exclude?: string[];
}

/**
 * Cyberlearn courses: files of resources and folders, and the text written on course pages (section
 * descriptions, labels, pages, activity instructions), where teachers publish plannings and homework.
 *
 * By default only the courses of the student's curriculum are listed: those whose code appears in the GAPS
 * timetable. Courses of a new semester are therefore picked up as soon as they appear in the timetable.
 */
export class CyberlearnSource implements Source {
  readonly name = "cyberlearn";
  /** Codes of the courses selected by the last `list()`. */
  selectedCourses: string[] = [];

  constructor(
    private readonly client: CyberlearnClient,
    /** Timetable course codes, so documents use the same codes as the timetable (e.g. MAD). */
    private readonly scheduleCodes: string[],
    private readonly selection: CourseSelection = {},
  ) {}

  async list(): Promise<SourceDocument[]> {
    const documents: SourceDocument[] = [];
    this.selectedCourses = [];
    for (const course of await this.client.courses()) {
      // Courses outside the timetable (e.g. self-study courses) keep their Cyberlearn short name.
      const label = courseLabel(course.shortName, this.scheduleCodes);
      const inTimetable = this.scheduleCodes.includes(label);
      const code = this.scheduleCodes.length === 0 || inTimetable ? label : course.shortName;
      if (!this.isSelected(course, code, inTimetable)) continue;

      this.selectedCourses.push(code);
      for (const section of await this.client.courseContents(course.id)) {
        documents.push(...(await this.sectionDocuments(course, code, section)));
      }
    }
    return documents;
  }

  private isSelected(course: Course, code: string, inTimetable: boolean): boolean {
    const matches = (queries: string[] = []) =>
      queries.some((q) => {
        const query = q.trim().toLowerCase();
        return (
          query === code.toLowerCase() ||
          query === String(course.id) ||
          course.shortName.toLowerCase().includes(query) ||
          course.fullName.toLowerCase().includes(query)
        );
      });
    if (this.selection.only?.length) return matches(this.selection.only);
    if (matches(this.selection.exclude)) return false;
    return Boolean(this.selection.all) || inTimetable || matches(this.selection.extra);
  }

  private async sectionDocuments(course: Course, code: string, section: Section): Promise<SourceDocument[]> {
    const base = {
      source: this.name,
      courseCode: code,
      courseName: course.fullName,
      teachers: course.teachers,
      chapter: section.name,
    };
    const folder = path.join("data", "documents", "cyberlearn", safeName(code), safeName(section.name));
    const documents: SourceDocument[] = [];

    const summary = htmlToText(section.summary);
    if (summary.length >= MIN_TEXT_CHARS) {
      documents.push(
        textDocument({ ...base, externalId: `section:${section.id}`, title: section.name, url: courseUrl(course) }, folder, summary),
      );
    }

    for (const module of section.modules) {
      const docType = guessDocType(module.name, section.name);
      if (module.modname === "page") {
        const index = module.contents?.find((f) => f.filename === "index.html");
        if (!index) continue;
        documents.push({
          ...base,
          externalId: `page:${module.id}`,
          title: module.name,
          url: module.url,
          version: `${index.timemodified ?? 0}:${index.filesize ?? 0}`,
          filename: `${safeName(module.name)}.md`,
          localPath: path.join(folder, `${safeName(module.name)}.md`),
          docType: docType === "other" ? "planning" : docType,
          uploadedAt: index.timemodified ? new Date(index.timemodified * 1000) : undefined,
          load: async () => Buffer.from(htmlToText(new TextDecoder().decode(await this.client.downloadFile(index.fileurl)))),
        });
        continue;
      }

      const description = htmlToText(module.description ?? "");
      if (description.length >= MIN_TEXT_CHARS) {
        const title = module.modname === "label" ? description.split("\n")[0].slice(0, 120) : module.name;
        documents.push(
          textDocument(
            { ...base, externalId: `module:${module.id}`, title, url: module.url ?? courseUrl(course) },
            folder,
            description,
            guessDocType(title, section.name),
          ),
        );
      }

      if (module.modname === "resource" || module.modname === "folder") {
        // Files in a numbered chapter section ("3- Algèbre de Boole") are lecture material unless named otherwise.
        const fileType = docType === "other" && /^\d/.test(section.name) ? "lecture" : docType;
        documents.push(...this.fileDocuments(base, folder, module, fileType));
      }
    }
    return documents;
  }

  private fileDocuments(
    base: Omit<SourceDocument, "externalId" | "title" | "version" | "filename" | "localPath" | "docType" | "load">,
    folder: string,
    module: Module,
    docType: DocType,
  ): SourceDocument[] {
    return (module.contents ?? [])
      .filter((f) => f.type === "file" && EXTRACTABLE.test(f.filename))
      .map((file) => {
        const filepath = (file.filepath ?? "/").replace(/^\/|\/$/g, "");
        const relative = [filepath, file.filename].filter(Boolean).map(safeName);
        return {
          ...base,
          externalId: `file:${module.id}:${filepath}/${file.filename}`,
          title: module.modname === "folder" ? `${module.name} / ${file.filename}` : module.name,
          url: module.url,
          version: `${file.timemodified ?? 0}:${file.filesize ?? 0}`,
          filename: file.filename,
          localPath: path.join(folder, ...relative),
          docType: docType === "other" ? guessDocType(file.filename) : docType,
          uploadedAt: file.timemodified ? new Date(file.timemodified * 1000) : undefined,
          load: async () => Buffer.from(await this.client.downloadFile(file.fileurl)),
        };
      });
  }
}

/** A document made of text written on the course page; its version is the text's hash. */
function textDocument(
  base: Omit<SourceDocument, "version" | "filename" | "localPath" | "docType" | "load">,
  folder: string,
  text: string,
  docType: DocType = guessDocType(base.title, base.chapter),
): SourceDocument {
  const filename = `${safeName(base.title)}.md`;
  return {
    ...base,
    version: createHash("sha256").update(text).digest("hex").slice(0, 16),
    filename,
    localPath: path.join(folder, filename),
    docType,
    load: async () => Buffer.from(text),
  };
}

function courseUrl(course: Course): string {
  return `https://cyberlearn.hes-so.ch/course/view.php?id=${course.id}`;
}
