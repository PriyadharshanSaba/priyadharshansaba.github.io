/* engage page-view tracker. Add to any page, once:
 *   <script defer src="https://engage-api-ochre.vercel.app/track.js" data-site="github-io"></script>
 * Sends one anonymous view. No cookies, nothing stored in the browser, never blocks rendering. */
(function () {
  try {
    var s = document.currentScript || document.querySelector('script[src$="track.js"]');
    if (!s) return;
    var site = s.getAttribute("data-site") || "github-io";
    var api = s.getAttribute("data-api") || new URL(s.src).origin + "/api";
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    // Strings are sent as text/plain, which skips the CORS pre-check request.
    var body = JSON.stringify({ site: site, path: location.pathname, referrer: ref });
    var url = api + "/view";
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, body))) {
      fetch(url, { method: "POST", body: body, keepalive: true }).catch(function () {});
    }
  } catch (e) { /* analytics must never break a page */ }
})();
