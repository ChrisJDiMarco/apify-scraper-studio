import React from 'react';
import { MessageSquareText } from 'lucide-react';
import { can } from '../viewer.js';
import '../report-editor.css';

// Open notes on a report row (Reports, the Library): contentStudio.noteCounts { [assetId]: { open, total } }, summed
// over the documents a row holds (a trend's report and toolkit share one row).
export function noteCountFor(counts, ids) {
  let open = 0; let total = 0;
  for (const id of ids) { const row = id && counts && typeof counts === 'object' ? counts[id] : null; open += Number(row?.open) || 0; total += Number(row?.total) || 0; }
  return { open, total };
}

export function NoteCount({ counts, ids = [] }) {
  const { open } = noteCountFor(counts, ids.filter(Boolean));
  if (!open) return null;
  return <span className="rd-note-count" title={`${open} open ${open === 1 ? 'note' : 'notes'}`}><MessageSquareText size={11} aria-hidden="true" />{open}<span className="sr-only"> open {open === 1 ? 'note' : 'notes'}</span></span>;
}

// Whether this studio has the live report editor (the report-doc methods) for this person.
export const liveDocsOn = (api, viewer) => typeof api?.openReportDoc === 'function' && can(viewer, 'openReportDoc');
