import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStore } from "../src/index.ts";

const ORIGIN = "https://photo.example";
const DAY = 86_400_000;

function setup(extra = {}) {
  const store = memoryStore();
  const h = createHandler({ store, allowedOrigins: [ORIGIN], adminToken: "t", salt: "s", ...extra });
  const view = (path: string, ip = "1.1.1.1", ua = "Mozilla/5.0 Safari", referrer?: string, contentType = "application/json") =>
    h(new Request("http://x/api/view", {
      method: "POST",
      headers: { origin: ORIGIN, "x-forwarded-for": ip, "user-agent": ua, "content-type": contentType },
      body: JSON.stringify({ site: "s", path, referrer }),
    }));
  const stats = async () =>
    (await h(new Request("http://x/api/stats?site=s", { headers: { authorization: "Bearer t" } }))).json();
  return { store, view, stats };
}

test("same visitor + page within 15 min counts once", async () => {
  const { view, stats } = setup();
  await view("/india/"); await view("/india/"); await view("/india/");
  assert.equal((await stats()).totalViews, 1);
});

test("same visitor on a different page counts separately", async () => {
  const { view, stats } = setup();
  await view("/india/"); await view("/pooram/");
  assert.equal((await stats()).totalViews, 2);
});

test("different visitors on the same page both count", async () => {
  const { view, stats } = setup();
  await view("/india/", "1.1.1.1"); await view("/india/", "2.2.2.2");
  assert.equal((await stats()).totalViews, 2);
});

test("a view older than 15 min does not block a new one", async () => {
  const { store, view, stats } = setup();
  await view("/india/");
  (await store.viewsSince("s", 0))[0].ts = Date.now() - 20 * 60_000; // age it
  await view("/india/");
  assert.equal((await stats()).totalViews, 2);
});

test("bots are not counted but still get a quiet 204", async () => {
  const { view, stats } = setup();
  for (const ua of ["Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "HeadlessChrome/120",
    "facebookexternalhit/1.1", "curl/8.0", "Slackbot-LinkExpanding"]) {
    assert.equal((await view("/india/", "9.9.9.9", ua)).status, 204, ua);
  }
  assert.equal((await stats()).totalViews, 0);
});

test("a missing user-agent is not counted", async () => {
  const { view, stats } = setup();
  await view("/india/", "3.3.3.3", "");
  assert.equal((await stats()).totalViews, 0);
});

test("/india/ and /india/index.html are the same page", async () => {
  const { view, stats } = setup();
  await view("/india/"); await view("/india/index.html");
  const s = await stats();
  assert.equal(s.totalViews, 1);
  assert.equal(s.topPages[0].path, "/india/");
});

test("query strings and fragments are stripped from the path", async () => {
  const { view, stats } = setup();
  await view("/india/?utm_source=x#top");
  assert.equal((await stats()).topPages[0].path, "/india/");
});

test("referrer from the site's own host is dropped, external referrers are kept", async () => {
  const { view, stats } = setup();
  await view("/a/", "1.0.0.1", "Mozilla/5.0", "photo.example");     // internal navigation
  await view("/b/", "1.0.0.2", "Mozilla/5.0", "instagram.com");     // real external referrer
  const s = await stats();
  assert.deepEqual(s.topReferrers.map((r: { referrer: string }) => r.referrer), ["instagram.com"]);
});

test("a text/plain body (what sendBeacon sends) is accepted", async () => {
  const { view, stats } = setup();
  assert.equal((await view("/a/", "1.1.1.1", "Mozilla/5.0", undefined, "text/plain;charset=UTF-8")).status, 204);
  assert.equal((await stats()).totalViews, 1);
});

test("views older than 90 days are deleted by cleanup", async () => {
  const { store, view } = setup({ cleanupChance: 1 }); // always run cleanup in this test
  await view("/old/", "4.4.4.4");
  (await store.viewsSince("s", 0))[0].ts = Date.now() - 91 * DAY;
  await view("/new/", "5.5.5.5"); // this request triggers the cleanup
  assert.deepEqual((await store.viewsSince("s", 0)).map((v) => v.path), ["/new/"]);
});

test("cleanup keeps views younger than 90 days", async () => {
  const { store, view } = setup({ cleanupChance: 1 });
  await view("/a/", "6.6.6.6");
  (await store.viewsSince("s", 0))[0].ts = Date.now() - 89 * DAY;
  await view("/b/", "7.7.7.7");
  assert.equal((await store.viewsSince("s", 0)).length, 2);
});
