import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

type Entry = 'app' | 'workbench' | 'holding';
const entries: Record<Entry, string> = {
  app: 'web/src/main.jsx',
  workbench: 'web/src/workbench/main.jsx',
  holding: 'web/src/holding/main.jsx',
};
const requested = process.env.WEB_ENTRY || 'app';
const entry: Entry = requested === 'workbench' || requested === 'holding' ? requested : 'app';
export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: 'web/dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    lib: { entry: entries[entry], name: 'Faah', formats: ['iife'], fileName: () => `${entry}.js` },
  },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    isolate: true,
    setupFiles: ['./web/src/test-setup.ts'],
    include: ['web/src/**/*.test.{js,jsx,ts,tsx}'],
    restoreMocks: true,
  },
});
