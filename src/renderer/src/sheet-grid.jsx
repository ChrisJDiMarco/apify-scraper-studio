import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Filter } from 'lucide-react';
import { chipTone, columnLetter, selectionBounds } from '../../shared/sheet-model.js';

// A spreadsheet surface that behaves like the Google Sheets people review in: row 1 holds the headers,
// letters and row numbers frame the cells, and the keyboard does what Sheets does.
export const ROW_NUMBER_WIDTH = 54;
const LETTER_HEIGHT = 24;
const HEADER_HEIGHT = 34;
const OVERSCAN_ROWS = 10;
const OVERSCAN_PX = 320;
export const rowHeightFor = (wrap) => (wrap ? 78 : 30);

const isUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());

export function SheetGrid({
  columns, rowCount, getCell, isEdited, sheetRowNumber, selection, onSelect, editable = true, wrap = false, frozenColumns = 0,
  findMatches, activeMatch, sort, filters, onColumnMenu, onResizeColumn, onAutoFitColumn, onCommit, onClear, onCopy, onPaste,
  onUndo, onRedo, onFind, onOpenUrl, onContextMenu, emptyState, gridRef, label,
}) {
  const scrollRef = useRef(null);
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 900, height: 600 });
  const [editing, setEditing] = useState(null);
  const dragRef = useRef(null);
  const rowHeight = rowHeightFor(wrap);
  const headTotal = LETTER_HEIGHT + HEADER_HEIGHT;

  const offsets = useMemo(() => { const list = []; let x = 0; for (const column of columns) { list.push(x); x += column.width; } return { list, total: x }; }, [columns]);
  const frozen = Math.min(frozenColumns, columns.length);
  const frozenWidth = frozen ? offsets.list[frozen - 1] + columns[frozen - 1].width : 0;
  const totalWidth = ROW_NUMBER_WIDTH + offsets.total;
  const totalHeight = headTotal + rowCount * rowHeight;

  // Only rows and columns near the viewport are in the DOM, so ten thousand posts scroll like ten.
  const firstRow = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN_ROWS);
  const lastRow = Math.min(rowCount - 1, Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN_ROWS);
  const visibleColumns = useMemo(() => {
    const start = viewport.left + frozenWidth - OVERSCAN_PX; const end = viewport.left + viewport.width + OVERSCAN_PX; const result = [];
    for (let index = frozen; index < columns.length; index++) { const left = offsets.list[index]; if (left + columns[index].width >= start && left <= end) result.push(index); }
    return result;
  }, [viewport.left, viewport.width, frozen, frozenWidth, columns, offsets]);
  const leadSpacer = visibleColumns.length ? offsets.list[visibleColumns[0]] - (frozen ? frozenWidth : 0) : 0;

  useLayoutEffect(() => {
    const element = scrollRef.current; if (!element) return undefined;
    const measure = () => setViewport((current) => ({ ...current, width: element.clientWidth - ROW_NUMBER_WIDTH, height: element.clientHeight - headTotal }));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null; observer?.observe(element);
    return () => observer?.disconnect();
  }, [headTotal]);

  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; const element = scrollRef.current; if (element) setViewport((current) => ({ ...current, top: element.scrollTop, left: element.scrollLeft })); });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const active = selection?.active || null;
  const bounds = selectionBounds(selection);

  const cellRect = useCallback((row, column) => ({ left: ROW_NUMBER_WIDTH + offsets.list[column], top: headTotal + row * rowHeight, width: columns[column]?.width || 0, height: rowHeight }), [offsets, headTotal, rowHeight, columns]);

  // Keep the active cell in view, clear of the frozen header and columns.
  const reveal = useCallback((row, column) => {
    const element = scrollRef.current; if (!element || row < 0 || column < 0) return;
    const rect = cellRect(row, column);
    const viewTop = element.scrollTop; const viewBottom = viewTop + element.clientHeight - headTotal;
    const y = rect.top - headTotal;
    if (y < viewTop) element.scrollTop = y; else if (y + rowHeight > viewBottom) element.scrollTop = y + rowHeight - (element.clientHeight - headTotal);
    if (column >= frozen) {
      const x = rect.left - ROW_NUMBER_WIDTH - frozenWidth; const viewLeft = element.scrollLeft; const viewWidth = element.clientWidth - ROW_NUMBER_WIDTH - frozenWidth;
      if (x < viewLeft) element.scrollLeft = x; else if (x + rect.width > viewLeft + viewWidth) element.scrollLeft = x + rect.width - viewWidth;
    }
  }, [cellRect, headTotal, rowHeight, frozen, frozenWidth]);

  useEffect(() => { if (activeMatch) reveal(activeMatch.row, activeMatch.column); }, [activeMatch, reveal]);
  useEffect(() => { if (gridRef) gridRef.current = { focus: () => scrollRef.current?.focus({ preventScroll: true }), reveal, startEditing: (initial) => active && startEditing(active.row, active.column, initial) }; });

  function select(row, column, extend = false, extra = {}) {
    if (!rowCount || !columns.length) return;
    const clampedRow = Math.max(0, Math.min(rowCount - 1, row)); const clampedColumn = Math.max(0, Math.min(columns.length - 1, column));
    const point = { row: clampedRow, column: clampedColumn };
    onSelect(extend && selection ? { ...selection, focus: point, header: false, ...extra } : { anchor: point, focus: point, active: point, header: false, ...extra });
    reveal(clampedRow, clampedColumn);
  }

  // The ref is the source of truth so a blur that lands after Enter or Escape can't commit twice.
  const editingRef = useRef(null);
  function startEditing(row, column, initial) {
    if (!editable || row < 0 || column < 0 || row >= rowCount) return;
    const next = { row, column, value: initial ?? String(getCell(row, column) ?? ''), original: String(getCell(row, column) ?? '') };
    editingRef.current = next; setEditing(next);
  }
  function updateEditing(value) { if (!editingRef.current) return; editingRef.current = { ...editingRef.current, value }; setEditing(editingRef.current); }
  function cancelEdit() { editingRef.current = null; setEditing(null); requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); }
  function commitEdit(move = null) {
    const current = editingRef.current; if (!current) return;
    editingRef.current = null; setEditing(null);
    if (current.value !== current.original) onCommit(current.row, current.column, current.value);
    if (move) select(current.row + move.row, current.column + move.column);
    requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
  }

  function onKeyDown(event) {
    if (editing) return; // the editor handles its own keys
    const meta = event.metaKey || event.ctrlKey; const key = event.key;
    if (meta && key.toLowerCase() === 'f') { event.preventDefault(); onFind?.(); return; }
    if (meta && key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo?.(); else onUndo?.(); return; }
    if (meta && key.toLowerCase() === 'y') { event.preventDefault(); onRedo?.(); return; }
    if (meta && key.toLowerCase() === 'a') { event.preventDefault(); if (rowCount && columns.length) onSelect({ anchor: { row: 0, column: 0 }, focus: { row: rowCount - 1, column: columns.length - 1 }, active: active || { row: 0, column: 0 }, header: true }); return; }
    if (!active) { if (/^Arrow|^Tab$|^Enter$/.test(key) && rowCount) { event.preventDefault(); select(0, 0); } return; }
    const page = Math.max(1, Math.floor(viewport.height / rowHeight) - 1);
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-page, 0], PageDown: [page, 0] };
    if (moves[key]) {
      event.preventDefault(); const [dRow, dColumn] = moves[key]; const from = event.shiftKey ? selection.focus : active;
      const row = meta && dRow ? (dRow < 0 ? 0 : rowCount - 1) : from.row + dRow; const column = meta && dColumn ? (dColumn < 0 ? 0 : columns.length - 1) : from.column + dColumn;
      select(row, column, event.shiftKey); return;
    }
    if (key === 'Home' || key === 'End') { event.preventDefault(); const column = key === 'Home' ? 0 : columns.length - 1; select(meta ? (key === 'Home' ? 0 : rowCount - 1) : active.row, column, event.shiftKey); return; }
    if (key === 'Tab') { event.preventDefault(); select(active.row, active.column + (event.shiftKey ? -1 : 1)); return; }
    if (key === 'Enter' || key === 'F2') { event.preventDefault(); if (event.shiftKey && key === 'Enter') select(active.row - 1, active.column); else startEditing(active.row, active.column); return; }
    if (key === 'Escape') { if (bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right)) { event.preventDefault(); select(active.row, active.column); } return; }
    if ((key === 'Backspace' || key === 'Delete') && editable) { event.preventDefault(); onClear?.(bounds); return; }
    if (editable && key.length === 1 && !meta && !event.altKey) { event.preventDefault(); startEditing(active.row, active.column, key); }
  }

  function pointFromEvent(event) {
    const element = scrollRef.current; const box = element.getBoundingClientRect();
    const x = event.clientX - box.left; const y = event.clientY - box.top;
    const row = Math.floor((y + element.scrollTop - headTotal) / rowHeight);
    let contentX = x - ROW_NUMBER_WIDTH; if (contentX >= frozenWidth) contentX += element.scrollLeft;
    let column = columns.length - 1; for (let index = 0; index < columns.length; index++) if (contentX < offsets.list[index] + columns[index].width) { column = index; break; }
    return { row: Math.max(0, Math.min(rowCount - 1, row)), column: Math.max(0, column) };
  }

  function onCellMouseDown(event, row, column) {
    if (event.button !== 0) return;
    if ((event.metaKey || event.ctrlKey) && isUrl(getCell(row, column))) { event.preventDefault(); onOpenUrl?.(String(getCell(row, column)).trim()); return; }
    if (editing) commitEdit();
    event.preventDefault(); scrollRef.current?.focus({ preventScroll: true });
    select(row, column, event.shiftKey);
    dragRef.current = { kind: 'cells' };
  }
  useEffect(() => {
    function onMove(event) {
      const drag = dragRef.current; if (!drag || !scrollRef.current || !selection) return;
      if (drag.kind === 'resize') { const width = Math.max(48, Math.min(900, drag.width + event.clientX - drag.x)); onResizeColumn?.(drag.column, width); return; }
      const point = pointFromEvent(event);
      if (drag.kind === 'cells' && (point.row !== selection.focus.row || point.column !== selection.focus.column)) onSelect({ ...selection, focus: point });
    }
    function onUp() { dragRef.current = null; document.body.classList.remove('sheet-resizing'); }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  });

  function selectColumn(event, column) {
    event.preventDefault(); scrollRef.current?.focus({ preventScroll: true }); if (!rowCount) return;
    const anchorColumn = event.shiftKey && selection ? selection.anchor.column : column;
    onSelect({ anchor: { row: 0, column: anchorColumn }, focus: { row: rowCount - 1, column }, active: { row: 0, column: anchorColumn }, header: true });
  }
  function selectRow(event, row) {
    event.preventDefault(); scrollRef.current?.focus({ preventScroll: true });
    const anchorRow = event.shiftKey && selection ? selection.anchor.row : row;
    onSelect({ anchor: { row: anchorRow, column: 0 }, focus: { row, column: columns.length - 1 }, active: { row: anchorRow, column: 0 }, header: false });
  }
  function startResize(event, column) {
    event.preventDefault(); event.stopPropagation();
    dragRef.current = { kind: 'resize', column, x: event.clientX, width: columns[column].width };
    document.body.classList.add('sheet-resizing');
  }

  const inSelection = (row, column) => bounds && row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right;
  const columnSelected = (column) => bounds && column >= bounds.left && column <= bounds.right;
  const rowSelected = (row) => bounds && row >= bounds.top && row <= bounds.bottom;

  function renderCell(row, column, sticky) {
    const spec = columns[column]; const value = getCell(row, column); const text = value === undefined || value === null ? '' : String(value);
    const classes = ['sheet-cell', `t-${spec.type}`];
    if (sticky) classes.push('frozen'); if (column === frozen - 1) classes.push('frozen-edge');
    if (inSelection(row, column)) classes.push('in-range');
    if (findMatches?.has(`${row}:${column}`)) classes.push(activeMatch?.row === row && activeMatch?.column === column ? 'find-active' : 'find-hit');
    if (isEdited?.(row, column)) classes.push('edited');
    const style = { width: spec.width, ...(sticky ? { left: ROW_NUMBER_WIDTH + offsets.list[column] } : null) };
    const isActive = active && active.row === row && active.column === column;
    if (isActive && sticky) classes.push('is-active'); // frozen cells don't scroll, so they draw their own outline
    return <div key={column} id={isActive ? 'sheet-active-cell' : undefined} role="gridcell" aria-colindex={column + 1} aria-selected={inSelection(row, column) || undefined}
      className={classes.join(' ')} style={style} onMouseDown={(event) => onCellMouseDown(event, row, column)} onDoubleClick={() => startEditing(row, column)}
      onContextMenu={(event) => { event.preventDefault(); if (!inSelection(row, column)) select(row, column); onContextMenu?.({ row, column, x: event.clientX, y: event.clientY }); }}>
      {spec.type === 'url' && isUrl(text) ? <span className="sheet-link" title={`${text}\n⌘-click to open`}>{text.replace(/^https?:\/\/(www\.)?/i, '')}</span> : spec.chip && text ? <span className="sheet-chip" data-tone={chipTone(text)}>{text}</span> : <span className="sheet-text">{text}</span>}
    </div>;
  }

  const rows = [];
  for (let row = firstRow; row <= lastRow; row++) {
    rows.push(<div key={row} role="row" aria-rowindex={row + 2} className={`sheet-row${rowSelected(row) ? ' row-in-range' : ''}`} style={{ top: headTotal + row * rowHeight, height: rowHeight, width: totalWidth }}>
      <div role="rowheader" className={`sheet-rownum${rowSelected(row) ? ' selected' : ''}`} onMouseDown={(event) => selectRow(event, row)}>{sheetRowNumber(row)}</div>
      {Array.from({ length: frozen }, (_, column) => renderCell(row, column, true))}
      {leadSpacer > 0 && <div className="sheet-spacer" style={{ width: leadSpacer }} aria-hidden="true" />}
      {visibleColumns.map((column) => renderCell(row, column, false))}
    </div>);
  }

  const headerCell = (column, sticky) => {
    const spec = columns[column]; const sorted = sort?.column === spec.index; const filtered = Boolean(filters?.[spec.key]);
    return <div key={column} role="columnheader" aria-colindex={column + 1} aria-sort={sorted ? (sort.direction === 'desc' ? 'descending' : 'ascending') : undefined}
      className={`sheet-header-cell t-${spec.type}${sticky ? ' frozen' : ''}${column === frozen - 1 ? ' frozen-edge' : ''}${columnSelected(column) ? ' selected' : ''}`}
      style={{ width: spec.width, ...(sticky ? { left: ROW_NUMBER_WIDTH + offsets.list[column] } : null) }}
      onMouseDown={(event) => { if (!event.target.closest('button')) selectColumn(event, column); }} title={spec.label}>
      <span className="sheet-header-label">{spec.label || ' '}</span>
      {sorted && (sort.direction === 'desc' ? <ArrowDown className="sheet-header-mark" size={12} aria-label="Sorted Z to A" /> : <ArrowUp className="sheet-header-mark" size={12} aria-label="Sorted A to Z" />)}
      {filtered && <Filter className="sheet-header-mark on" size={12} aria-label="Filtered" />}
      <button type="button" className={`sheet-header-menu${filtered || sorted ? ' on' : ''}`} aria-label={`Sort and filter ${spec.label || columnLetter(spec.index)}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => onColumnMenu?.(column, event.currentTarget.getBoundingClientRect())}><ChevronDown size={13} aria-hidden="true" /></button>
    </div>;
  };
  const letterCell = (column, sticky) => {
    const spec = columns[column];
    return <div key={column} className={`sheet-letter${sticky ? ' frozen' : ''}${column === frozen - 1 ? ' frozen-edge' : ''}${columnSelected(column) ? ' selected' : ''}`} style={{ width: spec.width, ...(sticky ? { left: ROW_NUMBER_WIDTH + offsets.list[column] } : null) }} onMouseDown={(event) => selectColumn(event, column)}>
      {columnLetter(spec.index)}
      <span className="sheet-resize" role="separator" aria-orientation="vertical" aria-label={`Resize column ${columnLetter(spec.index)}`} onMouseDown={(event) => startResize(event, column)} onDoubleClick={(event) => { event.stopPropagation(); onAutoFitColumn?.(column); }} />
    </div>;
  };

  // The selection glides between cells instead of jumping (styles in sheets.css).
  let rangeBox = null; let activeBox = null;
  if (bounds && rowCount) {
    const a = cellRect(bounds.top, bounds.left); const b = cellRect(bounds.bottom, bounds.right);
    rangeBox = { transform: `translate(${a.left}px, ${a.top}px)`, width: b.left + b.width - a.left, height: b.top + b.height - a.top };
  }
  if (active && rowCount && active.row < rowCount && active.column >= frozen) { const rect = cellRect(active.row, active.column); activeBox = { transform: `translate(${rect.left - 1}px, ${rect.top - 1}px)`, width: rect.width + 1, height: rect.height + 1 }; }
  const multi = bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right);
  const editorRect = editing ? cellRect(editing.row, editing.column) : null;

  return <div className={`sheet-grid${wrap ? ' wrap' : ''}`} ref={scrollRef} role="grid" aria-label={label} aria-rowcount={rowCount + 1} aria-colcount={columns.length} aria-multiselectable="true"
    aria-activedescendant={active ? 'sheet-active-cell' : undefined} tabIndex={0} onKeyDown={onKeyDown} onScroll={onScroll}
    onCopy={(event) => { if (editing || !bounds) return; event.preventDefault(); const data = onCopy?.(bounds, selection); if (data) { event.clipboardData.setData('text/plain', data.text); event.clipboardData.setData('text/html', data.html); } }}
    onCut={(event) => { if (editing || !bounds) return; event.preventDefault(); const data = onCopy?.(bounds, selection); if (data) { event.clipboardData.setData('text/plain', data.text); event.clipboardData.setData('text/html', data.html); } if (editable) onClear?.(bounds); }}
    onPaste={(event) => { if (editing || !active || !editable) return; event.preventDefault(); onPaste?.(event.clipboardData.getData('text/plain'), active); }}>
    <div className="sheet-canvas" style={{ width: totalWidth, height: Math.max(totalHeight, headTotal + 1) }}>
      <div className="sheet-head" role="rowgroup" style={{ width: totalWidth }}>
        <div className="sheet-letters" style={{ width: totalWidth }}>
          <div className="sheet-corner" aria-hidden="true" onMouseDown={(event) => { event.preventDefault(); scrollRef.current?.focus({ preventScroll: true }); if (rowCount && columns.length) onSelect({ anchor: { row: 0, column: 0 }, focus: { row: rowCount - 1, column: columns.length - 1 }, active: { row: 0, column: 0 }, header: true }); }} />
          {Array.from({ length: frozen }, (_, column) => letterCell(column, true))}
          {leadSpacer > 0 && <div className="sheet-spacer" style={{ width: leadSpacer }} aria-hidden="true" />}
          {visibleColumns.map((column) => letterCell(column, false))}
        </div>
        <div className="sheet-header-row" role="row" aria-rowindex={1} style={{ width: totalWidth }}>
          <div role="rowheader" className="sheet-rownum header">1</div>
          {Array.from({ length: frozen }, (_, column) => headerCell(column, true))}
          {leadSpacer > 0 && <div className="sheet-spacer" style={{ width: leadSpacer }} aria-hidden="true" />}
          {visibleColumns.map((column) => headerCell(column, false))}
        </div>
      </div>
      <div className="sheet-body" role="rowgroup">{rows}</div>
      {rangeBox && multi && <div className="sheet-range" style={rangeBox} aria-hidden="true" />}
      {activeBox && <div className="sheet-active" style={activeBox} aria-hidden="true" />}
      {editing && editorRect && <textarea className="sheet-editor" aria-label={`Edit ${columns[editing.column]?.label || 'cell'}`} value={editing.value}
        ref={(element) => { if (element && document.activeElement !== element) element.focus({ preventScroll: true }); }}
        style={{ left: editorRect.left - 1, top: editorRect.top - 1, width: Math.max(editorRect.width + 2, 220), minHeight: editorRect.height + 2 }}
        onChange={(event) => updateEditing(event.target.value)}
        onFocus={(event) => { const length = event.target.value.length; event.target.setSelectionRange(length, length); }}
        onBlur={() => commitEdit()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
          else if (event.key === 'Enter' && !event.altKey && !event.shiftKey) { event.preventDefault(); commitEdit({ row: 1, column: 0 }); }
          else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); commitEdit({ row: -1, column: 0 }); }
          else if (event.key === 'Enter' && event.altKey) { event.preventDefault(); const target = event.target; const at = target.selectionStart; const next = `${target.value.slice(0, at)}\n${target.value.slice(target.selectionEnd)}`; updateEditing(next); requestAnimationFrame(() => target.setSelectionRange(at + 1, at + 1)); }
          else if (event.key === 'Tab') { event.preventDefault(); commitEdit({ row: 0, column: event.shiftKey ? -1 : 1 }); }
        }} />}
    </div>
    {!rowCount && emptyState && <div className="sheet-empty" style={{ top: headTotal }}>{emptyState}</div>}
  </div>;
}
