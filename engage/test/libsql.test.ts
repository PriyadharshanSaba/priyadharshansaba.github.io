import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { createHandler } from "../src/index.ts";
import { libsqlStore } from "../src/adapters/libsql.ts";

const ORIGIN = "https://photo.example";
const mk = async (extra = {}) => createHandler({
  store: await libsqlStore(createClient({ url: ":memory:" })),
  allowedOrigins: [ORIGIN], adminToken: "t", salt: "s", ...extra,
});
const post = (h: ReturnType<typeof createHandler> extends Promise<infer T> ? T : any, body: object, ip = "1.1.1.1") =>
  h(new Request("http://x/api/comments", { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const c = (n: number) => ({ site: "photo", slug: "a", author: "Ann", body: `hello ${n}` });

test("libsql: persists and lists newest first, hides ipHash", async () => {
  const h = await mk();
  await post(h, c(1)); await post(h, c(2));
  const list = await (await h(new Request("http://x/api/comments?site=photo&slug=a"))).json();
  assert.equal(list.length, 2);
  assert.equal(list[0].body, "hello 2");
  assert.ok(!("ipHash" in list[0]) && !("ip_hash" in list[0]));
});

test("rate limit: 6th comment in an hour from one visitor gets 429, another visitor is fine", async () => {
  const h = await mk();
  for (let i = 0; i < 5; i++) assert.equal((await post(h, c(i))).status, 201);
  assert.equal((await post(h, c(6))).status, 429);
  assert.equal((await post(h, c(7), "9.9.9.9")).status, 201);
});

test("pending mode hides comments until approved", async () => {
  const h = await mk({ commentStatus: "pending" });
  const created = await (await post(h, c(1))).json();
  const url = "http://x/api/comments?site=photo&slug=a";
  assert.equal((await (await h(new Request(url))).json()).length, 0);
  await h(new Request("http://x/api/moderate", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ id: created.id, status: "visible" }) }));
  assert.equal((await (await h(new Request(url))).json()).length, 1);
});
