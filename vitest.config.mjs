import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Agent worktrees under .claude/ hold other checkouts of this repo; run only this one's tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      include: ['src/shared/**/*.js'],
      exclude: ['out/**'],
    },
  },
});
