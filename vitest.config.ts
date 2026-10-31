import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
