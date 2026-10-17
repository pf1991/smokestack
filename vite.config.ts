import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // Dev: the JEV decision proxy (npm run ai-proxy) listens on 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
