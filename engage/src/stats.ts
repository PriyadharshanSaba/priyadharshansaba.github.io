import type { FlaggedLabel, PageView, Stats } from "./types.ts";

const DAY = 86_400_000;
const SEP = "\t"; // separator inside composite keys (never appears in a city or country name)
const isFlagged = (v: PageView) => v.network === "vpn" || v.network === "datacenter" || v.network === "timezone";
export const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

function top<T>(items: T[], key: (t: T) => string | undefined, n = 10) {
  const m = new Map<string, number>();
  for (const i of items) { const k = key(i); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Like top(), but counts distinct people per day: one person = one count per item per day. */
function topPeople(items: PageView[], key: (v: PageView) => string | undefined, n = 10) {
  const m = new Map<string, Set<string>>();
  for (const v of items) {
    const k = key(v);
    if (!k) continue;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(`${v.visitor}|${dayKey(v.ts)}`);
  }
  return [...m].map(([k, s]) => [k, s.size] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** UTC midnight at the start of the oldest day shown (the chart's first bar). */
export const windowStart = (days: number, now = Date.now()) =>
  Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - (days - 1) * DAY;

/**
 * Pure function: raw views in, dashboard numbers out. Backend-independent.
 *  - totalViews = page views (every page a person opens counts)
 *  - visits     = one per person per day, however many pages they open
 * The visitor code already rotates daily, so distinct codes per day == people per day.
 * Everything is computed from the days shown in the chart, so totals always match the bars.
 */
export function aggregate(allViews: PageView[], days: number, now = Date.now()): Stats {
  // Per day: page views, and the people (visitor codes) who came, each with ONE country and a flagged marker.
  type Person = { country?: string; flagged: boolean };
  const byDayMap = new Map<string, { views: number; people: Map<string, Person> }>();
  for (let i = days - 1; i >= 0; i--) byDayMap.set(dayKey(now - i * DAY), { views: 0, people: new Map() });
  const views = allViews.filter((v) => byDayMap.has(dayKey(v.ts)));
  for (const v of views) {
    const d = byDayMap.get(dayKey(v.ts))!;
    d.views++;
    let p = d.people.get(v.visitor);
    if (!p) { p = { flagged: false }; d.people.set(v.visitor, p); }
    if (!p.country && v.country) p.country = v.country;   // first known country wins, so nobody is counted twice
    if (isFlagged(v)) p.flagged = true;                    // flagged if ANY of their views was
  }
  // VPN and datacenter traffic (which includes most bots that fake a normal user-agent) is kept out of
  // the city/country lists and grouped separately. Unlabelled rows (old data) count as regular.
  const flaggedViews = views.filter(isFlagged);
  const regularViews = views.filter((v) => !isFlagged(v));

  const cityOf = new Map<string, string | undefined>();
  for (const v of regularViews) if (v.city) cityOf.set(v.city, v.country);
  const flaggedCityCountry = new Map<string, string | undefined>();
  for (const v of flaggedViews) if (v.city) flaggedCityCountry.set(`${v.network}${SEP}${v.city}`, v.country);

  const byDay = [...byDayMap].map(([day, d]) => {
    // Countries that day, one count per person, so they always add up to the bar (visitors).
    const tally = new Map<string, { visits: number; flagged: number }>();
    for (const p of d.people.values()) {
      const country = p.country ?? "XX";                   // XX = unknown, so nobody goes missing
      const t = tally.get(country) ?? { visits: 0, flagged: 0 };
      t.visits++; if (p.flagged) t.flagged++;
      tally.set(country, t);
    }
    const countries = [...tally]
      .map(([country, t]) => ({ country, visits: t.visits, flagged: t.flagged }))
      .sort((a, b) => b.visits - a.visits || a.country.localeCompare(b.country));
    return { day, views: d.views, visitors: d.people.size, countries };
  });
  const peopleOf = (items: PageView[]) => new Set(items.map((v) => `${v.visitor}|${dayKey(v.ts)}`)).size;
  const split = (key: string) => key.split(SEP) as [FlaggedLabel, string];

  return {
    days,
    totalViews: views.length,
    visits: byDay.reduce((n, d) => n + d.visitors, 0),
    byDay,
    // Cities, countries and pages count people per day (visits). Referrers still count page views.
    topCities: topPeople(regularViews, (v) => v.city).map(([city, n]) => ({ city, country: cityOf.get(city), visits: n })),
    topCountries: topPeople(regularViews, (v) => v.country).map(([country, visits]) => ({ country, visits })),
    topPages: topPeople(views, (v) => v.path).map(([path, visits]) => ({ path, visits })),
    topReferrers: top(views, (v) => v.referrer).map(([referrer, views]) => ({ referrer, views })),
    flagged: {
      visits: peopleOf(flaggedViews),
      byNetwork: {
        vpn: peopleOf(flaggedViews.filter((v) => v.network === "vpn")),
        datacenter: peopleOf(flaggedViews.filter((v) => v.network === "datacenter")),
        timezone: peopleOf(flaggedViews.filter((v) => v.network === "timezone")),
      },
      cities: topPeople(flaggedViews, (v) => (v.city ? `${v.network}${SEP}${v.city}` : undefined), 20).map(([key, visits]) => {
        const [network, city] = split(key);
        return { city, country: flaggedCityCountry.get(key), network, visits };
      }),
      countries: topPeople(flaggedViews, (v) => (v.country ? `${v.network}${SEP}${v.country}` : undefined), 20).map(([key, visits]) => {
        const [network, country] = split(key);
        return { country, network, visits };
      }),
    },
  };
}
