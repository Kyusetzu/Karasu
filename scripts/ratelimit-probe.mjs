#!/usr/bin/env node
/**
 * Re-measures whether AniList's rate window rolls or steps, which `headroom` in anilist/client.rs models; needs real egress.
 *
 *   node scripts/ratelimit-probe.mjs
 */
const ENDPOINT = "https://graphql.anilist.co";
const QUERY = JSON.stringify({ query: "{ Media(id:1){ id } }" });

const sample = async (label) => {
  const started = Date.now();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Karasu/ratelimit-probe" },
      body: QUERY,
    });
  } catch (e) {
    console.log(`${label.padEnd(10)} request failed: ${e.message}`);
    return null;
  }
  const h = (n) => res.headers.get(n);
  const remaining = h("x-ratelimit-remaining");
  console.log(
    `${label.padEnd(10)} status ${res.status}  remaining ${remaining ?? "-"}` +
      `  limit ${h("x-ratelimit-limit") ?? "-"}` +
      `  reset ${h("x-ratelimit-reset") ?? "-"}` +
      `  retry-after ${h("retry-after") ?? "-"}` +
      `  (${Date.now() - started} ms)`,
  );
  return remaining === null ? null : Number(remaining);
};

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

console.log("baseline, then a burn, then recovery samples with nothing sent in between\n");

const first = await sample("baseline");
if (first === null) {
  console.error(
    "\nNo x-ratelimit-remaining came back. Either the host is unreachable from here" +
      " (check the egress policy) or AniList stopped sending the header -- and the" +
      " second of those is itself the finding.",
  );
  process.exit(1);
}

// Spend enough to be clearly below the limit without a 429, which would replace recovery with a Retry-After deadline.
for (let i = 0; i < 8; i++) await sample(`burn ${i + 1}`);

console.log("");
// Anchored to the wall clock, not summed waits: summing put the sample meant to be past the boundary exactly on it.
const t0 = Date.now();
for (const at of [5, 15, 30, 45, 60, 90]) {
  await wait(Math.max(0, at - (Date.now() - t0) / 1000));
  await sample(`+${at}s`);
}

console.log(
  "\nRead the recovery samples against the known shape: flat through +45 (each" +
    "\nsample costs one, so a count that only drops by one per sample is the" +
    "\nsamples' own cost, not a heal) and back to full at +60 or +90 is the" +
    "\nstepped window `headroom` models. A count that climbs across +5/+15/+30/+45" +
    "\nmeans AniList changed its limiter -- then `headroom` should heal" +
    "\nproportionally, and CLAUDE.md's rate-window note needs rewriting first.",
);
