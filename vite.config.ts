import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/magdalenian/ in production, root in dev.
// Keyed off `mode` rather than `command` so `vite preview` — which runs with
// command "serve" but mode "production" — serves the same paths it built.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/magdalenian/' : '/',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Magdalenian Observer',
        short_name: 'Magdalenian',
        description:
          'An interactive observer for a simulated year in the life of a Magdalenian hunter-gatherer band.',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the shell and the always-needed datasets (~300 KB). The four
        // season detail chunks are deliberately excluded and cached on demand.
        globPatterns: [
          '**/*.{js,css,html,woff,woff2,png,svg}',
          'data/year-index.json',
          'data/locations.json',
          'data/characters.json',
          'data/character-profiles.json',
          'data/events.json',
          'data/default-events.json',
        ],
        runtimeCaching: [
          {
            urlPattern: /\/data\/year-detail-[a-z]+\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'magdalenian-season-detail',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    assetsInlineLimit: 4096,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
