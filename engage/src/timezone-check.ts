import { ZONE_COUNTRIES } from "./timezones.ts";

const KNOWN_COUNTRIES = new Set(Object.values(ZONE_COUNTRIES).flatMap((v) => v.split(" ")));
const TZ_NAME = /^[A-Za-z0-9_+\-/]{1,64}$/;

/**
 * Does the browser's timezone belong to the country the visitor's IP is in?
 *   true  = consistent
 *   false = mismatch (e.g. a browser in Asia/Kolkata on a US IP), a hint of a VPN, proxy or bot
 *   null  = can't tell (missing/unknown timezone such as "UTC" or "Etc/GMT+5", or unknown country)
 *
 * Only a hint: travellers, expats and roaming SIMs also mismatch, so callers must treat false as "unreliable
 * location", not proof. The timezone is compared and discarded; it is never stored.
 */
export function timezoneMatchesCountry(tz: unknown, country: unknown): boolean | null {
  if (typeof tz !== "string" || typeof country !== "string") return null;
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || !KNOWN_COUNTRIES.has(cc)) return null;
  if (!TZ_NAME.test(tz) || !Object.hasOwn(ZONE_COUNTRIES, tz)) return null; // hasOwn: "__proto__" etc. are not zones
  return ZONE_COUNTRIES[tz].split(" ").includes(cc);
}
