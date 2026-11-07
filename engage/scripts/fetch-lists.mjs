// Downloads the VPN / datacenter IP lists into engage/data/ (git-ignored).
//   node scripts/fetch-lists.mjs        (or: npm run lists, for local development)
// On Vercel this runs automatically as the build step (vercel.json "buildCommand"), so every deploy ships
// fresh lists. If anything looks wrong it exits 1 WITHOUT touching existing data; on Vercel that fails the
// build, and the previous deployment keeps serving.
//
// Self-contained plain JS (no TypeScript imports) so it runs on any Node version Vercel's build uses.
//
// Source: https://github.com/X4BNet/lists_vpn (output/vpn and output/datacenter).
// The repo has no LICENSE file, and its data is built from IPLocate's IP-to-ASN database, which asks for
// attribution ("IP address data powered by IPLocate.io"). That is why the lists are downloaded at build
// time and not committed to this public repository.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const BASE = process.env.LISTS_BASE_URL ?? "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output"; // override is for testing
const OUT = fileURLToPath(new URL("../data/", import.meta.url));
const SOURCES = {
  "vpn-ipv4.txt": `${BASE}/vpn/ipv4.txt`,
  "vpn-ipv6.txt": `${BASE}/vpn/ipv6.txt`,
  "datacenter-ipv4.txt": `${BASE}/datacenter/ipv4.txt`,
  "datacenter-ipv6.txt": `${BASE}/datacenter/ipv6.txt`,
};
// Sanity floors, well under the real sizes, to catch an empty or truncated download.
const MIN = { "vpn-ipv4.txt": 1000, "datacenter-ipv4.txt": 5000, "vpn-ipv6.txt": 10, "datacenter-ipv6.txt": 10 };
const TRIES = 3;

// Lenient shape check, only to count and keep sane lines. The server re-validates strictly when it loads them.
const V4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/;
const V6 = /^[0-9a-fA-F:.]+:[0-9a-fA-F:.]*(\/\d{1,3})?$/;
const cidrLines = (text) =>
  text.split(/\r?\n/).map((l) => l.split("#")[0].trim()).filter((l) => l && (V4.test(l) || V6.test(l)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(name, url) {
  let lastError;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = cidrLines(await res.text());
      if (entries.length < MIN[name]) throw new Error(`only ${entries.length} valid entries (expected at least ${MIN[name]})`);
      return { text: entries.join("\n") + "\n", count: entries.length };
    } catch (e) {
      lastError = e;
      if (attempt < TRIES) await sleep(2000 * attempt);   // ride out a short GitHub blip: 2s, then 4s
    }
  }
  throw new Error(`${name}: ${lastError.message} (after ${TRIES} tries, ${url})`);
}

try {
  const results = {};
  for (const [name, url] of Object.entries(SOURCES)) results[name] = await download(name, url);

  await mkdir(OUT, { recursive: true });
  for (const [name, r] of Object.entries(results)) {       // write to a temp name, then rename: no half-written files
    await writeFile(join(OUT, name + ".tmp"), r.text);
    await rename(join(OUT, name + ".tmp"), join(OUT, name));
  }
  const counts = Object.fromEntries(Object.entries(results).map(([n, r]) => [n, r.count]));
  await writeFile(join(OUT, "meta.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), source: "X4BNet/lists_vpn", counts }, null, 2));

  console.log("Updated VPN/datacenter lists in", OUT);
  for (const [n, c] of Object.entries(counts)) console.log(`  ${n.padEnd(22)} ${c} networks`);
  console.log("Data: X4BNet/lists_vpn. IP address data powered by IPLocate.io.");
} catch (e) {
  console.error("Could not update the lists:", e.message);
  console.error("Existing data (if any) was left unchanged.");
  process.exit(1);
}
