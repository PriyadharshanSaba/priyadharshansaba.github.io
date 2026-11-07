import type { PageView, Stats } from "./types.ts";

const DAY = 86_400_000;
export const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

function top<T>(items: T[], key: (t: T) => string | undefined, n = 10) {
  const m = new Map<string, number>();
  for (const i of items) { const k = key(i); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
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
  const byDayMap = new Map<string, { views: number; v: Set<string> }>();
  for (let i = days - 1; i >= 0; i--) byDayMap.set(dayKey(now - i * DAY), { views: 0, v: new Set() });
  const views = allViews.filter((v) => byDayMap.has(dayKey(v.ts)));
  for (const v of views) {
    const d = byDayMap.get(dayKey(v.ts))!;
    d.views++; d.v.add(v.visitor);
  }
  const cityOf = new Map<string, string | undefined>();
  for (const v of views) if (v.city) cityOf.set(v.city, v.country);
  const byDay = [...byDayMap].map(([day, d]) => ({ day, views: d.views, visitors: d.v.size }));
  return {
    days,
    totalViews: views.length,
    visits: byDay.reduce((n, d) => n + d.visitors, 0),
    byDay,
    topCities: top(views, (v) => v.city).map(([city, n]) => ({ city, country: cityOf.get(city), views: n })),
    topCountries: top(views, (v) => v.country).map(([country, views]) => ({ country, views })),
    topPages: top(views, (v) => v.path).map(([path, views]) => ({ path, views })),
    topReferrers: top(views, (v) => v.referrer).map(([referrer, views]) => ({ referrer, views })),
  };
}
