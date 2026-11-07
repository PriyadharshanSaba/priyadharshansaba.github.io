export interface Comment {
  id: string;
  site: string;      // which portfolio ("viz", "photo", ...)
  slug: string;      // page / piece the comment belongs to
  author: string;
  body: string;
  createdAt: number; // epoch ms
  status: "visible" | "pending" | "hidden";
  /** Daily-rotating hash used only for rate limiting. Never returned to clients. */
  ipHash?: string;
}

/**
 * vpn / datacenter: IP is on the X4BNet lists. timezone: IP looks regular but the browser's timezone belongs to a
 * different country than the IP's. regular: neither. Only this label is stored, never the IP or the timezone.
 */
export type NetworkLabel = "vpn" | "datacenter" | "timezone" | "regular";
export type FlaggedLabel = Exclude<NetworkLabel, "regular">;

export interface PageView {
  site: string;
  path: string;
  visitor: string;   // daily-rotating salted hash, never a raw IP
  country?: string;
  city?: string;
  referrer?: string;
  /**
   * What kind of network the visit came from. A coarse label only: the IP itself is never stored.
   * undefined = unknown (no classifier, or an unreadable IP, or a row from before this existed).
   */
  network?: NetworkLabel;
  ts: number;
}

export interface FlaggedStats {
  /** One per person per day on VPN/datacenter networks or with a timezone mismatch (included in Stats.visits). */
  visits: number;
  byNetwork: { vpn: number; datacenter: number; timezone: number };
  cities: { city: string; country?: string; network: FlaggedLabel; visits: number }[];
  countries: { country: string; network: FlaggedLabel; visits: number }[];
}

export interface Stats {
  days: number;
  totalViews: number;
  /** One per person per day, however many pages they opened (sum of byDay[].visitors). */
  visits: number;
  byDay: { day: string; views: number; visitors: number }[]; // zero-filled
  /** Regular traffic only. VPN and datacenter visits are grouped under `flagged`. */
  topCities: { city: string; country?: string; visits: number }[];
  topCountries: { country: string; visits: number }[];
  topPages: { path: string; visits: number }[];
  topReferrers: { referrer: string; views: number }[];
  flagged: FlaggedStats;
  /** Added by the API: whether the VPN/datacenter lists were loaded when this was computed. */
  networkLists?: { loaded: boolean; fetchedAt?: string };
}

/** The ONLY thing storage backends implement. Swap freely. */
export interface Store {
  addComment(c: Comment): Promise<void>;
  listComments(site: string, slug: string, limit: number): Promise<Comment[]>;
  setCommentStatus(id: string, status: Comment["status"]): Promise<void>;
  /** Comments posted by this hash since `sinceTs` (rate limiting). */
  countRecentComments(ipHash: string, sinceTs: number): Promise<number>;
  addView(v: PageView): Promise<void>;
  /** True if this visitor already viewed this page since `sinceTs` (dedupe reloads). */
  hasRecentView(site: string, path: string, visitor: string, sinceTs: number): Promise<boolean>;
  /** Retention: remove views older than `ts`. */
  deleteViewsBefore(ts: number): Promise<void>;
  /** Raw views for a site since `sinceTs`; aggregation lives in core so it is backend-independent. */
  viewsSince(site: string, sinceTs: number): Promise<PageView[]>;
}
