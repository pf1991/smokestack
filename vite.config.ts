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
    // forks: Node 24 + tinypool threads tears down with stack overflow locally; forks also isolates
    // balance.test.ts process.cpuUsage() so the 100-year budget is not polluted by sibling workers.
    pool: 'forks',
  },
});
