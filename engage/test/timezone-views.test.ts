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
const classifier = new NetworkClassifier({ vpn: ["5.5.5.0/24"], datacenter: ["6.6.0.0/16"] });
const network = { classify: (ip: string | null) => classifier.classify(ip), status: () => ({ loaded: true }) };

function setup(extra: Record<string, unknown> = {}) {
  const store = memoryStore();
  const h = createHandler({ store, allowedOrigins: [ORIGIN], adminToken: "t", salt: "s", network, ...extra });
  const view = (ip: string, body: Record<string, unknown>, country: string | null = "IN") =>
    h(new Request("http://x/api/view", {
      method: "POST",
      headers: {
        origin: ORIGIN, "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 Safari",
        ...(country ? { "x-vercel-ip-country": country, "x-vercel-ip-city": "Somewhere" } : {}),
      },
      body: JSON.stringify({ site: "s", path: "/", ...body }),
    }));
  const label = async () => (await store.viewsSince("s", 0))[0]?.network;
  return { store, view, label };
}

test("a regular IP whose browser timezone is from another country is labelled 'timezone'", async () => {
  const { view, label } = setup();
  await view("7.7.7.7", { tz: "America/New_York" }, "IN");
  assert.equal(await label(), "timezone");
});

test("a matching timezone stays 'regular' (including Chrome's old Asia/Calcutta)", async () => {
  for (const tz of ["Asia/Kolkata", "Asia/Calcutta"]) {
    const { view, label } = setup();
    await view("7.7.7.7", { tz }, "IN");
    assert.equal(await label(), "regular", tz);
  }
});

test("VPN and datacenter labels win over a timezone mismatch", async () => {
  const a = setup(); await a.view("5.5.5.9", { tz: "America/New_York" }, "IN");
  assert.equal(await a.label(), "vpn");
  const b = setup(); await b.view("6.6.1.1", { tz: "America/New_York" }, "IN");
  assert.equal(await b.label(), "datacenter");
});

test("no verdict (no timezone sent, no country, or an unknown timezone) leaves the label alone", async () => {
  const none = setup(); await none.view("7.7.7.7", {}, "IN");
  assert.equal(await none.label(), "regular");
  const noCountry = setup(); await noCountry.view("7.7.7.7", { tz: "America/New_York" }, null);
  assert.equal(await noCountry.label(), "regular");
  const utc = setup(); await utc.view("7.7.7.7", { tz: "UTC" }, "IN");
  assert.equal(await utc.label(), "regular");
});

test("works without the IP lists: an unlisted/unknown IP with a mismatch is still 'timezone'", async () => {
  const { view, label } = setup({ network: undefined });
  await view("7.7.7.7", { tz: "America/New_York" }, "IN");
  assert.equal(await label(), "timezone");
});

test("garbage timezone values never break counting", async () => {
  for (const tz of [123, { a: 1 }, ["x"], "A".repeat(500), "<script>alert(1)</script>", null]) {
    const { store, view } = setup();
    assert.equal((await view("7.7.7.7", { tz }, "IN")).status, 204, JSON.stringify(tz));
    assert.equal((await store.viewsSince("s", 0)).length, 1);
    assert.equal((await store.viewsSince("s", 0))[0].network, "regular");
  }
});

test("the browser timezone itself is never stored", async () => {
  const { store, view } = setup();
  await view("7.7.7.7", { tz: "America/New_York" }, "IN");
  assert.ok(!JSON.stringify(await store.viewsSince("s", 0)).includes("New_York"));
});

// ---------- grouping and storage ----------

const v = (visitor: string, city: string, country: string, net: PageView["network"]): PageView =>
  ({ site: "s", path: "/", visitor, city, country, network: net, ts: NOW });

test("timezone-mismatch visits are grouped with the other flagged traffic", () => {
  const s = aggregate([v("a", "Bengaluru", "IN", "regular"), v("b", "Austin", "US", "timezone"), v("c", "Ashburn", "US", "datacenter")], 10, NOW);
  assert.deepEqual(s.topCities.map((c) => c.city), ["Bengaluru"]);
  assert.equal(s.flagged.visits, 2);
  assert.deepEqual(s.flagged.byNetwork, { vpn: 0, datacenter: 1, timezone: 1 });
  assert.deepEqual(s.flagged.cities.map((c) => [c.city, c.network]).sort(), [["Ashburn", "datacenter"], ["Austin", "timezone"]]);
  assert.equal(s.visits, 3);
});

test("sql: the 'timezone' label round-trips", async () => {
  const store = await libsqlStore(createClient({ url: ":memory:" }));
  await store.addView({ site: "s", path: "/", visitor: "v", ts: NOW, network: "timezone" });
  assert.equal((await store.viewsSince("s", 0))[0].network, "timezone");
});
