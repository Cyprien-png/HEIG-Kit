import DOMPurify from "dompurify";
import katex from "katex";
import { type Tokens, marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { useIsDark } from "../lib/auth";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Two fenced blocks become pictures: ```svg is inlined as a drawing on a paper-like surface, ```mermaid is drawn by
 * Mermaid once mounted (its source waits in a <pre>: an attribute holding `-->` would not survive sanitizing). Every
 * other fence stays code.
 */
/**
 * A drawing as written by the agent, made to show in every browser: an <svg> with only a viewBox has no size of its
 * own and collapses to nothing in a figure that fits its content, so such a drawing takes the width it is given
 * ("fluid"); a transform on the root <svg> (not drawn by Safari) moves to a group around its content.
 */
export function drawing(text: string): string {
  const open = /<svg\b([^>]*)>/i.exec(text);
  if (!open) return `<figure class="drawing">${text}</figure>`;
  let attrs = open[1];
  let body = text.slice(open.index + open[0].length);
  const transform = /\stransform\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs);
  if (transform) {
    attrs = attrs.replace(transform[0], "");
    const end = body.toLowerCase().lastIndexOf("</svg>");
    body = end >= 0 ? `<g transform=${transform[1]}>${body.slice(0, end)}</g>${body.slice(end)}` : body;
  }
  const sized = /\swidth\s*=/i.test(attrs);
  return `<figure class="drawing${sized ? "" : " fluid"}">${text.slice(0, open.index)}<svg${attrs}>${body}</figure>`;
}

const renderer = {
  code({ text, lang }: Tokens.Code): string | false {
    const language = (lang ?? "").trim().toLowerCase();
    if (language === "svg") return drawing(text);
    if (language === "mermaid") return `<figure class="mermaid"><pre>${escapeHtml(text)}</pre></figure>`;
    return false;
  },
};
marked.use({ gfm: true, breaks: false, renderer });

/** Replaces $$…$$ and $…$ with rendered KaTeX before Markdown runs, so underscores in formulas survive. */
function renderMath(source: string): string {
  const blocks: string[] = [];
  const keep = (html: string) => {
    blocks.push(html);
    return `\u0000${blocks.length - 1}\u0000`;
  };
  // Fenced code first: a dollar in a drawing or a program is not a formula.
  let text = source.replace(/```[\s\S]*?```/g, (code) => keep(code));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false, strict: "ignore" })));
  text = text.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (_, before: string, tex: string) => before + keep(katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: "ignore" })));
  // Fences go back before Markdown runs (they are Markdown), formulas after (they are HTML).
  text = text.replace(/\u0000(\d+)\u0000/g, (match, i: string) => (blocks[Number(i)].startsWith("```") ? blocks[Number(i)] : match));
  const html = marked.parse(text, { async: false }) as string;
  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => blocks[Number(i)]);
}

export function markdownToHtml(source: string): string {
  return DOMPurify.sanitize(renderMath(source), { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "iframe", "object", "embed", "foreignObject"] });
}

let mermaidId = 0;

/** Draws the Mermaid figures of a container, in the colours of the current theme. */
async function drawMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const figures = [...root.querySelectorAll<HTMLElement>("figure.mermaid")];
  if (figures.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit" });
  for (const figure of figures) {
    // The source is kept on the element once drawn, for the next theme.
    const source = figure.dataset.source ?? figure.querySelector("pre")?.textContent ?? "";
    figure.dataset.source = source;
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidId}`, source);
      figure.innerHTML = svg;
      figure.classList.remove("mermaid-error");
    } catch (error) {
      figure.innerHTML = `<pre>${escapeHtml(source)}</pre><p class="mermaid-message">${escapeHtml(error instanceof Error ? error.message.split("\n")[0] : String(error))}</p>`;
      figure.classList.add("mermaid-error");
      // Mermaid leaves the element it failed on in the document.
      document.getElementById(`dmermaid-${mermaidId}`)?.remove();
    }
  }
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => markdownToHtml(source ?? ""), [source]);
  const ref = useRef<HTMLDivElement>(null);
  const dark = useIsDark();
  useEffect(() => {
    if (ref.current && html.includes('class="mermaid"')) void drawMermaid(ref.current, dark);
  }, [html, dark]);
  return <div ref={ref} className={`prose-kit ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
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
