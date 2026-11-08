import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkInfo } from "./handler.ts";
import { NetworkClassifier, parseCidrList } from "./network.ts";

const FILES = {
  vpn4: "vpn-ipv4.txt", vpn6: "vpn-ipv6.txt",
  dc4: "datacenter-ipv4.txt", dc6: "datacenter-ipv6.txt",
  relay4: "relay-ipv4.txt", relay6: "relay-ipv6.txt", // optional: without them Private Relay users look like VPN
} as const;

/**
 * Where the lists might be. On Vercel, files named in vercel.json `includeFiles` keep their
 * project-relative path under the working directory; locally they sit next to src/.
 */
export const defaultListDirs = () => [
  join(process.cwd(), "data"),
  fileURLToPath(new URL("../data/", import.meta.url)),
];

type Loaded = { classifier: NetworkClassifier; fetchedAt?: string } | null;

function tryLoad(dir: string, minEntries: number): Loaded {
  try {
    const read = (name: string) => parseCidrList(readFileSync(join(dir, name), "utf8"));
    const readOptional = (name: string) => { try { return read(name); } catch { return []; } };
    const lists = {
      vpn4: read(FILES.vpn4), vpn6: read(FILES.vpn6), dc4: read(FILES.dc4), dc6: read(FILES.dc6),
      relay4: readOptional(FILES.relay4), relay6: readOptional(FILES.relay6),
    };
    // A truncated download would otherwise label everything "regular" without any error.
    if (lists.vpn4.length < minEntries || lists.dc4.length < minEntries) return null;
    let fetchedAt: string | undefined;
    try { fetchedAt = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).fetchedAt; } catch { /* optional */ }
    return {
      classifier: new NetworkClassifier({ vpn: [...lists.vpn4, ...lists.vpn6], datacenter: [...lists.dc4, ...lists.dc6], relay: [...lists.relay4, ...lists.relay6] }),
      fetchedAt,
    };
  } catch {
    return null; // missing or unreadable file: treat the whole set as unavailable
  }
}

/**
 * Lazy, once-per-process loader for the VPN/datacenter lists (X4BNet/lists_vpn, see scripts/fetch-lists.mjs).
 * If the lists are absent or look broken, classify() returns null and views are stored unlabelled.
 */
export function loadNetworkInfo(opts: { dirs?: string[]; minEntries?: number } = {}): NetworkInfo {
  const dirs = opts.dirs ?? defaultListDirs();
  const minEntries = opts.minEntries ?? 1000;
  let state: Loaded | undefined;

  const get = (): Loaded => {
    if (state === undefined) {
      state = null;
      for (const d of dirs) { const l = tryLoad(d, minEntries); if (l) { state = l; break; } }
    }
    return state;
  };

  return {
    classify: (ip) => get()?.classifier.classify(ip) ?? null,
    status: () => {
      const s = get();
      return s ? { loaded: true, ...(s.fetchedAt ? { fetchedAt: s.fetchedAt } : {}) } : { loaded: false };
    },
  };
}
