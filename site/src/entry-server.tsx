import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { NotFound } from "./NotFound";
import { headFor } from "./head";

/**
 * What `scripts/prerender.mjs` calls, once per page. Nothing here may touch
 * `window`, `document`, `matchMedia` or the clock: the markup this returns is
 * what a crawler, a reader with JavaScript off and a reduced-motion user all
 * get, and it has to hydrate without a mismatch.
 */
export function render(path: string): { html: string; head: string } {
  const notFound = path !== "/";
  const html = renderToString(
    <StrictMode>{notFound ? <NotFound /> : <App />}</StrictMode>,
  );
  return { html, head: headFor(notFound ? "404" : "home") };
}
