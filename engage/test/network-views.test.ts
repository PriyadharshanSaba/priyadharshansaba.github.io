import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { createHandler, memoryStore } from "../src/index.ts";
import { NetworkClassifier } from "../src/network.ts";
import { aggregate } from "../src/stats.ts";
import { libsqlStore } from "../src/adapters/libsql.ts";
import type { PageView } from "../src/types.ts";

const ORIGIN = "https://photo.example";
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const classifier = new NetworkClassifier({ vpn: ["5.5.5.0/24"], datacenter: ["6.6.0.0/16", "5.5.5.0/24"] });
const network = { classify: (ip: string | null) => classifier.classify(ip), status: () => ({ loaded: true, fetchedAt: "2026-11-07T00:00:00Z" }) };

function setup(extra = {}) {
  const store = memoryStore();
  const h = createHandler({ store, allowedOrigins: [ORIGIN], adminToken: "t", salt: "s", network, ...extra });
  const view = (ip: string, path = "/", city = "Ashburn") =>
    h(new Request("http://x/api/view", {
      method: "POST",
      headers: { origin: ORIGIN, "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 Safari", "x-vercel-ip-city": city, "x-vercel-ip-country": "US" },
      body: JSON.stringify({ site: "s", path }),
    }));
  const stats = async () =>
    (await h(new Request("http://x/api/stats?site=s", { headers: { authorization: "Bearer t" } }))).json();
  return { store, view, stats, h };
}

// ---------- capturing the label ----------

test("a view is stored with its network label", async () => {
  const { store, view } = setup();
  await view("5.5.5.9", "/a/"); await view("6.6.1.1", "/b/"); await view("7.7.7.7", "/c/");
  const byPath = Object.fromEntries((await store.viewsSince("s", 0)).map((v) => [v.path, v.network]));
  assert.deepEqual(byPath, { "/a/": "vpn", "/b/": "datacenter", "/c/": "regular" });
});

test("the IP address itself is never stored", async () => {
  const { store, view } = setup();
  await view("5.5.5.9");
  assert.ok(!JSON.stringify(await store.viewsSince("s", 0)).includes("5.5.5.9"));
});

test("without a classifier, views still count and have no label", async () => {
  const { store, view } = setup({ network: undefined });
  await view("5.5.5.9");
  const rows = await store.viewsSince("s", 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].network, undefined);
});

test("a classifier that throws never breaks view counting", async () => {
  const { store, view } = setup({ network: { classify: () => { throw new Error("boom"); }, status: () => ({ loaded: true }) } });
  assert.equal((await view("5.5.5.9")).status, 204);
  const rows = await store.viewsSince("s", 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].network, undefined);
});

test("a missing or unparsable IP is left unlabelled, not 'regular'", async () => {
  const { store, h } = setup();
  await h(new Request("http://x/api/view", { method: "POST", headers: { origin: ORIGIN, "user-agent": "Mozilla/5.0" }, body: JSON.stringify({ site: "s", path: "/" }) }));
  assert.equal((await store.viewsSince("s", 0))[0].network, undefined);
});

test("/stats reports whether the network lists are loaded", async () => {
  const withLists = await setup().stats();
  assert.deepEqual(withLists.networkLists, { loaded: true, fetchedAt: "2026-11-07T00:00:00Z" });
  const without = await setup({ network: undefined }).stats();
  assert.deepEqual(without.networkLists, { loaded: false });
});

test("end to end: flagged traffic is grouped out of the city list", async () => {
  const { view, stats } = setup();
  await view("7.7.7.7", "/", "Bengaluru");   // regular
  await view("5.5.5.9", "/", "Ashburn");     // vpn
  await view("6.6.1.1", "/", "Des Moines");  // datacenter
  const s = await stats();
  assert.deepEqual(s.topCities.map((c: { city: string }) => c.city), ["Bengaluru"]);
  assert.equal(s.flagged.visits, 2);
  assert.equal(s.visits, 3);
});

// ---------- grouping in the numbers ----------

const v = (visitor: string, path: string, city: string, country: string, net?: PageView["network"], ts = NOW): PageView =>
  ({ site: "s", path, visitor, city, country, network: net, ts });

test("flagged views are excluded from the city and country lists but counted in visits", () => {
  const s = aggregate([
    v("a", "/", "Bengaluru", "IN", "regular"),
    v("b", "/", "Ashburn", "US", "datacenter"),
    v("c", "/", "Stockholm", "SE", "vpn"),
  ], 10, NOW);
  assert.deepEqual(s.topCities.map((c) => c.city), ["Bengaluru"]);
  assert.deepEqual(s.topCountries.map((c) => c.country), ["IN"]);
  assert.equal(s.visits, 3);
  assert.equal(s.flagged.visits, 2);
  assert.deepEqual(s.flagged.byNetwork, { vpn: 1, datacenter: 1 });
});

test("flagged lists carry the network type and per-person-per-day counts", () => {
  const s = aggregate([
    v("b", "/", "Ashburn", "US", "datacenter"), v("b", "/x/", "Ashburn", "US", "datacenter"), // same person, 2 pages
    v("d", "/", "Ashburn", "US", "datacenter"),
    v("c", "/", "Ashburn", "US", "vpn"),
  ], 10, NOW);
  assert.deepEqual(s.flagged.cities, [
    { city: "Ashburn", country: "US", network: "datacenter", visits: 2 },
    { city: "Ashburn", country: "US", network: "vpn", visits: 1 },
  ]);
  assert.deepEqual(s.flagged.countries, [
    { country: "US", network: "datacenter", visits: 2 },
    { country: "US", network: "vpn", visits: 1 },
  ]);
});

test("rows with no label (old data) are treated as regular", () => {
  const s = aggregate([v("a", "/", "Mumbai", "IN", undefined), v("b", "/", "Delhi", "IN", "regular")], 10, NOW);
  assert.equal(s.topCities.length, 2);
  assert.equal(s.flagged.visits, 0);
  assert.deepEqual(s.flagged.cities, []);
});

test("the Pages table and page-view total still include flagged traffic", () => {
  const s = aggregate([v("a", "/", "Mumbai", "IN", "regular"), v("b", "/", "Ashburn", "US", "datacenter")], 10, NOW);
  assert.equal(s.totalViews, 2);
  assert.equal(s.topPages[0].visits, 2);
});

test("flagged visits are bounded by the window like everything else", () => {
  const DAY = 86_400_000;
  const s = aggregate([v("b", "/", "Ashburn", "US", "datacenter", NOW - 30 * DAY)], 10, NOW);
  assert.equal(s.flagged.visits, 0);
});

// ---------- storage ----------

test("sql: the network label round-trips and old tables are migrated in place", async () => {
  const db = createClient({ url: ":memory:" });
  // a table as created before this feature existed (no network column), with one old row
  await db.execute(`CREATE TABLE views (site TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL,
    country TEXT, city TEXT, referrer TEXT, ts INTEGER NOT NULL)`);
  await db.execute({ sql: `INSERT INTO views VALUES (?,?,?,?,?,?,?)`, args: ["s", "/old/", "v0", "IN", "Pune", null, NOW - 1000] });

  const store = await libsqlStore(db);              // must add the column without losing the old row
  await libsqlStore(db);                            // and be safe to run again (column already there)
  await store.addView({ site: "s", path: "/new/", visitor: "v1", ts: NOW, network: "vpn" });

  const rows = Object.fromEntries((await store.viewsSince("s", 0)).map((r) => [r.path, r.network]));
  assert.deepEqual(rows, { "/old/": undefined, "/new/": "vpn" });
});
