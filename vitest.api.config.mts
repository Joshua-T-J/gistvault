import { defineConfig } from 'vitest/config';

// Unit tests for the Vercel function in api/. The Angular app's tests run through `ng test`.
export default defineConfig({
  test: {
    include: ['api/**/*.spec.ts'],
    environment: 'node',
  },
});
