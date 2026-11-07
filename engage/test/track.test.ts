import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const trackSrc = readFileSync(new URL("../public/track.js", import.meta.url), "utf8");

/** Run track.js in a fake browser and return what it tried to send. */
function runTrack(opts: { intl?: unknown } = {}) {
  const sent: { url: string; body: string }[] = [];
  const script = { src: "https://api.example/track.js", getAttribute: (k: string) => (k === "data-site" ? "demo" : null) };
  const env: Record<string, unknown> = {
    document: { currentScript: script, referrer: "", querySelector: () => script },
    location: { pathname: "/india/" },
    navigator: { sendBeacon: (url: string, body: string) => { sent.push({ url, body }); return true; } },
    fetch: () => Promise.resolve(),
    URL, JSON, Intl: opts.intl ?? Intl,
  };
  new Function(...Object.keys(env), trackSrc)(...Object.values(env));
  return sent;
}

test("track.js sends the path, site and the browser timezone", () => {
  const [req] = runTrack();
  assert.equal(req.url, "https://api.example/api/view");
  const body = JSON.parse(req.body);
  assert.equal(body.site, "demo");
  assert.equal(body.path, "/india/");
  assert.equal(body.tz, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("track.js still sends a view if the browser can't report a timezone", () => {
  const broken = { DateTimeFormat: () => { throw new Error("no Intl"); } };
  const [req] = runTrack({ intl: broken });
  const body = JSON.parse(req.body);
  assert.equal(body.path, "/india/");
  assert.ok(!body.tz);
});

test("embed.js sends the timezone with its view", () => {
  const embed = readFileSync(new URL("../src/client/embed.js", import.meta.url), "utf8");
  assert.match(embed, /post\("\/view",\s*\{[^}]*\btz\b/);
});

test("every copy of embed.js on the site is identical to the source (guards against drift)", () => {
  const source = readFileSync(new URL("../src/client/embed.js", import.meta.url), "utf8");
  for (const page of ["india", "pooram", "edge_of_us"]) {
    const copy = readFileSync(new URL(`../../${page}/embed.js`, import.meta.url), "utf8");
    assert.equal(copy, source, `${page}/embed.js has drifted from engage/src/client/embed.js`);
  }
});
