import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStore } from "../src/index.ts";

const ORIGIN = "https://photo.example";
const h = createHandler({ store: memoryStore(), allowedOrigins: [ORIGIN], adminToken: "t", salt: "s" });
const call = (path: string, init: RequestInit = {}) =>
  h(new Request("http://x/api/" + path, { ...init, headers: { origin: ORIGIN, "content-type": "application/json", ...(init.headers as object) } }));

test("comment round-trip", async () => {
  const r = await call("comments", { method: "POST", body: JSON.stringify({ site: "photo", slug: "a", author: "Ann", body: "<b>hi</b>" }) });
  assert.equal(r.status, 201);
  const list = await (await call("comments?site=photo&slug=a")).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].body, "<b>hi</b>"); // stored raw; widget renders via textContent
});

test("honeypot and disallowed origin are rejected", async () => {
  const bad = await h(new Request("http://x/api/comments", { method: "POST", headers: { origin: "https://evil" }, body: "{}" }));
  assert.equal(bad.status, 403);
  await call("comments", { method: "POST", body: JSON.stringify({ site: "photo", slug: "b", author: "Bot", body: "spam", website: "x" }) });
  assert.equal((await (await call("comments?site=photo&slug=b")).json()).length, 0);
});

test("views -> 10-day stats with city, admin only", async () => {
  await call("view", { method: "POST", body: JSON.stringify({ site: "photo", path: "/" }), headers: { "x-vercel-ip-city": "Bengaluru", "x-vercel-ip-country": "IN", "x-forwarded-for": "1.1.1.1", "user-agent": "Mozilla/5.0 Safari" } });
  await call("view", { method: "POST", body: JSON.stringify({ site: "photo", path: "/" }), headers: { "x-vercel-ip-city": "Bengaluru", "x-vercel-ip-country": "IN", "x-forwarded-for": "2.2.2.2", "user-agent": "Mozilla/5.0 Safari" } });
  assert.equal((await call("stats?site=photo")).status, 401);
  const s = await (await call("stats?site=photo", { headers: { authorization: "Bearer t" } })).json();
  assert.equal(s.byDay.length, 10);
  assert.equal(s.totalViews, 2);
  assert.equal(s.visits, 2);
  assert.equal(s.topCities[0].city, "Bengaluru");
});
