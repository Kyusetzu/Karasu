#!/usr/bin/env node
/**
 * Settles one open question about AniList's rate limiter: does its window
 * *roll*, or does it reset in a step?
 *
 * Why it matters. `anilist/client.rs` currently asserts both. `SLICE`'s comment
 * says "the window rolls continuously, so the budget can return at any moment",
 * which is why the pre-flight re-checks every 400 ms instead of sleeping. But
 * `headroom` implements the opposite: a count stays exactly as measured until a
 * whole `WINDOW` has passed since it was taken, and then jumps to the full
 * limit. Both cannot be right.
 *
 * What follows from the answer:
 *
 * - **Rolling.** `headroom` should heal in proportion to elapsed time. Today a
 *   response reporting `remaining: 0` pins the budget at 0 for 60 s, and every
 *   request in that minute pays the full `MAX_PACE` of 5 s and is then sent
 *   anyway -- five seconds of latency per request that buys nothing.
 * - **Stepped.** `headroom` is already right and `SLICE`'s comment is the thing
 *   to fix. Healing proportionally would then hand out budget that does not
 *   exist and earn 429s, which is worse than the latency it removes -- which is
 *   why this is not a change anyone should make from reasoning alone.
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
  "\nRead the recovery samples. Climbing steadily across +5/+15/+30/+45 is a" +
    "\nrolling window, and `headroom` should heal proportionally -- but each" +
    "\nsample spends one request in the window it watches, so a count that only" +
    "\ndrops by one per sample is the samples' own cost, not a heal. Flat through" +
    "\n+45 and back to full at +60 or +90 is a stepped window, and `headroom` is" +
    "\nalready correct -- fix SLICE's comment instead. Record whichever it is in" +
    "\nCLAUDE.md.",
);
