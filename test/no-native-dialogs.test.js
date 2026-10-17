import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The studio asks in its own dialog (confirm-dialog.jsx useConfirm), so questions read the same in both layouts and on
// the web. New window.confirm / window.alert calls are caught here. The files listed still carry one, each for a reason
// (or until its owner moves it over); remove a file from the list once it is clean.
const STILL_NATIVE = new Map([
  ['confirm-dialog.jsx', 'the fallback when no ConfirmProvider is mounted'],
  ['asset-editor.jsx', 'the synchronous unsaved-edits guard every navigation path asks inline'],
  ['brand-images.jsx', 'not moved yet'],
  ['research-knowledge.jsx', 'not moved yet'],
  ['settings-view.jsx', 'not moved yet'],
  ['sheets-view.jsx', 'not moved yet'],
  ['studio-sidebar.jsx', 'not moved yet'],
  ['studio-actions.js', 'not moved yet'],
]);
const root = join(import.meta.dirname, '..', 'src', 'renderer', 'src');

describe('in-app dialogs only', () => {
  it('has no window.confirm or window.alert outside the known files', () => {
    const offenders = readdirSync(root).filter((name) => /\.(jsx?|mjs)$/.test(name) && !STILL_NATIVE.has(name))
      .filter((name) => /window\.(confirm|alert)\s*\(/.test(readFileSync(join(root, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
