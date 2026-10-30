import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/*
 * The app is served from https://gk36.github.io/app/ next to the legacy pages.
 * GitHub Pages cannot send HTTP headers, so the Content-Security-Policy ships as a
 * <meta> tag — injected only into production builds (Vite dev needs inline styles).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://images.openfoodfacts.org",
  "font-src 'self'",
  "connect-src 'self' https://world.openfoodfacts.org https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * Emits app/sw.js: precaches every built file (versioned by the hash of the file list), serves
 * hashed assets cache-first and the page network-first, and only ever handles same-origin GETs
 * under /app/ — never API calls, never other pages. A new version waits until the user reloads.
 */
function serviceWorker(): Plugin {
  return {
    name: 'carbmaxx-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicDir = path.resolve(__dirname, 'src', 'public');
      const publicFiles = fs.readdirSync(publicDir).filter((f) => !f.startsWith('.'));
      const files = [...Object.keys(bundle), ...publicFiles].filter((f) => !f.endsWith('.map')).sort();
      const version = `carbmaxx-${createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12)}`;
      // Font subsets for scripts the app doesn't use are fetched (and cached) only if ever needed.
      const precache = ['./', ...files.filter((f) => f !== 'index.html' && !/inter-(cyrillic|vietnamese)/.test(f)).map((f) => `./${f}`)];
      const source = `/* CARBMAXX service worker — generated at build time. */
const VERSION = ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(precache)};
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
    if (res.ok && url.pathname.includes('/assets/')) c.put(req, res.clone());
    return res;
  }))));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

function cspMeta(): Plugin {
  return {
    name: 'carbmaxx-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  root: 'src',
  base: '/app/',
  publicDir: 'public',
  plugins: [preact(), cspMeta(), serviceWorker()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    target: 'es2022',
    assetsDir: 'assets',
  },
  preview: { port: 4173, strictPort: true },
});
