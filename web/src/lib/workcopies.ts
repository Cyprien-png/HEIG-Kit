import { api } from "./api";
import type { Workcopy } from "./types";

export interface CopySource {
  title: string;
  course?: string;
  /** The exam it answers (`document:<name>` or `exam:<id>`), passed to the correction. */
  exam?: string;
  label?: string;
}

/** Creates a work copy of a PDF: the record, then the file. */
export async function makeCopy(source: CopySource, bytes: ArrayBuffer, pages?: number): Promise<Workcopy> {
  const copy = await api<Workcopy>("/api/workcopies", { method: "POST", json: { title: source.title, course: source.course, exam: source.exam, sourceLabel: source.label, pageCount: pages } });
  try {
    return await api<Workcopy>(`/api/workcopies/${copy.id}/source`, { method: "PUT", body: bytes, headers: { "Content-Type": "application/pdf" } });
  } catch (error) {
    await api(`/api/workcopies/${copy.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
