import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

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
  ],
});
