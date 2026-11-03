/* portfolio-engage embed. Usage on any page (static HTML or React):
 *   <div id="comments"></div>
 *   <script src="embed.js" data-api="https://engage.example.com/api"
 *           data-site="photo" data-slug="kolkata" data-target="#comments"></script>
 * Also sends one anonymous page view. No cookies, no localStorage of identifiers. */
(function () {
  var s = document.currentScript, d = s.dataset;
  var api = d.api, site = d.site, slug = d.slug || location.pathname;
  var post = function (p, b) {
    return fetch(api + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  };
  post("/view", { site: site, path: location.pathname, referrer: document.referrer ? new URL(document.referrer).hostname : "" }).catch(function () {});

  var root = document.querySelector(d.target || "#comments");
  if (!root) return;
  var el = function (t, props, kids) {
    var n = Object.assign(document.createElement(t), props || {});
    (kids || []).forEach(function (k) { n.append(k); });
    return n;
  };
  var list = el("div", { className: "pe-list" });
  var author = el("input", { placeholder: "Name", maxLength: 60 });
  var body = el("textarea", { placeholder: "Leave a comment…", maxLength: 1000, rows: 3 });
  var trap = el("input", { name: "website", tabIndex: -1, autocomplete: "off" });
  trap.style.cssText = "position:absolute;left:-9999px";
  var btn = el("button", { type: "button", textContent: "Post" });
  var msg = el("small");
  var render = function (cs) {
    list.replaceChildren.apply(list, cs.map(function (c) {
      return el("article", {}, [
        el("strong", { textContent: c.author }), " ",
        el("time", { textContent: new Date(c.createdAt).toLocaleDateString() }),
        el("p", { textContent: c.body }), // textContent: never HTML
      ]);
    }));
  };
  var load = function () {
    fetch(api + "/comments?site=" + encodeURIComponent(site) + "&slug=" + encodeURIComponent(slug))
      .then(function (r) { return r.json(); }).then(render);
  };
  btn.onclick = function () {
    btn.disabled = true;
    post("/comments", { site: site, slug: slug, author: author.value, body: body.value, website: trap.value })
      .then(function (r) { if (!r.ok) throw 0; body.value = ""; msg.textContent = "Thanks!"; load(); })
      .catch(function () { msg.textContent = "Couldn't post. Check name and message."; })
      .then(function () { btn.disabled = false; });
  };
  root.classList.add("pe-comments");
  root.append(el("h3", { textContent: "Comments" }), author, body, trap, btn, msg, list);
  load();
})();
