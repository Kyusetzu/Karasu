import { renderToStaticMarkup } from "react-dom/server";

/** Static-markup readers for the chart tests; no DOM, so their files stay in the node project. */

export const html = (node: React.ReactElement) => renderToStaticMarkup(node);

/** Text content only, so a value cannot be "found" inside a path's geometry. */
export function texts(markup: string): string[] {
  return [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}
