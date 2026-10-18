import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Agent worktrees under .claude/ hold other checkouts of this repo; run only this one's tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // package.json makes the Semrush package a one-workspace build; suites that load the real main process keep today's
    // two workspaces (tests of single mode pass a workspacePolicy or set the variable themselves).
    env: { STUDIO_WORKSPACE_MODE: 'multi' },
    // Suites that render the whole app or drive the real main process take a few seconds each; on a busy CI runner the
    // 5 s default timed out at random. 20 s keeps a hung test visible without flaking on load.
    testTimeout: 20000,
    coverage: {
      // Main and web code included so the server-side gate (access, roles, team store, studio server) shows up in coverage.
      include: ['src/shared/**/*.js', 'src/main/**/*.js', 'src/web/**/*.{js,jsx}'],
      exclude: ['out/**'],
    },
  },
});
