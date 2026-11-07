import { test } from "node:test";
import assert from "node:assert/strict";
import { timezoneMatchesCountry as check } from "../src/timezone-check.ts";

test("matching timezone and country", () => {
  const matches: [string, string][] = [
    ["Asia/Kolkata", "IN"], ["America/New_York", "US"], ["America/Los_Angeles", "US"], ["America/Chicago", "US"],
    ["Europe/London", "GB"], ["America/Sao_Paulo", "BR"], ["Australia/Sydney", "AU"], ["Asia/Singapore", "SG"],
    ["Asia/Dubai", "AE"], ["Europe/Stockholm", "SE"], ["Asia/Kathmandu", "NP"], ["Asia/Ho_Chi_Minh", "VN"],
  ];
  for (const [tz, cc] of matches) assert.equal(check(tz, cc), true, `${tz} / ${cc}`);
});

test("old zone names that browsers still report resolve to the right country (Chrome says Asia/Calcutta)", () => {
  const aliases: [string, string][] = [
    ["Asia/Calcutta", "IN"], ["Asia/Katmandu", "NP"], ["Asia/Saigon", "VN"], ["Europe/Belfast", "GB"],
    ["America/Buenos_Aires", "AR"], ["Asia/Rangoon", "MM"], ["Europe/Kiev", "UA"],
  ];
  for (const [tz, cc] of aliases) assert.equal(check(tz, cc), true, `${tz} / ${cc}`);
});

test("countries that share a timezone with a neighbour are not flagged", () => {
  assert.equal(check("Europe/Zurich", "LI"), true);   // Liechtenstein uses Zurich's timezone
  assert.equal(check("Europe/Zurich", "CH"), true);
  assert.equal(check("Europe/Paris", "MC"), true);    // Monaco
  assert.equal(check("Europe/Belgrade", "HR"), true); // Croatia shares Belgrade's zone data
});

test("a timezone from a different country is a mismatch", () => {
  assert.equal(check("America/New_York", "IN"), false);
  assert.equal(check("Asia/Kolkata", "US"), false);
  assert.equal(check("Asia/Calcutta", "US"), false);   // an Indian browser on a US datacenter IP
  assert.equal(check("Asia/Kolkata", "NP"), false);
  assert.equal(check("Europe/London", "SE"), false);
});

test("country codes are case-insensitive", () => {
  assert.equal(check("Asia/Kolkata", "in"), true);
  assert.equal(check("Asia/Kolkata", "us"), false);
});

test("unknown timezones give no verdict (null), never a false alarm", () => {
  for (const tz of [undefined, null, "", "UTC", "Etc/UTC", "Etc/GMT+5", "GMT", "Invalid/Zone", "x", "Asia/Kolkata; DROP TABLE", "A".repeat(200), "__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(check(tz as string | null | undefined, "IN"), null, String(tz));
  }
});

test("unknown countries give no verdict (null)", () => {
  for (const cc of [undefined, null, "", "XX", "T1", "ZZ", "usa", "1", "12"]) {
    assert.equal(check("Asia/Kolkata", cc as string | null | undefined), null, String(cc));
  }
});
