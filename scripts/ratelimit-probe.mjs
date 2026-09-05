#!/usr/bin/env node
/**
 * Re-measures the shape of AniList's rate window: does it *roll*, or does it
 * reset in a step?
 *
 * The answer is known. Measured twice on 2026-09-03 (unauthenticated, two
 * minutes apart, identical both times): a burn to 21 read 20, 19, 18, 17 at
 * +5/+15/+30/+45 s -- each sample costing exactly one and nothing returning --
 * and 29 at +60 s. Flat, then the whole budget at once, about 60 s after the
 * first request of the window. **Stepped.** `headroom` in `anilist/client.rs`
 * models exactly that, and CLAUDE.md's notes carry the numbers.
 *
 * Why the script stays: the limiter's model is a claim about a server nobody
 * here runs, and the day AniList changes it, this is the ten-minute way to
 * find out. Run it before touching `headroom`, `SLICE` or `MAX_PACE`. Healing
 * proportionally would be right for a rolling window, and for this one it
 * hands out budget that does not exist and earns the 429s the limiter exists
 * to avoid -- which is why this is a measurement and not an argument.
 *
 * The one question it does *not* settle is whether the bucket is per IP or
 * per token. To find out: run it twice at once from two machines on different
 * networks, one of them sending `Authorization: Bearer <token>` on every
 * request (add the header to `sample`). If the tokened machine's count falls
 * with the other's, the bucket is per IP; if each keeps its own 30, per token.
 *
 * The experiment: spend the budget down, then watch `x-ratelimit-remaining`
 * recover while sending nothing. A rolling window climbs back gradually; a
 * stepped one sits flat and then jumps.
 *
 * Sampling costs one request each, which spends budget in the very window being
 * observed -- so the samples are deliberately sparse and the burn is small. The
 * shape (gradual versus flat-then-jump) survives that; exact numbers do not.
 *
 *   node scripts/ratelimit-probe.mjs
 *
 * Unauthenticated and read-only: it asks for one media id and nothing else.
 * Needs real network access to graphql.anilist.co -- a sandbox whose egress
 * proxy denies that host answers 403 to the CONNECT and every sample fails,
 * which is exactly why this exists as a script rather than as an answer.
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

// Spend enough to be clearly below the limit without earning a 429: the point
// is to observe recovery, and a 429 replaces that with a Retry-After deadline.
for (let i = 0; i < 8; i++) await sample(`burn ${i + 1}`);

console.log("");
// Anchored to the wall clock rather than to summed waits: each sample costs a
// round trip, and the verdict turns on whether the count comes back at the
// 60 s boundary or before it. The first version summed its waits and put the
// sample it labelled +70s at +60 s exactly -- on the boundary it was meant to
// be safely past.
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
