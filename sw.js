/* Morioka Masjid — notifications + works without internet.
   Pages: always from the internet when there is one (so they are always fresh); the last copy is kept
   and shown only when the phone is offline. Other sites (Quran, maps, fonts) are not touched.
   The push itself is empty: on each push we ask iwate-bd.org (the Prayer Times plugin that sends
   them) what to show, exactly like its own worker does. */
var MSG = 'https://iwate-bd.org/?pt_msg=1';
var ICON = '/icon-192.png';
// a picture per kind (Android / computer; iPhone always shows the app's icon — there the title's first emoji tells them apart)
var KINDS = ['adhan', 'jamaat', 'iftar', 'dua', 'hijri', 'gomi', 'live', 'post', 'admin', 'alert', 'test'];

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

var KEEP = 'mm-offline-1';
self.addEventListener('message', function (e) {      // the page asks to keep its own copy (first visit)
  var d = e.data || {};
  if (!Array.isArray(d.keep)) return;
  e.waitUntil(caches.open(KEEP).then(function (c) {
    return Promise.all(d.keep.filter(function (p) { return typeof p === 'string' && p.charAt(0) === '/'; }).slice(0, 5)
      .map(function (p) { return c.add(p).catch(function () {}); }));
  }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname === '/sw.js') return;
  e.respondWith(fetch(r).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(KEEP).then(function (c) { c.put(u.origin + u.pathname, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(u.origin + u.pathname, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (r.mode !== 'navigate') return Response.error();
      return caches.match(u.origin + '/').then(function (home) { return home || Response.error(); });
    });
  }));
});

self.addEventListener('push', function (e) {
  var ep = '', jid = '';
  function ack(ok, err) {     // tell the server it was shown (the admin list uses it)
    if (!ep) return Promise.resolve();
    var perm = (self.Notification && self.Notification.permission) || '?';
    return fetch(MSG + '&ack=' + (ok ? 1 : 0) + '&p=' + encodeURIComponent(perm) + '&id=' + encodeURIComponent(jid)
      + '&err=' + encodeURIComponent(String(err || '').slice(0, 150)) + '&e=' + encodeURIComponent(ep)).catch(function () {});
  }
  e.waitUntil(
    self.registration.pushManager.getSubscription().then(function (sub) {
      if (!sub) return null;
      ep = sub.endpoint;
      return fetch(MSG + '&e=' + encodeURIComponent(ep)).then(function (r) { return r.json(); });
    }).catch(function () { return null; }).then(function (d) {
      // iPhone needs a notification for every push, or it cancels the subscription
      if (!d || !d.title) d = { title: '🕌 Morioka Masjid', body: 'Prayer times · 礼拝時間', url: '/', k: 'adhan' };
      var kd = KINDS.indexOf(d.k) > -1;
      jid = d.id || '';
      var opts = { body: d.body || '', tag: d.id ? 'pt-' + d.id : 'prayer', renotify: true, icon: kd ? '/notif/' + d.k + '.png' : ICON, badge: kd ? '/notif/' + d.k + '-b.png' : ICON,
        data: { url: d.url || '/', id: d.id || '', ep: ep } };
      if (d.image) opts.image = d.image;
      return self.registration.showNotification(d.title, opts)
        .then(function () { return ack(true, ''); }, function (err1) {
          return self.registration.showNotification(d.title, { body: d.body || '' })
            .then(function () { return ack(true, 'retry: ' + err1); }, function (err2) { return ack(false, err2); });
        });
    }).catch(function (err) { return ack(false, err); })
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var nd = e.notification.data || {};
  if (nd.id) fetch(MSG + '&clk=' + encodeURIComponent(nd.id) + '&e=' + encodeURIComponent(nd.ep || '')).catch(function () {});
  // prayer / Jumu'ah / Islamic-day notifications open this site; a post or alert opens its own page
  var url = '/#times';
  try {
    var u = new URL(nd.url || '/', 'https://iwate-bd.org/');
    // adhan notification: open the site with the azan player (?azan=prayer index, t=send time)
    var q = u.searchParams, ai = q.get('pt_adhan');
    if (ai === null && q.get('pt_card') !== null && q.get('k') !== 'j') ai = q.get('pt_card');
    if (ai !== null && /^[0-5]$/.test(ai)) url = '/?azan=' + ai + '&t=' + encodeURIComponent(q.get('pt_t') || '') + '#times';
    // garbage-day reminder: this site shows that day's picture card, in the visitor's language
    var gd = q.get('pt_gomi');
    if (gd && /^\d{4}-\d{2}-\d{2}$/.test(gd)) url = '/?gomi=' + gd + '#notif';
    if (u.hostname === self.location.hostname) url = u.pathname + u.search + u.hash;   // this site's own page (masjid notice)
    var mine = u.hostname === 'iwate-bd.org' && u.pathname === '/'
      && !/[?&](p|page_id|hs_code)=/.test(u.search) && (nd.id ? /pt_/.test(u.search) : true);
    if (!mine && nd.id) url = u.href;
  } catch (x) {}
  var inScope = url.charAt(0) === '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (inScope && 'focus' in list[i]) {
        return ('navigate' in list[i] ? list[i].navigate(url) : Promise.resolve(list[i]))
          .then(function (c) { return (c || list[0]).focus(); })
          .catch(function () { return clients.openWindow && clients.openWindow(url); });
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
