import { test } from "node:test";
import assert from "node:assert/strict";
import { NetworkClassifier, parseCidrList, parseIp } from "../src/network.ts";

test("parseIp: IPv4", () => {
  assert.deepEqual(parseIp("1.2.3.4"), { v: 4, n: 16909060 });
  assert.deepEqual(parseIp("0.0.0.0"), { v: 4, n: 0 });
  assert.deepEqual(parseIp("255.255.255.255"), { v: 4, n: 4294967295 });
});

test("parseIp: rejects bad IPv4", () => {
  for (const bad of ["", "1.2.3", "256.1.1.1", "a.b.c.d", "1.2.3.4.5", "01.2.3.4", "1.2.3.-4", " "]) {
    assert.equal(parseIp(bad), null, bad);
  }
});

test("parseIp: IPv6 forms", () => {
  assert.deepEqual(parseIp("::"), { v: 6, n: 0n });
  assert.deepEqual(parseIp("::1"), { v: 6, n: 1n });
  assert.deepEqual(parseIp("2001:db8::1"), { v: 6, n: 0x20010db8000000000000000000000001n });
  assert.deepEqual(parseIp("2001:0DB8:0:0:0:0:0:1"), { v: 6, n: 0x20010db8000000000000000000000001n });
  assert.deepEqual(parseIp("fe80::1%eth0"), { v: 6, n: 0xfe800000000000000000000000000001n }); // zone id ignored
  assert.deepEqual(parseIp("[2001:db8::1]"), { v: 6, n: 0x20010db8000000000000000000000001n });
});

test("parseIp: IPv4-mapped IPv6 is treated as IPv4", () => {
  assert.deepEqual(parseIp("::ffff:1.2.3.4"), { v: 4, n: 16909060 });
});

test("parseIp: rejects bad IPv6", () => {
  for (const bad of [":::", "1::2::3", "12345::1", "g::1", "1:2:3:4:5:6:7:8:9", "1:2:3"]) {
    assert.equal(parseIp(bad), null, bad);
  }
});

test("parseCidrList keeps valid entries and drops comments, blanks and junk", () => {
  const text = "# vpn list\n1.2.3.0/24\n\n  10.0.0.0/8  \nnot-a-cidr\n2001:db8::/32\n1.2.3.4\n1.2.3.0/33\n300.1.1.1/8\n";
  assert.deepEqual(parseCidrList(text), ["1.2.3.0/24", "10.0.0.0/8", "2001:db8::/32", "1.2.3.4"]);
});

const lists = {
  vpn: ["10.0.0.0/24"],
  datacenter: ["10.0.0.0/16", "20.0.0.0/8", "2001:db8::/32", "30.0.0.0/25", "30.0.0.128/25"],
};
const c = new NetworkClassifier(lists);

test("classify: the VPN list wins over the broader datacenter list", () => {
  assert.equal(c.classify("10.0.0.5"), "vpn");
  assert.equal(c.classify("10.0.1.5"), "datacenter");
});

test("classify: range boundaries are inclusive and exact", () => {
  assert.equal(c.classify("20.0.0.0"), "datacenter");
  assert.equal(c.classify("20.255.255.255"), "datacenter");
  assert.equal(c.classify("19.255.255.255"), "regular");
  assert.equal(c.classify("21.0.0.0"), "regular");
});

test("classify: adjacent ranges are merged and both halves match", () => {
  assert.equal(c.classify("30.0.0.1"), "datacenter");
  assert.equal(c.classify("30.0.0.127"), "datacenter");
  assert.equal(c.classify("30.0.0.128"), "datacenter");
  assert.equal(c.classify("30.0.0.255"), "datacenter");
  assert.equal(c.classify("30.0.1.0"), "regular");
});

test("classify: IPv6 and IPv4-mapped IPv6", () => {
  assert.equal(c.classify("2001:db8::1"), "datacenter");
  assert.equal(c.classify("2001:db9::1"), "regular");
  assert.equal(c.classify("::ffff:20.1.1.1"), "datacenter");
});

test("classify: a bare IP entry matches only that address", () => {
  const one = new NetworkClassifier({ vpn: ["9.9.9.9"], datacenter: [] });
  assert.equal(one.classify("9.9.9.9"), "vpn");
  assert.equal(one.classify("9.9.9.10"), "regular");
});

test("classify: missing or garbage input returns null (unknown), never throws", () => {
  assert.equal(c.classify(null), null);
  assert.equal(c.classify(undefined), null);
  assert.equal(c.classify(""), null);
  assert.equal(c.classify("garbage"), null);
});

test("classify: empty lists classify every valid IP as regular", () => {
  const empty = new NetworkClassifier({ vpn: [], datacenter: [] });
  assert.equal(empty.classify("1.2.3.4"), "regular");
});

test("classify: overlapping and unsorted ranges still work", () => {
  const o = new NetworkClassifier({ vpn: [], datacenter: ["50.0.0.0/16", "50.0.0.0/8", "40.0.0.0/24", "40.0.0.128/25"] });
  assert.equal(o.classify("50.200.0.1"), "datacenter");
  assert.equal(o.classify("40.0.0.200"), "datacenter");
  assert.equal(o.classify("40.0.1.0"), "regular");
});
