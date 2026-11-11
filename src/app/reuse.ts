/**
 * Nothing is made twice. On a shared server every student of a class asks for the same revision sheet, the same
 * deck, the same video of the same exercise: before anything new is created, what exists is compared with what is
 * asked, and a creation that looks like something existing is refused until the caller says it looked at each of
 * them and why none fits. The check is here, in the creation itself, so that no agent can skip it.
 */

export type Reusable = "document" | "video" | "deck" | "quiz";

export interface Existing {
  /** How the item is named in the tools: `document:name`, `deck 12`. */
  ref: string;
  title: string;
  course?: string;
  author?: string;
  mine: boolean;
}

/** What a caller says to create something that looks like existing items. */
export interface ReuseClaim {
  /** The references of the similar items it looked at. */
  checked?: string[];
  /** Why none of them fits: what the user needs that each of them lacks. */
  newBecause?: string;
}

export class AlreadyExists extends Error {
  constructor(
    message: string,
    readonly similar: Existing[],
  ) {
    super(message);
  }
}

/** Words that say nothing about the subject. */
const EMPTY = new Set(
  "a au aux avec ce ces dans de des du d en et l la le les leur ou par pour que qui sur un une the of and for to in on with from sans son sa ses est sont comment pourquoi quoi".split(" "),
);

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The words of a title or a file name that carry its subject; « serie6 » and « série 6 » give the same ones. */
export function subjectWords(text: string): Set<string> {
  const words = plain(text)
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !EMPTY.has(w))
    // Plurals and the like: « exercices » and « exercice » are the same subject.
    .map((w) => (w.length > 4 ? w.replace(/(es|s|x)$/, "") : w));
  return new Set(words);
}

/**
 * From 0 (nothing in common) to 1 (same subject): the share of the smaller title found in the other, tempered by
 * their sizes. `ignore`: words both have for another reason (the course code). Two titles whose numbers differ
 * (« série 6 exercice 3 » and « série 6 exercice 4 ») are about different things, whatever else they share.
 */
export function similarity(a: string, b: string, ignore: Iterable<string> = []): number {
  const x = subjectWords(a);
  const y = subjectWords(b);
  for (const word of ignore) for (const w of subjectWords(word)) (x.delete(w), y.delete(w));
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const word of x) if (y.has(word)) common++;
  const contained = common / Math.min(x.size, y.size);
  const jaccard = common / (x.size + y.size - common);
  // A single word of a long title found in a short one is not enough.
  const score = common < 2 && Math.max(x.size, y.size) > 2 ? jaccard : (contained + jaccard) / 2;
  const numbers = (set: Set<string>) => [...set].filter((w) => /^\d+$/.test(w)).sort().join(" ");
  return numbers(x) && numbers(y) && numbers(x) !== numbers(y) ? score / 2 : score;
}

const THRESHOLD = 0.55;

/** The existing items close to what is asked, closest first. Items of another course are never close. */
export function findSimilar(wanted: { title: string; course?: string }, existing: Existing[], limit = 6): Existing[] {
  const course = wanted.course?.trim().toUpperCase();
  return existing
    .filter((e) => !course || !e.course || e.course.toUpperCase() === course)
    .map((e) => ({ e, score: similarity(wanted.title, e.title, [course ?? "", e.course ?? ""]) }))
    .filter((s) => s.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

const describe = (e: Existing) => `- ${e.ref}: « ${e.title} »${e.course ? ` (${e.course})` : ""}${e.mine ? ", yours" : e.author ? `, by ${e.author}` : ""}`;

/**
 * Refuses a creation that looks like existing items, unless the claim names each of them and says why none fits.
 * `how`: how the caller reads the existing ones and what it does when one fits.
 */
export function requireNew(kind: Reusable, wanted: { title: string; course?: string }, existing: Existing[], claim: ReuseClaim | undefined, how: string): void {
  const similar = findSimilar(wanted, existing);
  if (similar.length === 0) return;
  const checked = new Set((claim?.checked ?? []).map((ref) => plain(ref).replace(/\s+/g, " ").trim()));
  const missing = similar.filter((e) => !checked.has(plain(e.ref)));
  const reason = claim?.newBecause?.trim() ?? "";
  if (missing.length === 0 && reason.length >= 20) return;
  const list = similar.map(describe).join("\n");
  const ask =
    missing.length === 0
      ? "`new_because` must say in a sentence what the user needs that each of them lacks."
      : `Only if none does, call again with \`checked\` (${similar.map((e) => `"${e.ref}"`).join(", ")}) and \`new_because\`: a sentence saying what the user needs that each of them lacks.`;
  throw new AlreadyExists(
    `Not created: this server is shared by a whole class and ${similar.length === 1 ? `a similar ${kind} already exists` : `similar ${kind}s already exist`}.\n${list}\n` +
      `${how} If one covers the need, give it to the user instead of making a copy. ${ask}`,
    similar,
  );
}

/** Reads the claim of a JSON body or of command line options. */
export function reuseClaim(checked: unknown, newBecause: unknown): ReuseClaim | undefined {
  const list = Array.isArray(checked) ? checked.filter((c): c is string => typeof c === "string") : typeof checked === "string" ? checked.split(",").map((c) => c.trim()).filter(Boolean) : undefined;
  const reason = typeof newBecause === "string" ? newBecause : undefined;
  return list || reason ? { checked: list, newBecause: reason } : undefined;
}
