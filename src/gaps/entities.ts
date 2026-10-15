import * as cheerio from "cheerio";
import { type EntityType, ENTITY_TYPES, type GapsClient, currentAcademicYear } from "./client.js";

/** Something with a schedule in GAPS: a student, a teacher (acronym), a course group, a room or a class. */
export interface Entity {
  type: EntityType;
  id: string;
  name: string;
}

const TYPE_BY_NUMBER = Object.fromEntries(Object.entries(ENTITY_TYPES).map(([name, n]) => [n, name])) as Record<number, EntityType>;

/** Every entity of the schedule menu of GAPS for the current semester. */
export async function listEntities(gaps: GapsClient, now = new Date()): Promise<Entity[]> {
  const term = now.getMonth() >= 7 || now.getMonth() === 0 ? 1 : 3;
  const html = await gaps.sajax<string>("/consultation/horaires/", "getMenuHoraire", [currentAcademicYear(now), term, null]);
  const $ = cheerio.load(html);
  const entities = new Map<string, Entity>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const type = TYPE_BY_NUMBER[Number(/[?&]type=(\d+)/.exec(href)?.[1])];
    const id = /[?&]id=([^&]+)/.exec(href)?.[1];
    if (type && id) entities.set(`${type}:${id}`, { type, id: decodeURIComponent(id), name: $(a).text().trim() });
  });
  return [...entities.values()];
}

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Entities matching a query, best first: exact name (an acronym, a room, a class), then names containing every
 * word of the query (in any order, e.g. "dupont marie"). `type` restricts the search.
 */
export function searchEntities(entities: Entity[], query: string, type?: EntityType): Entity[] {
  const q = normalize(query);
  const words = q.split(" ");
  const candidates = entities.filter((e) => !type || e.type === type);
  const exact = candidates.filter((e) => normalize(e.name) === q || e.id.toLowerCase() === q);
  const partial = candidates.filter((e) => !exact.includes(e) && words.every((w) => normalize(e.name).includes(w)));
  return [...exact, ...partial];
}
