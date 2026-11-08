(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var site = script.getAttribute('data-site');
  if (!site) return;
  var origin = script.src.replace(/\/t\.js.*$/, '');
  var endpoint = origin + '/api/collect';
  var lastPath = null;

  function send() {
    var path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    var body = JSON.stringify({ siteToken: site, path: path, referrer: document.referrer || null });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch {
      /* fall through to fetch */
    }
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch {
      /* no-op: never let analytics break the host page */
    }
  }

  // SPA route-change support: pushState/replaceState don't fire any native event,
  // so wrap them (same approach every "cookieless analytics" snippet uses).
  ['pushState', 'replaceState'].forEach(function (name) {
    var orig = history[name];
    history[name] = function () {
      var ret = orig.apply(this, arguments);
      send();
      return ret;
    };
  });
  window.addEventListener('popstate', send);

  send();
})();
