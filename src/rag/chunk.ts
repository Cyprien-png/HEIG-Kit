import { PAGE_BREAK } from "./extract.js";

export interface Chunk {
  ordinal: number;
  pageFrom: number;
  pageTo: number;
  /** Headings leading to the chunk, e.g. "Relations > 2.4 Relations d'ordre". */
  headingPath: string;
  /** Exercise number when the chunk is one exercise (or its solution), e.g. "2.22". */
  exercise?: string;
  text: string;
}

export interface ChunkOptions {
  /**
   * Exercise sheets, solutions and exams: numbered items ("2.18 …", "## 2.22 Title") start a new exercise.
   * Other documents only split on explicit "Exercice 3" markers, since their numbered headings are sections.
   */
  exercises: boolean;
  /** Target chunk size in characters (about 4 characters per token). */
  maxChars?: number;
}

interface Block {
  page: number;
  /** Last page of a block continued on the following pages (an exercise with its lines), when not `page`. */
  pageTo?: number;
  text: string;
  heading?: { level: number; title: string };
  exercise?: string;
}

const DEFAULT_MAX_CHARS = 2400;
const MIN_CHARS = 40;
const HEADING = /^(#{1,6})\s+(.*)$/;
const EXPLICIT_EXERCISE = /^(?:#{1,6}\s+|[-*]\s+)?(?:\*\*)?(?:exercice|exercise|ex\.)\s*(\d+(?:\.\d+)*)/i;
const NUMBERED_ITEM = /^(?:#{1,6}\s+|[-*]\s+)(\d{1,2}\.\d{1,3})(?=\s|$)/;
const TABLE_OF_CONTENTS = /^(table des matières|sommaire|contents|table of contents)$/i;

/** Splits extracted markdown (pages separated by `PAGE_BREAK`) along its structure. */
export function chunkMarkdown(markdown: string, options: ChunkOptions): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const blocks = toBlocks(markdown, options.exercises);
  const chunks: Chunk[] = [];
  const headings: { level: number; title: string }[] = [];
  let current: { blocks: Block[]; headingPath: string; exercise?: string } | undefined;
  let skipping = false;

  const flush = () => {
    if (current) chunks.push(...split(current.blocks, current.headingPath, current.exercise, maxChars));
    current = undefined;
  };

  for (const block of blocks) {
    if (block.heading) {
      flush();
      while (headings.length > 0 && headings.at(-1)!.level >= block.heading.level) headings.pop();
      headings.push(block.heading);
      skipping = TABLE_OF_CONTENTS.test(block.heading.title);
      continue;
    }
    if (skipping) continue;

    const headingPath = headings.map((h) => h.title).join(" > ");
    if (block.exercise || !current || current.headingPath !== headingPath) {
      flush();
      current = { blocks: [], headingPath, exercise: block.exercise };
    }
    current.blocks.push(block);
  }
  flush();

  return chunks.filter((c) => c.text.replace(/\[formule\]/g, "").trim().length >= MIN_CHARS).map((c, i) => ({ ...c, ordinal: i }));
}

/** Paragraph-level blocks with their page, headings and exercise starts recognized. */
function toBlocks(markdown: string, exerciseSheet: boolean): Block[] {
  const tocNumbers = tableOfContentsNumbers(markdown);
  const blocks: Block[] = [];
  let page = 1;
  let paragraph: string[] = [];
  let paragraphPage = page;

  const endParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ page: paragraphPage, text });
    paragraph = [];
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/<!-- formula-not-decoded -->/g, "[formule]").trimEnd();
    if (line.trim() === PAGE_BREAK) {
      endParagraph();
      page++;
      continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(line)) continue; // image placeholders and other markers

    const exercise = EXPLICIT_EXERCISE.exec(line)?.[1] ?? (exerciseSheet ? NUMBERED_ITEM.exec(line)?.[1] : undefined);
    const heading = HEADING.exec(line);
    const isSection = heading && (!exercise || tocNumbers.has(exercise));

    if (isSection) {
      endParagraph();
      blocks.push({ page, text: "", heading: { level: heading[1].length, title: heading[2].trim() } });
    } else if (exercise) {
      endParagraph();
      blocks.push({ page, text: line.replace(/^#{1,6}\s+/, ""), exercise });
    } else if (!line.trim()) {
      endParagraph();
    } else {
      if (paragraph.length === 0) paragraphPage = page;
      paragraph.push(line);
    }
  }
  endParagraph();

  // Lines following an exercise start belong to that exercise until the next one or the next section.
  for (let i = 1; i < blocks.length; i++) {
    const previous = blocks[i - 1];
    if (!blocks[i].heading && !blocks[i].exercise && previous.exercise && !previous.heading) {
      previous.text += `\n\n${blocks[i].text}`;
      previous.pageTo = blocks[i].pageTo ?? blocks[i].page;
      blocks.splice(i--, 1);
    }
  }
  return blocks;
}

/** Section numbers listed in a table of contents ("| 2.4 | Relations d'ordre …"), to tell sections from exercises. */
function tableOfContentsNumbers(markdown: string): Set<string> {
  const numbers = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (line.startsWith("|") && /\.\s?\.\s?\./.test(line)) {
      for (const match of line.matchAll(/(?:^|[|\s])(\d{1,2}\.\d{1,2})(?=\s|\|)/g)) numbers.add(match[1]);
    }
  }
  return numbers;
}

/** Groups blocks into chunks of at most `maxChars`, repeating the last paragraph of a chunk at the start of the next. */
function split(blocks: Block[], headingPath: string, exercise: string | undefined, maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let parts: Block[] = [];
  const emit = () => {
    if (parts.length === 0) return;
    chunks.push({
      ordinal: 0,
      pageFrom: parts[0].page,
      pageTo: Math.max(...parts.map((p) => p.pageTo ?? p.page)),
      headingPath,
      exercise,
      text: parts.map((p) => p.text).join("\n\n"),
    });
  };

  for (const block of blocks.flatMap((b) => splitLong(b, maxChars))) {
    const size = parts.reduce((n, p) => n + p.text.length, 0);
    if (parts.length > 0 && size + block.text.length > maxChars) {
      emit();
      parts = parts.length > 1 ? [parts.at(-1)!] : [];
    }
    parts.push(block);
  }
  emit();
  return chunks;
}

/** Splits a block longer than `maxChars` (a huge table, an exercise with many parts) at line boundaries. */
function splitLong(block: Block, maxChars: number): Block[] {
  if (block.text.length <= maxChars) return [block];
  const pieces: Block[] = [];
  let lines: string[] = [];
  for (const line of block.text.split("\n")) {
    if (lines.length > 0 && lines.join("\n").length + line.length > maxChars) {
      pieces.push({ ...block, text: lines.join("\n") });
      lines = [];
    }
    lines.push(line);
  }
  if (lines.length > 0) pieces.push({ ...block, text: lines.join("\n") });
  return pieces;
}
