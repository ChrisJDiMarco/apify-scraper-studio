// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesPanel } from '../src/renderer/src/report-editor/NotesPanel.jsx';
import { Dialog } from '../src/renderer/src/role-screens.jsx';

afterEach(cleanup);
const note = { id: 'n1', body: 'Is this figure sourced?', by: { id: 'riley', name: 'Riley' }, at: '2026-11-10T10:00:00Z', replies: [], resolved: false };

// A reader inside a dialog hands the panel that dialog's element, as ReportDocument does.
function BriefWithNotes({ onClose = vi.fn(), onDialogClose = vi.fn() }) {
  const body = useRef(null); const [open, setOpen] = useState(false); const [host, setHost] = useState(null);
  return <div className="app-shell"><Dialog label="The brief" wide onClose={onDialogClose}>
    <div ref={body}><button type="button" onClick={() => { setHost(body.current.closest('[role="dialog"]')); setOpen(true); }}>Notes</button></div>
    {open && <NotesPanel notes={[note]} overlay dialog={host} canNote me="alex" onClose={() => { setOpen(false); onClose(); }} onActivate={vi.fn()} onReply={vi.fn()} onResolve={vi.fn()} />}
  </Dialog></div>;
}

describe('Notes in a report read inside a dialog', () => {
  it('opens inside the dialog, where it can be seen and reached, not behind it at the top of the app', () => {
    render(<BriefWithNotes />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const dialog = screen.getByRole('dialog', { name: 'The brief' });
    const panel = within(dialog).getByRole('complementary', { name: 'Notes' });
    expect(panel).toHaveClass('is-overlay', 'in-dialog');
    expect(within(panel).getByText('Is this figure sourced?')).toBeInTheDocument();
    // Still at the top of the app frame when there is no dialog around the reader.
    cleanup();
    render(<div className="app-shell"><main><NotesPanel notes={[note]} overlay onClose={vi.fn()} onActivate={vi.fn()} /></main></div>);
    const loose = screen.getByRole('complementary', { name: 'Notes' });
    expect(loose).not.toHaveClass('in-dialog'); expect(loose.closest('main')).toBeNull();
  });
  it('closes on Escape before the dialog does', () => {
    const onClose = vi.fn(); const onDialogClose = vi.fn();
    render(<BriefWithNotes onClose={onClose} onDialogClose={onDialogClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Notes' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1); expect(onDialogClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
