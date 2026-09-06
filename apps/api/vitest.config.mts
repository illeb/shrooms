import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // I test coprono la logica pura (decoder, aggregatore): niente container
    // Nest, niente database. Restano veloci e girano ovunque.
    environment: 'node',
  },
});
