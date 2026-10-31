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
  "connect-src 'self' https://world.openfoodfacts.org https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * Label OCR runs on the device with Tesseract (Apache-2.0). Its worker, WebAssembly core (with and
 * without SIMD) and the Greek + English "best_int" models are served from our own origin under a
 * versioned path — nothing is fetched from a CDN. They load only when a label photo is read.
 */
const OCR_DIR = 'ocr/7.0.0'; // also in src/integrations/ocr.ts
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'lang/ell.traineddata.gz': 'node_modules/@tesseract.js-data/ell/4.0.0_best_int/ell.traineddata.gz',
};

function ocrAssets(): Plugin {
  const source = (rel: string) => path.resolve(__dirname, OCR_FILES[rel]!);
  return {
    name: 'carbmaxx-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = `/app/${OCR_DIR}/`;
        const rel = req.url?.startsWith(prefix) ? decodeURIComponent(req.url.slice(prefix.length).split('?')[0]!) : null;
        if (!rel || !OCR_FILES[rel]) return next();
        res.setHeader('Content-Type', rel.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(source(rel)).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of Object.keys(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `${OCR_DIR}/${rel}`, source: fs.readFileSync(source(rel)) });
    },
  };
}

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
      // OCR files (~8 MB) are cached on first use instead of at install.
      const files = [...Object.keys(bundle), ...publicFiles].filter((f) => !f.endsWith('.map') && !f.startsWith('ocr/')).sort();
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
    if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/ocr/'))) c.put(req, res.clone());
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
  plugins: [preact(), cspMeta(), ocrAssets(), serviceWorker()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    target: 'es2022',
    assetsDir: 'assets',
  },
  preview: { port: 4173, strictPort: true },
});
