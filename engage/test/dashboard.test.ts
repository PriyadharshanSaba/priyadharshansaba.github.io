import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Runs the dashboard's real inline script against a tiny fake page, so click behaviour is tested without a browser.
const html = readFileSync(new URL("../public/dashboard/index.html", import.meta.url), "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)![1];

type Ev = { type: string; target: El; key?: string; stopped: boolean; preventDefault(): void; stopPropagation(): void };
type Handler = (e: Ev) => void;

class El {
  children: El[] = [];
  parent: El | null = null;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  title = "";
  value = "";
  handlers: Record<string, Handler[]> = {};
  private own = "";
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...kids: (El | string)[]) {
    for (const k of kids) {
      const n = typeof k === "string" ? Object.assign(new El("#text"), { own: k }) : k;
      n.parent = this; this.children.push(n);
    }
  }
  replaceChildren(...kids: (El | string)[]) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, h: Handler) { (this.handlers[t] ??= []).push(h); }
  contains(n: El | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  focus() {}
  get textContent(): string { return [this.own, ...this.children.map((c) => c.textContent)].filter(Boolean).join(" "); }
  set textContent(t: string) { this.children = []; this.own = t; }
  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => list().includes(c),
      add: (c: string) => { if (!list().includes(c)) self.className = [...list(), c].join(" "); },
      remove: (c: string) => { self.className = list().filter((x) => x !== c).join(" "); },
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !list().includes(c);
        if (on) this.add(c); else this.remove(c);
        return on;
      },
    };
  }
  private add(c: string) { this.classList.add(c); }
  private remove(c: string) { this.classList.remove(c); }
}

const all = (root: El, pred: (e: El) => boolean): El[] => [root, ...root.children.flatMap((c) => all(c, pred))].filter(pred);

const DAYS = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, views: 0, visitors: 0, countries: [] as unknown[] }));
DAYS[9] = { day: "2026-11-10", views: 9, visitors: 5, countries: [{ country: "IN", visits: 3, flagged: 0 }, { country: "US", visits: 2, flagged: 2 }] };
DAYS[8] = { day: "2026-11-09", views: 3, visitors: 2, countries: [{ country: "XX", visits: 1, flagged: 0 }, { country: "T1", visits: 1, flagged: 0 }] };

const payload = (overrides: Record<string, unknown> = {}) => ({
  days: 10, totalViews: 12, visits: 7, byDay: DAYS, topCities: [], topCountries: [], topPages: [], topReferrers: [],
  flagged: { visits: 2, byNetwork: { vpn: 0, datacenter: 2, timezone: 0 }, cities: [], countries: [] },
  networkLists: { loaded: true }, ...overrides,
});

async function openDashboard(stats: unknown) {
  const form = new El("form");
  Object.assign(form, { site: { value: "demo" }, token: { value: "t" } });
  const els: Record<string, El> = { "#f": form, "#out": new El("div"), "#msg": new El("p"), "#go": new El("button") };
  const docHandlers: Record<string, Handler[]> = {};
  const document = {
    querySelector: (s: string) => els[s] ?? null,
    createElement: (t: string) => new El(t),
    addEventListener: (t: string, h: Handler) => { (docHandlers[t] ??= []).push(h); },
  };
  const fire = (target: El, type: string, extra: Partial<Ev> = {}) => {
    const e: Ev = { type, target, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...extra };
    for (let n: El | null = target; n && !e.stopped; n = n.parent) for (const h of n.handlers[type] ?? []) h(e);
    if (!e.stopped) for (const h of docHandlers[type] ?? []) h(e);   // events bubble up to the document
  };
  const fetchStub = async () => ({ status: 200, ok: true, json: async () => stats });
  const run = new Function("document", "location", "sessionStorage", "fetch", code);
  run(document, { origin: "http://x" }, { getItem: () => null, setItem() {} }, fetchStub);

  const load = async () => { fire(form, "submit"); await new Promise((r) => setTimeout(r, 20)); };
  await load();
  const out = els["#out"];
  return {
    out, load, fire, msg: els["#msg"],
    cols: () => all(out, (e) => e.className === "col"),
    panel: () => all(out, (e) => e.classList.contains("daypanel"))[0],
    isOpen: () => all(out, (e) => e.classList.contains("daypanel"))[0]?.classList.contains("open") ?? false,
    text: () => (all(out, (e) => e.classList.contains("daypanel"))[0]?.textContent ?? ""),
    heading: (t: string) => all(out, (e) => e.tag === "h2" && e.textContent === t)[0],
  };
}

test("the chart has one clickable button per day, starting closed", async () => {
  const d = await openDashboard(payload());
  const cols = d.cols();
  assert.equal(cols.length, 10);
  assert.ok(cols.every((c) => c.tag === "button"), "bars are real buttons (keyboard + screen reader)");
  assert.ok(cols.every((c) => c.getAttribute("aria-expanded") === "false"));
  assert.equal(d.isOpen(), false);
});

test("clicking a bar opens that day's countries, with names, counts and the day's totals", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  assert.equal(d.isOpen(), true);
  assert.equal(d.cols()[9].getAttribute("aria-expanded"), "true");
  const t = d.text();
  assert.match(t, /India/);
  assert.match(t, /United States/);
  assert.match(t, /5 visits/);
  assert.match(t, /9 page views/);
  assert.match(t, /10/);                      // the day
});

test("flagged people are called out in their country row", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  assert.match(d.text(), /2 flagged/);
});

test("clicking the same bar again collapses the panel", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.cols()[9], "click");
  assert.equal(d.isOpen(), false);
  assert.equal(d.cols()[9].getAttribute("aria-expanded"), "false");
});

test("clicking a different bar switches to that day", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.cols()[8], "click");
  assert.equal(d.isOpen(), true);
  assert.equal(d.cols()[9].getAttribute("aria-expanded"), "false");
  assert.equal(d.cols()[8].getAttribute("aria-expanded"), "true");
  assert.match(d.text(), /Unknown/);
  assert.doesNotMatch(d.text(), /India/);
});

test("unknown country codes (XX, T1) are merged into one 'Unknown' row", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[8], "click");
  assert.equal((d.text().match(/Unknown/g) ?? []).length, 1);
  assert.match(d.text(), /Unknown\s+2/);
});

test("clicking outside the chart collapses it", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.msg, "click");                                    // somewhere else on the page
  assert.equal(d.isOpen(), false);
  assert.equal(d.cols()[9].getAttribute("aria-expanded"), "false");
});

test("clicking another card on the page also collapses it", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.heading("Cities · visits"), "click");
  assert.equal(d.isOpen(), false);
});

test("clicking inside the open panel keeps it open", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  const inside = all(d.panel(), (e) => e.tag === "td")[0];
  d.fire(inside, "click");
  assert.equal(d.isOpen(), true);
});

test("Escape collapses it", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.out, "keydown", { key: "Escape" });
  assert.equal(d.isOpen(), false);
});

test("other keys do not collapse it", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  d.fire(d.out, "keydown", { key: "a" });
  assert.equal(d.isOpen(), true);
});

test("a day with no visits says so", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[0], "click");
  assert.equal(d.isOpen(), true);
  assert.match(d.text(), /No visits/);
});

test("reloading the data starts with everything collapsed", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  await d.load();
  assert.equal(d.isOpen(), false);
  assert.ok(d.cols().every((c) => c.getAttribute("aria-expanded") === "false"));
});

test("a server without per-day countries (older deploy) shows a clear message instead of breaking", async () => {
  const old = payload({ byDay: DAYS.map(({ countries: _c, ...rest }) => rest) });
  const d = await openDashboard(old);
  d.fire(d.cols()[9], "click");
  assert.equal(d.isOpen(), true);
  assert.match(d.text(), /isn't available/);
});

test("the country rows add up to the visits shown for that day", async () => {
  const d = await openDashboard(payload());
  d.fire(d.cols()[9], "click");
  const counts = all(d.panel(), (e) => e.tag === "td" && e.className === "n").map((e) => Number(e.textContent));
  assert.equal(counts.reduce((a, b) => a + b, 0), 5);
});
