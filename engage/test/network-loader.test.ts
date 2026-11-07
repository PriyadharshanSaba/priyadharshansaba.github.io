import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNetworkInfo } from "../src/network-node.ts";

const files = {
  "vpn-ipv4.txt": "# vpn\n5.5.5.0/24\n",
  "vpn-ipv6.txt": "2001:db8:1::/48\n",
  "datacenter-ipv4.txt": "6.6.0.0/16\n5.5.5.0/24\n",
  "datacenter-ipv6.txt": "2001:db8:2::/48\n",
  "meta.json": JSON.stringify({ fetchedAt: "2026-11-07T10:00:00.000Z" }),
};

function dirWith(content: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "engage-lists-"));
  for (const [name, text] of Object.entries(content)) writeFileSync(join(dir, name), text);
  return dir;
}

test("loads all four lists and classifies", () => {
  const info = loadNetworkInfo({ dirs: [dirWith(files)], minEntries: 1 });
  assert.deepEqual(info.status(), { loaded: true, fetchedAt: "2026-11-07T10:00:00.000Z" });
  assert.equal(info.classify("5.5.5.7"), "vpn");
  assert.equal(info.classify("6.6.9.9"), "datacenter");
  assert.equal(info.classify("2001:db8:1::5"), "vpn");
  assert.equal(info.classify("2001:db8:2::5"), "datacenter");
  assert.equal(info.classify("8.8.8.8"), "regular");
});

test("missing lists: not loaded, classify returns null, nothing throws", () => {
  const info = loadNetworkInfo({ dirs: [join(tmpdir(), "does-not-exist-engage")], minEntries: 1 });
  assert.deepEqual(info.status(), { loaded: false });
  assert.equal(info.classify("5.5.5.7"), null);
});

test("a missing file makes the whole set unusable (no half-loaded state)", () => {
  const { "datacenter-ipv4.txt": _gone, ...partial } = files;
  const info = loadNetworkInfo({ dirs: [dirWith(partial)], minEntries: 1 });
  assert.equal(info.status().loaded, false);
  assert.equal(info.classify("5.5.5.7"), null);
});

test("a truncated or corrupt list is rejected instead of silently labelling everything 'regular'", () => {
  const info = loadNetworkInfo({ dirs: [dirWith(files)], minEntries: 1000 }); // fixtures are far below the sanity floor
  assert.equal(info.status().loaded, false);
  assert.equal(info.classify("5.5.5.7"), null);
});

test("uses the first directory that has the lists", () => {
  const info = loadNetworkInfo({ dirs: [join(tmpdir(), "nope-engage"), dirWith(files)], minEntries: 1 });
  assert.equal(info.status().loaded, true);
});

test("meta.json is optional", () => {
  const { "meta.json": _meta, ...noMeta } = files;
  const info = loadNetworkInfo({ dirs: [dirWith(noMeta)], minEntries: 1 });
  assert.deepEqual(info.status(), { loaded: true });
});

test("loading is lazy and happens once", () => {
  const dir = dirWith(files);
  const info = loadNetworkInfo({ dirs: [dir], minEntries: 1 });
  assert.equal(info.classify("5.5.5.7"), "vpn");
  writeFileSync(join(dir, "vpn-ipv4.txt"), "9.9.9.0/24\n"); // changing files afterwards must not matter
  assert.equal(info.classify("5.5.5.7"), "vpn");
});
