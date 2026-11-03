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

export interface PageView {
  site: string;
  path: string;
  visitor: string;   // daily-rotating salted hash, never a raw IP
  country?: string;
  city?: string;
  referrer?: string;
  ts: number;
}

export interface Stats {
  days: number;
  totalViews: number;
  uniqueVisitors: number;
  byDay: { day: string; views: number; visitors: number }[]; // zero-filled
  topCities: { city: string; country?: string; views: number }[];
  topCountries: { country: string; views: number }[];
  topPages: { path: string; views: number }[];
  topReferrers: { referrer: string; views: number }[];
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
