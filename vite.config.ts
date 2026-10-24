import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset URLs so the build works under https://<user>.github.io/<repo>/
  base: './',
  server: {
    // Dev: the JEV decision proxy (npm run ai-proxy) listens on 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
  preview: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    // The 100-year CPU budget in balance.test.ts reads process.cpuUsage(), which counts every thread of
    // its process: keep that file in a forked process of its own, never in a shared worker thread.
    poolMatchGlobs: [['**/src/sim/balance.test.ts', 'forks']],
  },
});
