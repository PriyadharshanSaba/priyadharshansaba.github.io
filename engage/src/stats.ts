import type { PageView, Stats } from "./types.ts";

const DAY = 86_400_000;
export const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

function top<T>(items: T[], key: (t: T) => string | undefined, n = 10) {
  const m = new Map<string, number>();
  for (const i of items) { const k = key(i); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Pure function: raw views in, dashboard numbers out. Backend-independent. */
export function aggregate(views: PageView[], days: number, now = Date.now()): Stats {
  const byDayMap = new Map<string, { views: number; v: Set<string> }>();
  for (let i = days - 1; i >= 0; i--) byDayMap.set(dayKey(now - i * DAY), { views: 0, v: new Set() });
  for (const v of views) {
    const d = byDayMap.get(dayKey(v.ts));
    if (d) { d.views++; d.v.add(v.visitor); }
  }
  const cityOf = new Map<string, string | undefined>();
  for (const v of views) if (v.city) cityOf.set(v.city, v.country);
  return {
    days,
    totalViews: views.length,
    uniqueVisitors: new Set(views.map((v) => v.visitor)).size,
    byDay: [...byDayMap].map(([day, d]) => ({ day, views: d.views, visitors: d.v.size })),
    topCities: top(views, (v) => v.city).map(([city, n]) => ({ city, country: cityOf.get(city), views: n })),
    topCountries: top(views, (v) => v.country).map(([country, views]) => ({ country, views })),
    topPages: top(views, (v) => v.path).map(([path, views]) => ({ path, views })),
    topReferrers: top(views, (v) => v.referrer).map(([referrer, views]) => ({ referrer, views })),
  };
}
