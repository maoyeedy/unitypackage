import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  plugins: [
    babel({
      presets: [reactCompilerPreset()],
    }),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      includeAssets: ['favicon.svg', 'unitypackage-icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      manifest: {
        name: 'Unity Package Workspace',
        short_name: 'UnityPkg',
        description: 'Inspect and prepare Unity package files in the browser.',
        theme_color: '#111827',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '.',
        icons: [
          {
            src: 'unitypackage-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/x-unitypackage': ['.unitypackage'],
            },
          },
        ],
      },
    }),
  ],
});
