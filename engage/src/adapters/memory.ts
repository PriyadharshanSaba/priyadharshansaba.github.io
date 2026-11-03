import type { Comment, PageView, Store } from "../types.ts";

/** For tests and local dev. Data is lost on restart. */
export function memoryStore(): Store {
  const comments: Comment[] = [];
  const views: PageView[] = [];
  return {
    async addComment(c) { comments.push(c); },
    async listComments(site, slug, limit) {
      return comments
        .filter((c) => c.site === site && c.slug === slug && c.status === "visible")
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
    async setCommentStatus(id, status) {
      const c = comments.find((x) => x.id === id);
      if (c) c.status = status;
    },
    async countRecentComments(h, since) { return comments.filter((c) => c.ipHash === h && c.createdAt >= since).length; },
    async addView(v) { views.push(v); },
    async hasRecentView(site, path, visitor, since) {
      return views.some((v) => v.site === site && v.path === path && v.visitor === visitor && v.ts >= since);
    },
    async deleteViewsBefore(ts) {
      for (let i = views.length - 1; i >= 0; i--) if (views[i].ts < ts) views.splice(i, 1);
    },
    async viewsSince(site, since) { return views.filter((v) => v.site === site && v.ts >= since); },
  };
}
