import { marked } from 'marked';

// Render a single line of inline markdown (bold/italic/code/links) to HTML.
// parseInline avoids block-level <p> wrapping so it drops into inline spans;
// { async: false } selects the sync overload so the return is a real string
// (no cast) and a future async hook can't slip a Promise into set:html.
export function inlineMarkdown(text: string): string {
  return marked.parseInline(text, { async: false });
}
