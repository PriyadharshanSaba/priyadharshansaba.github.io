// Downloads the VPN / datacenter IP lists into engage/data/ (git-ignored).
//   node scripts/fetch-lists.mjs        (or: npm run lists)
// Run it before each deploy to refresh the lists. If anything looks wrong, existing data is left untouched.
//
// Source: https://github.com/X4BNet/lists_vpn (output/vpn and output/datacenter).
// The repo has no LICENSE file, and its data is built from IPLocate's IP-to-ASN database, which asks for
// attribution ("IP address data powered by IPLocate.io"). That is why the lists are downloaded at deploy
// time and not committed to this public repository.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseCidrList } from "../src/network.ts";

const BASE = "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output";
const OUT = fileURLToPath(new URL("../data/", import.meta.url));
const SOURCES = {
  "vpn-ipv4.txt": `${BASE}/vpn/ipv4.txt`,
  "vpn-ipv6.txt": `${BASE}/vpn/ipv6.txt`,
  "datacenter-ipv4.txt": `${BASE}/datacenter/ipv4.txt`,
  "datacenter-ipv6.txt": `${BASE}/datacenter/ipv6.txt`,
};
// Sanity floors, well under the real sizes, to catch an empty or truncated download.
const MIN = { "vpn-ipv4.txt": 1000, "datacenter-ipv4.txt": 5000, "vpn-ipv6.txt": 10, "datacenter-ipv6.txt": 10 };

async function download(name, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const text = await res.text();
  const entries = parseCidrList(text);
  if (entries.length < MIN[name]) throw new Error(`${name}: only ${entries.length} valid entries (expected at least ${MIN[name]}); refusing to use it`);
  return { text: entries.join("\n") + "\n", count: entries.length };
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
