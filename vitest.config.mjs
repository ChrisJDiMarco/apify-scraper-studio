import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Agent worktrees under .claude/ hold other checkouts of this repo; run only this one's tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      // Main and web code included so the server-side gate (access, roles, team store, studio server) shows up in coverage.
      include: ['src/shared/**/*.js', 'src/main/**/*.js', 'src/web/**/*.{js,jsx}'],
      exclude: ['out/**'],
    },
  },
});
