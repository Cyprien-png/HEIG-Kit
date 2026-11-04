import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: false });

/** Replaces $$…$$ and $…$ with rendered KaTeX before Markdown runs, so underscores in formulas survive. */
function renderMath(source: string): string {
  const blocks: string[] = [];
  const keep = (html: string) => {
    blocks.push(html);
    return `\u0000${blocks.length - 1}\u0000`;
  };
  let text = source.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false, strict: "ignore" })));
  text = text.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (_, before: string, tex: string) => before + keep(katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: "ignore" })));
  const html = marked.parse(text, { async: false }) as string;
  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => blocks[Number(i)]);
}

export function markdownToHtml(source: string): string {
  return DOMPurify.sanitize(renderMath(source), { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "iframe", "object", "embed"] });
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => markdownToHtml(source ?? ""), [source]);
  return <div className={`prose-kit ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The first words of a Markdown text as plain text, for a one-line summary. */
export function excerpt(source: string | undefined, max = 120): string {
  if (!source) return "";
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
