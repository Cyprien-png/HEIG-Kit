/**
 * The course knowledge base behind one interface: the local database (this computer, or the server itself) or a
 * remote server's API (HEIG_REMOTE_URL), so that a laptop uses the courses indexed on the server without indexing
 * them again.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import type { Db } from "../rag/db.js";
import { type DocumentText, type SearchFilters, type SearchResult, documentText, figureFile, findExercise, listCourses, listDocuments, search } from "../rag/search.js";
import type { RemoteClient } from "../remote/client.js";

export interface CourseSummary {
  course: string | null;
  name: string | null;
  teachers: string[] | null;
  documents: number;
  docTypes: string[];
}

export interface DocumentSummary {
  id: number;
  title: string;
  docType: string;
  chapter: string | null;
  uploadedAt: string | Date | null;
  url: string | null;
}

export interface KnowledgeBase {
  search(query: string, filters?: SearchFilters): Promise<SearchResult[]>;
  exercise(course: string | undefined, number: string): Promise<SearchResult[]>;
  document(id: number, pageFrom?: number, pageTo?: number): Promise<DocumentText | undefined>;
  figure(id: number, number: number): Promise<Buffer | undefined>;
  courses(): Promise<CourseSummary[]>;
  documents(course: string, docType?: string): Promise<DocumentSummary[]>;
}

export class LocalKnowledge implements KnowledgeBase {
  constructor(readonly db: Db) {}

  search(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    return search(this.db, query, filters);
  }
  exercise(course: string | undefined, number: string): Promise<SearchResult[]> {
    return findExercise(this.db, course, number);
  }
  document(id: number, pageFrom?: number, pageTo?: number): Promise<DocumentText | undefined> {
    return documentText(this.db, id, pageFrom, pageTo);
  }
  async figure(id: number, number: number): Promise<Buffer | undefined> {
    const file = await figureFile(this.db, id, number);
    return file ? readFile(file) : undefined;
  }
  courses(): Promise<CourseSummary[]> {
    return listCourses(this.db);
  }
  documents(course: string, docType?: string): Promise<DocumentSummary[]> {
    return listDocuments(this.db, course, docType);
  }

  /** The original file of a document (PDF, DOCX…) under data/, with its name, if it was downloaded. */
  async file(id: number): Promise<{ file: string; name: string; title: string } | undefined> {
    const { rows } = await this.db.query<{ local_path: string | null; title: string }>("SELECT local_path, title FROM documents WHERE id = $1 AND removed_at IS NULL", [id]);
    const localPath = rows[0]?.local_path;
    if (!localPath) return undefined;
    const file = path.isAbsolute(localPath) ? localPath : path.join(DATA_DIR, path.relative("data", localPath));
    return { file, name: path.basename(file), title: rows[0].title };
  }
}

export class RemoteKnowledge implements KnowledgeBase {
  constructor(private readonly client: RemoteClient) {}

  private query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : "";
  }

  async search(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
    return (await this.client.get<{ results: SearchResult[] }>(`/api/kb/search${this.query({ q: query, course: filters.course, type: filters.docType, limit: filters.limit })}`)).results;
  }
  async exercise(course: string | undefined, number: string): Promise<SearchResult[]> {
    return (await this.client.get<{ results: SearchResult[] }>(`/api/kb/exercise${this.query({ number, course })}`)).results;
  }
  async document(id: number, pageFrom?: number, pageTo?: number): Promise<DocumentText | undefined> {
    try {
      return await this.client.get<DocumentText>(`/api/kb/documents/${id}${this.query({ from: pageFrom, to: pageTo })}`);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
  }
  async figure(id: number, number: number): Promise<Buffer | undefined> {
    try {
      return Buffer.from(await (await this.client.request("GET", `/api/kb/documents/${id}/figures/${number}`)).arrayBuffer());
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
  }
  async courses(): Promise<CourseSummary[]> {
    return (await this.client.get<{ courses: CourseSummary[] }>("/api/kb/courses")).courses;
  }
  async documents(course: string, docType?: string): Promise<DocumentSummary[]> {
    return (await this.client.get<{ documents: DocumentSummary[] }>(`/api/kb/courses/${encodeURIComponent(course)}/documents${this.query({ type: docType })}`)).documents;
  }
}
