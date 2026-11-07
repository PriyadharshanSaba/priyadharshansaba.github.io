import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStore } from "../src/index.ts";
import { aggregate } from "../src/stats.ts";
import type { PageView } from "../src/types.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const v = (visitor: string, path: string, country?: string, network?: PageView["network"], ts = NOW): PageView =>
  ({ site: "s", path, visitor, country, network, ts });
const today = (s: ReturnType<typeof aggregate>) => s.byDay[s.byDay.length - 1];

test("each day lists its countries, counting every person once", () => {
  const s = aggregate([
    v("a", "/", "IN"), v("a", "/india/", "IN"), v("a", "/pooram/", "IN"),   // one person, three pages
    v("b", "/", "IN"), v("c", "/", "US"),
  ], 10, NOW);
  assert.deepEqual(today(s).countries, [
    { country: "IN", visits: 2, flagged: 0 },
    { country: "US", visits: 1, flagged: 0 },
  ]);
});

test("the country counts add up to the bar for every day", () => {
  const s = aggregate([
    v("a", "/", "IN"), v("b", "/", "US"), v("c", "/", undefined), v("d", "/", "IN", "datacenter"),
    v("e", "/", "SE", "vpn", NOW - 2 * DAY), v("f", "/", "IN", undefined, NOW - 2 * DAY),
  ], 10, NOW);
  for (const d of s.byDay) assert.equal(d.countries.reduce((n, c) => n + c.visits, 0), d.visitors, d.day);
});

test("a person lands in one country even if one of their views has no country", () => {
  const first = aggregate([v("a", "/", undefined), v("a", "/x/", "IN")], 10, NOW);
  assert.deepEqual(today(first).countries, [{ country: "IN", visits: 1, flagged: 0 }]);
  const last = aggregate([v("a", "/", "IN"), v("a", "/x/", undefined)], 10, NOW);
  assert.deepEqual(today(last).countries, [{ country: "IN", visits: 1, flagged: 0 }]);
  assert.equal(today(first).visitors, 1);
});

test("a person with no country at all is counted under XX (unknown), so nobody goes missing", () => {
  const s = aggregate([v("a", "/", undefined), v("b", "/", "IN")], 10, NOW);
  assert.deepEqual(today(s).countries, [{ country: "IN", visits: 1, flagged: 0 }, { country: "XX", visits: 1, flagged: 0 }]);
});

test("flagged people are counted in their country and tallied separately", () => {
  const s = aggregate([
    v("a", "/", "US", "datacenter"), v("b", "/", "US", "regular"), v("c", "/", "US", "timezone"),
    v("d", "/", "US", "regular"), v("d", "/x/", "US", "vpn"),                 // flagged if ANY of their views was
  ], 10, NOW);
  assert.deepEqual(today(s).countries, [{ country: "US", visits: 4, flagged: 3 }]);
});

test("countries are sorted by visits, then alphabetically", () => {
  const s = aggregate([v("a", "/", "SE"), v("b", "/", "IN"), v("c", "/", "IN"), v("d", "/", "DE")], 10, NOW);
  assert.deepEqual(today(s).countries.map((c) => c.country), ["IN", "DE", "SE"]);
});

test("days with no traffic have an empty list, and each day keeps its own countries", () => {
  const s = aggregate([v("old", "/", "US", undefined, NOW - DAY), v("new", "/", "IN")], 10, NOW);
  assert.deepEqual(s.byDay[0].countries, []);
  assert.deepEqual(s.byDay[s.byDay.length - 2].countries, [{ country: "US", visits: 1, flagged: 0 }]);
  assert.deepEqual(today(s).countries, [{ country: "IN", visits: 1, flagged: 0 }]);
});

test("the same person on two different days counts once on each day", () => {
  const s = aggregate([v("mon-code", "/", "IN", undefined, NOW - DAY), v("tue-code", "/", "IN")], 10, NOW);
  assert.equal(s.byDay[s.byDay.length - 2].countries[0].visits, 1);
  assert.equal(today(s).countries[0].visits, 1);
});

test("the /stats API includes the per-day countries", async () => {
  const store = memoryStore();
  const h = createHandler({ store, allowedOrigins: [], adminToken: "t", salt: "s" });
  await store.addView({ site: "s", path: "/", visitor: "a", country: "IN", ts: Date.now() });
  const s = await (await h(new Request("http://x/api/stats?site=s", { headers: { authorization: "Bearer t" } }))).json();
  assert.deepEqual(s.byDay[s.byDay.length - 1].countries, [{ country: "IN", visits: 1, flagged: 0 }]);
});
