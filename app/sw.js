/* CARBMAXX service worker — generated at build time. */
const VERSION = "carbmaxx-dba979b43122";
const PRECACHE = ["./","./apple-touch-icon.png","./assets/IdeasSheet-D2aKwsip.js","./assets/ReplanSheet-Ce8wfy_A.js","./assets/TypedLog-DPSErEiA.js","./assets/core-CwYxhJls.js","./assets/core.meta-CaAwJKQ3.js","./assets/dri-table-bfmUC6jl.js","./assets/examples-BoJYV1KP.js","./assets/generate-DY9PlFQD.js","./assets/index-Bq0lj4oB.js","./assets/index-DK_NYXCe.css","./assets/index.browser-vsrAZvGu.js","./assets/inter-greek-ext-wght-normal-DlzME5K_.woff2","./assets/inter-greek-wght-normal-CkhJZR-_.woff2","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/match-BKzJKzkX.js","./assets/ocr-DcsXibFD.js","./assets/ponyfill-DdE6jAwG.js","./assets/rolldown-runtime-BCiCTKAo.js","./assets/src-BmUdCsRu.js","./assets/zxing_reader-BxB2YfIY.wasm","./assets/zxing_reader-DJ-Ysdss.js","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./icon.svg","./manifest.webmanifest"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('carbmaxx-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./', copy)); }
      return res;
    }).catch(() => caches.open(VERSION).then((c) => c.match('./', { ignoreVary: true })).then((r) => r || Response.error())));
    return;
  }
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/ocr/'))) c.put(req, res.clone());
    return res;
  }))));
});
