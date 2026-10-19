import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/TriageTrainer/
const base = '/TriageTrainer/';

export default defineConfig({
  base,
  plugins: [
    // Offline play: the app shell, content and art are precached on first visit,
    // and a new deploy replaces them automatically on the next visit.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/pwa.ts so the home screen can say when it's ready
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Triage Trainer',
        short_name: 'Triage',
        description: 'Practise mass-casualty triage sieves for New Zealand Response Team volunteers.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#111618',
        theme_color: '#1d5c68',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // The art contact sheet is a separate 5 MB review page: never precache it, and never
        // answer its URL with the app shell.
        globIgnores: ['preview/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/preview\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
