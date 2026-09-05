import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { NotFound } from "./NotFound";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

// Dev only: the token and type sample at `#sample`. `import.meta.env.DEV` is
// a constant at build time, so the production bundle carries none of it.
if (import.meta.env.DEV && location.hash === "#sample") {
  const { Sample } = await import("./dev/Sample");
  createRoot(root).render(
    <StrictMode>
      <Sample />
    </StrictMode>,
  );
} else {
  // `prerender.mjs` stamps the 404 page; everything else is the landing page.
  const page = root.dataset.page === "404" ? <NotFound /> : <App />;
  const tree = <StrictMode>{page}</StrictMode>;

  // A pre-rendered page hydrates; the dev server, which serves the bare
  // template, mounts from scratch. Element children, not child nodes: the
  // template's placeholder comment is a node too, and hydrating onto it was
  // a mismatch on every dev load.
  if (root.firstElementChild) {
    hydrateRoot(root, tree);
  } else {
    createRoot(root).render(tree);
  }
}
