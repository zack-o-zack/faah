import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const entry = process.env.WEB_ENTRY || 'app';
const entries = {
  app: 'web/src/main.jsx',
  workbench: 'web/src/workbench/main.jsx',
  holding: 'web/src/holding/main.jsx',
};
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
    setupFiles: ['./web/src/test-setup.js'],
    include: ['web/src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
