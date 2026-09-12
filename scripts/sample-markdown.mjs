#!/usr/bin/env node
/**
 * Samples real AniList markdown beside its `asHtml` form, as the fixtures anilistMarkdown.fixtures.test.ts compares against.
 *
 *   node scripts/sample-markdown.mjs          unauthenticated, straight to graphql.anilist.co
 *   node scripts/sample-markdown.mjs --rig    through the running desktop test rig, as its account
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "src/lib/fixtures/anilistMarkdown.fixtures.json");
const ENDPOINT = "https://graphql.anilist.co";
const CDP = "http://127.0.0.1:9222";

/** What each sample is there for — the shape it exercises. */
const SAMPLES = [
  {
    kind: "about",
    id: 6975140,
    note: "one-line centred rows, bare <a> art, &plus;, two favicons inside links (one an ICO)",
  },
  { kind: "comment", id: 3151776, note: "a mention, then img220(…) on a line of its own" },
  { kind: "comment", id: 3242081, note: "a mention, a score line, img300(…)" },
  {
    kind: "text",
    id: 1154088020,
    note: "a #heading with no space inside <center>, then a spoiler spanning paragraphs with four images inside",
    // The site draws the first line as an <h1> where `asHtml` keeps the `#` literal, so headings are not graded here.
    compare: ["spoilers", "images", "links"],
  },
  {
    kind: "text",
    id: 1154093188,
    note: "a <center> block spanning the whole post: #__heading__ rows, <hr>, a bare anime URL, a spoiler holding an image",
    // `asHtml` leaves markdown inside an HTML block literal and the site renders it, so headings and links are not graded.
    compare: ["spoilers", "images"],
  },
  { kind: "text", id: 1154078329, note: "~~~ inside a # heading, a spoiler in the centre, img350 rows" },
  { kind: "text", id: 1154078012, note: "an inline spoiler after a quote joined with <br />" },
];

const QUERIES = {
  about: `query ($id: Int) { User(id: $id) { id raw: about html: about(asHtml: true) } }`,
  comment: `query ($id: Int) { ThreadComment(id: $id) { id raw: comment html: comment(asHtml: true) } }`,
  text: `query ($id: Int) { Activity(id: $id) { ... on TextActivity { id raw: text html: text(asHtml: true) } } }`,
};

function pick(kind, id, data) {
  const node =
    kind === "about" ? data.User : kind === "comment" ? data.ThreadComment?.[0] : data.Activity;
  if (!node || node.id !== id) {
    const hint = node
      ? ` (answered ${node.id} — for a comment that means ${id} is a nested reply; sample its root instead)`
      : "";
    throw new Error(`${kind} ${id}: not found${hint}`);
  }
  if (typeof node.raw !== "string" || typeof node.html !== "string") {
    throw new Error(`${kind} ${id}: empty`);
  }
  return { raw: node.raw, html: node.html };
}

async function direct(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

/** One `anilist_query` evaluated in the rig's page over CDP, so the token never leaves Rust. */
async function viaRig(query, variables) {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find(
    (t) => t.type === "page" && t.url.startsWith("http://tauri.localhost"),
  );
  if (!page) {
    throw new Error(
      `no Karasu page on ${CDP}; launch the rig first (site/scripts/capture-desktop.mjs launch)`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const call = JSON.stringify({ query, variables });
  const expression = `window.__TAURI_INTERNALS__.invoke("anilist_query", ${call}).then(
    (v) => JSON.stringify({ data: v }),
    (e) => JSON.stringify({ error: String(e) }),
  )`;
  const reply = new Promise((resolve) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1) resolve(msg);
    };
  });
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
  const msg = await reply;
  ws.close();
  if (msg.result?.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
  const value = JSON.parse(msg.result.result.value);
  if (value.error) throw new Error(value.error);
  return value.data;
}

const send = process.argv.includes("--rig") ? viaRig : direct;
const samples = [];
for (const s of SAMPLES) {
  const data = await send(QUERIES[s.kind], { id: s.id });
  const { raw, html } = pick(s.kind, s.id, data);
  samples.push({ ...s, raw, html });
  console.log(`${s.kind} ${s.id}: ${raw.length} chars raw, ${html.length} as HTML`);
}
mkdirSync(dirname(OUT), { recursive: true });
const sampledAt = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, `${JSON.stringify({ sampledAt, samples }, null, 2)}\n`);
console.log(`wrote ${OUT}`);
