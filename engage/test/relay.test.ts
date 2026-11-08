import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, memoryStore } from "../src/index.ts";
import { NetworkClassifier } from "../src/network.ts";
import { aggregate } from "../src/stats.ts";
import type { PageView } from "../src/types.ts";

// Apple's Private Relay ranges also sit inside the VPN list; relay must win.
const classifier = new NetworkClassifier({
  vpn: ["172.224.0.0/12", "5.5.5.0/24"],
  datacenter: ["172.224.0.0/12"],
  relay: ["172.225.219.0/24", "2a02:26f7::/32"],
});

test("relay ranges win over the VPN and datacenter lists", () => {
  assert.equal(classifier.classify("172.225.219.55"), "relay");
  assert.equal(classifier.classify("2a02:26f7::1"), "relay");
  assert.equal(classifier.classify("172.225.220.1"), "vpn");   // same /12, not a relay range
  assert.equal(classifier.counts().relay, 2);
});

test("without a relay list the classifier behaves as before", () => {
  const c = new NetworkClassifier({ vpn: ["5.5.5.0/24"], datacenter: [] });
  assert.equal(c.classify("5.5.5.5"), "vpn");
  assert.equal(c.counts().relay, 0);
});

test("a relay view is stored as 'relay', not flagged, and not turned into a timezone flag", async () => {
  const store = memoryStore();
  const network = { classify: (ip: string | null) => classifier.classify(ip), status: () => ({ loaded: true }) };
  const h = createHandler({ store, allowedOrigins: ["https://x.example"], adminToken: "t", salt: "s", network });
  await h(new Request("http://x/api/view", {
    method: "POST",
    headers: {
      origin: "https://x.example", "x-forwarded-for": "172.225.219.55", "user-agent": "Mozilla/5.0 Safari",
      "x-vercel-ip-country": "US", "x-vercel-ip-city": "Austin",
    },
    body: JSON.stringify({ site: "s", path: "/", tz: "Asia/Kolkata" }),
  }));
  const [row] = await store.viewsSince("s", 0);
  assert.equal(row.network, "relay");
});

test("relay visits show up as regular traffic in the stats", () => {
  const NOW = Date.UTC(2026, 10, 7, 12);
  const v = (visitor: string, network: PageView["network"]): PageView =>
    ({ site: "s", path: "/", visitor, city: "Austin", country: "US", network, ts: NOW });
  const s = aggregate([v("a", "relay"), v("b", "vpn")], 10, NOW);
  assert.equal(s.flagged.visits, 1);
  assert.deepEqual(s.topCities.map((c) => c.city), ["Austin"]);
  assert.equal(s.topCities[0].visits, 1);
});
