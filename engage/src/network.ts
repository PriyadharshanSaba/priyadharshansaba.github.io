/**
 * Classify an IP address as a VPN, a datacenter, or "regular" (not on any list).
 * Pure and dependency-free so it runs anywhere (Node, edge). The IP is only ever held in memory;
 * callers store the returned label, never the address.
 */

export type Network = "relay" | "vpn" | "datacenter" | "regular";
export type ParsedIp = { v: 4; n: number } | { v: 6; n: bigint };

const V4 = /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/;
const HEXTET = /^[0-9a-fA-F]{1,4}$/;

function parseV4(s: string): number | null {
  if (!V4.test(s)) return null;
  const p = s.split(".").map(Number);
  if (p.some((x) => x > 255)) return null;
  return p[0] * 16_777_216 + p[1] * 65_536 + p[2] * 256 + p[3]; // arithmetic, not shifts: stays unsigned
}

function parseV6(raw: string): bigint | null {
  let s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // An embedded IPv4 tail (e.g. ::ffff:1.2.3.4) becomes two hextets.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    s = s.slice(0, lastColon + 1) + Math.floor(v4 / 65_536).toString(16) + ":" + (v4 % 65_536).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  const all = [...left, ...right];
  if (all.some((g) => !HEXTET.test(g))) return null;
  if (halves.length === 2 ? all.length > 7 : all.length !== 8) return null;

  const fill = halves.length === 2 ? new Array(8 - all.length).fill("0") : [];
  return [...left, ...fill, ...right].reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/** Parse an IPv4 or IPv6 address. IPv4-mapped IPv6 (::ffff:a.b.c.d) is returned as IPv4. */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (!s.includes(":")) {
    const n = parseV4(s);
    return n === null ? null : { v: 4, n };
  }
  const n = parseV6(s);
  if (n === null) return null;
  if (n >> 32n === 0xffffn) return { v: 4, n: Number(n & 0xffffffffn) }; // ::ffff:a.b.c.d
  return { v: 6, n };
}

/** Parse "a.b.c.d/len", "x::/len", or a bare address (treated as a single host). */
function parseCidr(entry: string): { v: 4 | 6; start: bigint; end: bigint } | null {
  const [addr, len, ...rest] = entry.split("/");
  if (rest.length) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = ip.v === 4 ? 32 : 128;
  const prefix = len === undefined ? bits : /^\d{1,3}$/.test(len) ? Number(len) : -1;
  if (prefix < 0 || prefix > bits) return null;
  const host = BigInt(bits - prefix);
  const n = BigInt(ip.n);
  const start = (n >> host) << host;
  return { v: ip.v, start, end: start + (1n << host) - 1n };
}

/** Keep valid CIDR/IP lines; drop comments (# ...), blanks and junk. */
export function parseCidrList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = line.split("#")[0].trim();
    if (entry && parseCidr(entry)) out.push(entry);
  }
  return out;
}

/** Sorted, merged, inclusive ranges with binary-search membership. */
class RangeSet {
  private starts: bigint[] = [];
  private ends: bigint[] = [];

  constructor(ranges: [bigint, bigint][]) {
    ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [s, e] of ranges) {
      const last = this.ends.length - 1;
      if (last >= 0 && s <= this.ends[last] + 1n) {
        if (e > this.ends[last]) this.ends[last] = e; // overlapping or adjacent: extend
      } else {
        this.starts.push(s);
        this.ends.push(e);
      }
    }
  }

  get size() { return this.starts.length; }

  has(n: bigint): boolean {
    let lo = 0, hi = this.starts.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= n) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found !== -1 && n <= this.ends[found];
  }
}

function build(entries: string[]) {
  const v4: [bigint, bigint][] = [], v6: [bigint, bigint][] = [];
  for (const e of entries) {
    const c = parseCidr(e.trim());
    if (c) (c.v === 4 ? v4 : v6).push([c.start, c.end]);
  }
  return { v4: new RangeSet(v4), v6: new RangeSet(v6) };
}

export class NetworkClassifier {
  private vpn: ReturnType<typeof build>;
  private datacenter: ReturnType<typeof build>;
  private relay: ReturnType<typeof build>;

  /**
   * `vpn` = strictly VPN networks; `datacenter` = VPNs plus datacenters. `relay` = Apple iCloud Private Relay
   * egress ranges: ordinary people behind an anonymising proxy. Checked FIRST so they are not mistaken for
   * VPN traffic (the VPN lists also contain Apple's ranges).
   */
  constructor(lists: { vpn: string[]; datacenter: string[]; relay?: string[] }) {
    this.vpn = build(lists.vpn);
    this.datacenter = build(lists.datacenter);
    this.relay = build(lists.relay ?? []);
  }

  /** Number of merged ranges per list (for status and sanity checks). */
  counts() {
    return {
      vpn: this.vpn.v4.size + this.vpn.v6.size,
      datacenter: this.datacenter.v4.size + this.datacenter.v6.size,
      relay: this.relay.v4.size + this.relay.v6.size,
    };
  }

  /** null = unknown (missing or unparsable address). */
  classify(ip: string | null | undefined): Network | null {
    const p = parseIp(ip);
    if (!p) return null;
    const n = BigInt(p.n);
    const pick = (set: ReturnType<typeof build>) => (p.v === 4 ? set.v4 : set.v6);
    if (pick(this.relay).has(n)) return "relay";
    if (pick(this.vpn).has(n)) return "vpn";
    if (pick(this.datacenter).has(n)) return "datacenter";
    return "regular";
  }
}
