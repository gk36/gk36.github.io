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
  plugins: [preact(), cspMeta()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    target: 'es2022',
    assetsDir: 'assets',
  },
  preview: { port: 4173, strictPort: true },
});
