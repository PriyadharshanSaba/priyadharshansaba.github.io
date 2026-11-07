import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/stats.ts";
import { createHandler, memoryStore } from "../src/index.ts";
import type { PageView } from "../src/types.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0); // 7 Nov 2026, noon UTC
const startOfToday = Date.UTC(2026, 10, 7);
const v = (visitor: string, path: string, ts: number): PageView => ({ site: "s", path, visitor, ts });

test("one visitor opening 3 pages in a day = 3 page views, 1 visit", () => {
  const s = aggregate([v("a", "/", NOW), v("a", "/india/", NOW), v("a", "/pooram/", NOW)], 10, NOW);
  assert.equal(s.totalViews, 3);
  assert.equal(s.visits, 1);
  const today = s.byDay[s.byDay.length - 1];
  assert.deepEqual([today.views, today.visitors], [3, 1]);
});

test("the same person on two different days = 2 visits", () => {
  // visitor codes rotate daily, so the same person has a different code each day
  const s = aggregate([v("a-mon", "/", NOW - DAY), v("a-tue", "/", NOW)], 10, NOW);
  assert.equal(s.visits, 2);
  assert.equal(s.totalViews, 2);
});

test("two people on the same day = 2 visits", () => {
  const s = aggregate([v("a", "/", NOW), v("b", "/", NOW)], 10, NOW);
  assert.equal(s.visits, 2);
});

test("visits is the sum of the per-day visitors shown in the chart", () => {
  const s = aggregate([v("a1", "/", NOW), v("b1", "/", NOW), v("a0", "/", NOW - 3 * DAY)], 10, NOW);
  assert.equal(s.visits, s.byDay.reduce((n, d) => n + d.visitors, 0));
});

test("totals only include days that appear in the chart", () => {
  const outside = startOfToday - 9 * DAY - 1000;  // 1s before the first bar's day
  const inside = startOfToday - 9 * DAY + 1000;   // 1s into the first bar's day
  const s = aggregate([v("a", "/", outside), v("b", "/", inside), v("c", "/", NOW)], 10, NOW);
  assert.equal(s.totalViews, 2);
  assert.equal(s.totalViews, s.byDay.reduce((n, d) => n + d.views, 0));
  assert.equal(s.visits, 2);
});

test("/stats loads exactly the chart's window (no partial extra day)", async () => {
  const store = memoryStore();
  const h = createHandler({ store, allowedOrigins: [], adminToken: "t", salt: "s" });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const first = today.getTime() - 9 * DAY;
  await store.addView({ site: "s", path: "/old/", visitor: "x", ts: first - 1000 });
  await store.addView({ site: "s", path: "/new/", visitor: "y", ts: first + 1000 });
  const s = await (await h(new Request("http://x/api/stats?site=s", { headers: { authorization: "Bearer t" } }))).json();
  assert.equal(s.totalViews, 1);
  assert.equal(s.topPages[0].path, "/new/");
});
