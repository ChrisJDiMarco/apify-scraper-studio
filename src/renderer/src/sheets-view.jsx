import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Columns3, Download, EyeOff, FileSpreadsheet, Filter, FilterX, Link2, List, LoaderCircle, Maximize2, Minimize2, MoveHorizontal, Pencil, Redo2, Search, Sheet, Snowflake, Trash2, Undo2, Upload, WrapText, X } from 'lucide-react';
import { SheetGrid } from './sheet-grid.jsx';
import { cellAddress, columnKeys, columnLetter, defaultColumnWidth, distinctValues, formatStat, inferColumnType, isChipColumn, matchesFilter, parseTSV, prettyCell, selectionBounds, selectionStats, sortRowIndexes, toCSV, toHTMLTable, toTSV } from '../../shared/sheet-model.js';
import { number } from './ui.jsx';
import './sheets.css';

const TAB_TINT = { x: 'x', twitter: 'x', linkedin: 'linkedin', reddit: 'reddit' };
const STATUS_COPY = {
  failed: 'This run stopped before it finished. The posts it collected are all here; themes and tags fill in after a retry.',
  partial: 'Some reports in this run need attention. Everything that finished is here.',
  'awaiting-review': 'Themes are waiting for your OK on the Trend board. Tags and theme totals fill in once you continue the run.',
  running: 'This run is still working. New rows and tags appear as each step finishes.',
  queued: 'This run is queued. Posts appear here as soon as collection finishes.',
};

const prefs = {
  read(key, fallback) { try { const value = window.localStorage.getItem(`sheets:${key}`); return value === null ? fallback : JSON.parse(value); } catch (_) { return fallback; } },
  write(key, value) { try { window.localStorage.setItem(`sheets:${key}`, JSON.stringify(value)); } catch (_) { /* Preferences are a convenience only. */ } },
};

function useOutside(ref, onClose, open) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (ref.current && !ref.current.contains(event.target)) onClose(); };
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', onDown, true); window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open, onClose, ref]);
}

// Menus open where they were asked for and keep their arrow-key focus inside.
function Popover({ anchor, onClose, children, className = '', label, width = 240 }) {
  const ref = useRef(null);
  useOutside(ref, onClose, true);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect(); const height = box?.height || 0;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
    const below = anchor.bottom + 6; const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPosition({ left, top });
  }, [anchor, width]);
  useEffect(() => { requestAnimationFrame(() => ref.current?.querySelector('input, [role="menuitem"], [role="menuitemcheckbox"], button')?.focus()); }, []);
  function onKeyDown(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName === 'INPUT') return;
    const items = [...ref.current.querySelectorAll('[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)')]; if (!items.length) return;
    event.preventDefault(); const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  return <div ref={ref} className={`sheet-popover ${className}`} role="menu" aria-label={label} style={{ width, left: position?.left ?? anchor.left, top: position?.top ?? anchor.bottom + 6, visibility: position ? 'visible' : 'hidden' }} onKeyDown={onKeyDown}>{children}</div>;
}

const MenuItem = ({ icon: Icon, children, onClick, disabled, danger, hint }) => <button type="button" role="menuitem" className={`sheet-menu-item${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>{Icon ? <Icon size={15} aria-hidden="true" /> : <span className="sheet-menu-gap" />}<span>{children}</span>{hint && <kbd>{hint}</kbd>}</button>;

function FilterPanel({ column, values, current, onApply, onClose }) {
  const [query, setQuery] = useState('');
  const [contains, setContains] = useState(current?.contains || '');
  const [chosen, setChosen] = useState(() => new Set(current?.values || values.map((entry) => entry.value)));
  const shown = values.filter((entry) => entry.value.toLowerCase().includes(query.toLowerCase()));
  const toggle = (value) => setChosen((set) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; });
  function apply() {
    const all = chosen.size === values.length; const filter = { ...(all ? {} : { values: [...chosen] }), ...(contains.trim() ? { contains: contains.trim() } : {}) };
    onApply(Object.keys(filter).length ? filter : null); onClose();
  }
  return <div className="sheet-filter" onKeyDown={(event) => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); apply(); } }}>
    <p className="sheet-filter-title">Filter <strong>{column.label || columnLetter(column.index)}</strong></p>
    <label className="sheet-filter-field"><span>Text contains</span><input value={contains} onChange={(event) => setContains(event.target.value)} placeholder="Any text" /></label>
    <div className="sheet-filter-values">
      <div className="sheet-filter-search"><Search size={13} aria-hidden="true" /><input aria-label="Search values" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search values" /></div>
      <div className="sheet-filter-actions"><button type="button" onClick={() => setChosen(new Set(values.map((entry) => entry.value)))}>Select all</button><button type="button" onClick={() => setChosen(new Set())}>Clear</button></div>
      <div className="sheet-filter-list" role="group" aria-label="Values">
        {shown.map((entry) => <label key={entry.value} className="sheet-filter-option"><input type="checkbox" checked={chosen.has(entry.value)} onChange={() => toggle(entry.value)} /><span className={entry.value ? '' : 'blank'}>{entry.value || '(Blanks)'}</span><small>{number(entry.count)}</small></label>)}
        {!shown.length && <p className="sheet-filter-none">No values match.</p>}
      </div>
    </div>
    <div className="sheet-filter-foot"><button type="button" className="ghost" onClick={() => { onApply(null); onClose(); }}>Remove filter</button><button type="button" onClick={apply} disabled={!chosen.size && !contains.trim()}>Apply</button></div>
  </div>;
}

function downloadText(fileName, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSafe = (value) => String(value || 'sheet').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sheet';
const relative = (iso) => { const time = Date.parse(iso || ''); if (!Number.isFinite(time)) return ''; return new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function SheetsView({ api, state, initialWorkbookId, workbookRequestKey, onNavigate }) {
  const [workbooks, setWorkbooks] = useState(null);
  const [listError, setListError] = useState('');
  const [workbookId, setWorkbookId] = useState(initialWorkbookId || prefs.read('lastWorkbook', ''));
  const [workbook, setWorkbook] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [view, setView] = useState({});
  const [edits, setEdits] = useState({ version: 1, sheets: {} });
  const [saveState, setSaveState] = useState('saved');
  const [history, setHistory] = useState({ undo: [], redo: [] });
  const [menu, setMenu] = useState(null);
  const [find, setFind] = useState({ open: false, query: '', index: 0 });
  const [googleUrl, setGoogleUrl] = useState('');
  const [pending, setPending] = useState('');
  const [formulaDraft, setFormulaDraft] = useState(null);
  const [formulaExpanded, setFormulaExpanded] = useState(false);
  const [toast, setToast] = useState(null);
  const gridRef = useRef(null);
  const findRef = useRef(null);
  const saveTimer = useRef(0);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const editsOwnerRef = useRef(''); // the workbook the edits in memory belong to
  const historyRef = useRef(history);
  historyRef.current = history;
  const toastTimer = useRef(0);
  // Feedback lands beside the grid and leaves on its own, so the sheet never shifts under the pointer.
  const say = useCallback((message) => {
    clearTimeout(toastTimer.current); setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), message.error ? 9000 : 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const researchKey = (state?.contentStudio?.researchRuns || []).map((run) => `${run.id}:${run.updatedAt || ''}:${run.status}:${run.stage}`).join('|');
  const refreshList = useCallback(async () => {
    try { const list = await api.listWorkbooks(); setWorkbooks(list || []); setListError(''); return list || []; }
    catch (error) { setListError(error.message || String(error)); setWorkbooks((current) => current || []); return []; }
  }, [api]);
  useEffect(() => { refreshList(); }, [refreshList, researchKey]);
  useEffect(() => { if (initialWorkbookId) setWorkbookId(initialWorkbookId); }, [initialWorkbookId, workbookRequestKey]);

  // Open the requested workbook, else the last one, else the newest.
  useEffect(() => {
    if (!workbooks?.length) return;
    if (!workbooks.some((entry) => entry.id === workbookId)) setWorkbookId(workbooks[0].id);
  }, [workbooks, workbookId]);

  const listing = workbooks?.find((entry) => entry.id === workbookId);
  const listingVersion = listing ? `${listing.updatedAt}|${listing.status || ''}|${listing.stage || ''}|${listing.rowCount}` : '';

  // Pending edits are written to the workbook they were made in, before anything else replaces them.
  const flushSave = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current); saveTimer.current = 0;
    const targetId = editsOwnerRef.current; const snapshot = editsRef.current;
    if (!targetId) return;
    setSaveState('saving');
    api.saveWorkbookEdits({ workbookId: targetId, edits: snapshot }).then(() => setSaveState('saved')).catch((error) => { setSaveState('error'); say({ error: error.message || String(error) }); });
  }, [api, say]);

  useEffect(() => {
    if (!workbookId || !listing) return undefined;
    let cancelled = false; setLoading(true); setLoadError('');
    api.readWorkbook({ workbookId }).then((next) => {
      if (cancelled) return;
      const sameWorkbook = editsOwnerRef.current === next.id;
      if (!sameWorkbook) { flushSave(); setHistory({ undo: [], redo: [] }); }
      // A refresh of the open workbook keeps unsaved local edits; a different workbook brings its own.
      if (!sameWorkbook || !saveTimer.current) setEdits(next.edits?.sheets ? next.edits : { version: 1, sheets: {} });
      editsOwnerRef.current = next.id; setWorkbook(next); if (!sameWorkbook) setSaveState('saved');
      prefs.write('lastWorkbook', next.id);
      setSheetId((current) => {
        if (sameWorkbook && next.sheets.some((sheet) => sheet.id === current)) return current;
        const remembered = prefs.read(`tab:${next.id}`, '');
        return next.sheets.find((sheet) => sheet.id === remembered)?.id || next.sheets.find((sheet) => sheet.rows.length)?.id || next.sheets[0]?.id || '';
      });
    }).catch((error) => { if (!cancelled) setLoadError(error.message || String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, workbookId, listingVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => flushSave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = workbook?.sheets.find((entry) => entry.id === sheetId) || workbook?.sheets[0] || null;
  const viewKey = workbook && sheet ? `${workbook.id}:${sheet.id}` : '';
  const sheetView = view[viewKey] || {};
  const patchView = (patch) => setView((current) => ({ ...current, [viewKey]: { ...(current[viewKey] || {}), ...(typeof patch === 'function' ? patch(current[viewKey] || {}) : patch) } }));
  useEffect(() => { if (workbook && sheet) prefs.write(`tab:${workbook.id}`, sheet.id); }, [workbook, sheet]);

  // Column model: type is detected from the data, widths remembered per viewer.
  const keys = useMemo(() => (sheet ? columnKeys(sheet.columns) : []), [sheet]);
  const sheetEdits = (sheet && edits.sheets?.[sheet.id]) || null;
  const rawCell = useCallback((rowIndex, columnIndex) => {
    const key = sheet.rowKeys?.[rowIndex] ?? `r${rowIndex + 2}`; const edited = sheetEdits?.[key]?.[keys[columnIndex]];
    return edited !== undefined ? edited : sheet.rows[rowIndex]?.[columnIndex] ?? '';
  }, [sheet, sheetEdits, keys]);
  const remembered = useMemo(() => (viewKey ? { widths: prefs.read(`widths:${viewKey}`, {}), hidden: prefs.read(`hidden:${viewKey}`, []), frozen: prefs.read(`frozen:${viewKey}`, null) } : { widths: {}, hidden: [], frozen: null }), [viewKey]);
  const hidden = sheetView.hidden ?? remembered.hidden;
  const wrap = sheetView.wrap ?? prefs.read('wrap', false);
  const columnShapes = useMemo(() => (sheet ? sheet.columns.map((label, index) => { const values = sheet.rows.slice(0, 400).map((row) => row[index]); const type = inferColumnType(label, values); return { type, chip: isChipColumn(label, type, values), width: defaultColumnWidth(label, type, values) }; }) : []), [sheet]);
  const allColumns = useMemo(() => (sheet ? sheet.columns.map((label, index) => ({ index, key: keys[index], label, type: columnShapes[index].type, chip: columnShapes[index].chip, width: sheetView.widths?.[keys[index]] ?? remembered.widths[keys[index]] ?? columnShapes[index].width })) : []), [sheet, keys, columnShapes, sheetView.widths, remembered]);
  const columns = useMemo(() => allColumns.filter((column) => !hidden.includes(column.key)), [allColumns, hidden]);
  const frozenColumns = sheetView.frozen ?? remembered.frozen ?? sheet?.frozenColumns ?? 0;

  const filters = sheetView.filters || {};
  const sort = sheetView.sort || null;
  const displayRows = useMemo(() => {
    if (!sheet) return [];
    let indexes = sheet.rows.map((_, index) => index);
    const active = Object.entries(filters).filter(([, filter]) => filter);
    if (active.length) {
      const positions = active.map(([key, filter]) => [allColumns.findIndex((column) => column.key === key), filter]).filter(([index]) => index >= 0);
      indexes = indexes.filter((rowIndex) => positions.every(([columnIndex, filter]) => matchesFilter(rawCell(rowIndex, columnIndex), filter)));
    }
    if (sort && allColumns[sort.column]) indexes = sortRowIndexes(indexes, rawCell, sort.column, allColumns[sort.column].type, sort.direction);
    return indexes;
  }, [sheet, filters, sort, rawCell, allColumns]);
  const getCell = useCallback((viewRow, viewColumn) => rawCell(displayRows[viewRow], columns[viewColumn].index), [rawCell, displayRows, columns]);
  const isEdited = useCallback((viewRow, viewColumn) => { if (!sheetEdits) return false; const key = sheet.rowKeys?.[displayRows[viewRow]] ?? `r${displayRows[viewRow] + 2}`; return sheetEdits[key]?.[columns[viewColumn].key] !== undefined; }, [sheetEdits, sheet, displayRows, columns]);
  const sheetRowNumber = useCallback((viewRow) => displayRows[viewRow] + 2, [displayRows]);

  const selection = sheetView.selection || null;
  const setSelection = (next) => { patchView({ selection: next }); setFormulaDraft(null); };
  const bounds = selectionBounds(selection);
  const active = selection?.active && selection.active.row < displayRows.length && selection.active.column < columns.length ? selection.active : null;
  const activeValue = active ? String(getCell(active.row, active.column) ?? '') : '';

  // Find highlights every match in the visible sheet and steps through them in reading order.
  const matches = useMemo(() => {
    const query = find.query.trim().toLowerCase(); if (!find.open || !query || !sheet) return [];
    const result = [];
    for (let row = 0; row < displayRows.length && result.length < 5000; row++) for (let column = 0; column < columns.length; column++) if (String(getCell(row, column)).toLowerCase().includes(query)) result.push({ row, column });
    return result;
  }, [find.open, find.query, displayRows, columns, getCell, sheet]);
  const matchSet = useMemo(() => new Set(matches.map((match) => `${match.row}:${match.column}`)), [matches]);
  const activeMatch = matches.length ? matches[Math.min(find.index, matches.length - 1)] : null;
  useEffect(() => { if (activeMatch) patchView({ selection: { anchor: activeMatch, focus: activeMatch, active: activeMatch, header: false } }); }, [activeMatch?.row, activeMatch?.column]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    if (!bounds || (bounds.top === bounds.bottom && bounds.left === bounds.right)) return null;
    const values = []; let cells = 0;
    for (let row = bounds.top; row <= bounds.bottom; row++) for (let column = bounds.left; column <= bounds.right; column++) { values.push(getCell(row, column)); if (++cells > 250000) break; }
    return selectionStats(values);
  }, [bounds?.top, bounds?.bottom, bounds?.left, bounds?.right, getCell]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyChanges(changes, label) {
    if (!changes.length || !sheet) return;
    setEdits((current) => {
      const next = { version: 1, sheets: { ...current.sheets, [sheet.id]: { ...(current.sheets[sheet.id] || {}) } } };
      for (const change of changes) {
        const rowEdits = { ...(next.sheets[sheet.id][change.rowKey] || {}) };
        if (change.after === change.original) delete rowEdits[change.columnKey]; else rowEdits[change.columnKey] = change.after;
        if (Object.keys(rowEdits).length) next.sheets[sheet.id][change.rowKey] = rowEdits; else delete next.sheets[sheet.id][change.rowKey];
      }
      return next;
    });
    setHistory((current) => ({ undo: [...current.undo.slice(-199), { sheetId: sheet.id, label, changes }], redo: [] }));
    scheduleSave();
  }
  function scheduleSave() {
    setSaveState('pending'); clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 600);
  }
  const changeFor = (rowIndex, columnIndex, after) => ({ rowKey: sheet.rowKeys?.[rowIndex] ?? `r${rowIndex + 2}`, columnKey: keys[columnIndex], before: String(rawCell(rowIndex, columnIndex) ?? ''), original: String(sheet.rows[rowIndex]?.[columnIndex] ?? ''), after });
  function commitCell(viewRow, viewColumn, value) { applyChanges([changeFor(displayRows[viewRow], columns[viewColumn].index, value)], 'Edit'); }
  function clearCells(range) {
    if (!range) return; const changes = [];
    for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) { const change = changeFor(displayRows[row], columns[column].index, ''); if (change.before !== '') changes.push(change); }
    applyChanges(changes, 'Clear');
  }
  function pasteAt(text, at) {
    const matrix = parseTSV(text); if (!matrix.length) return; const changes = [];
    matrix.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
      const row = at.row + rowOffset; const column = at.column + columnOffset;
      if (row < displayRows.length && column < columns.length) { const change = changeFor(displayRows[row], columns[column].index, value); if (change.before !== value) changes.push(change); }
    }));
    applyChanges(changes, 'Paste');
    const end = { row: Math.min(displayRows.length - 1, at.row + matrix.length - 1), column: Math.min(columns.length - 1, at.column + Math.max(...matrix.map((row) => row.length)) - 1) };
    setSelection({ anchor: at, focus: end, active: at, header: false });
  }
  function step(direction) {
    const current = historyRef.current; const source = direction === 'undo' ? current.undo : current.redo; const entry = source[source.length - 1];
    if (!entry) return;
    setEdits((value) => {
      const next = { version: 1, sheets: { ...value.sheets, [entry.sheetId]: { ...(value.sheets[entry.sheetId] || {}) } } };
      for (const change of entry.changes) {
        const target = direction === 'undo' ? change.before : change.after; const rowEdits = { ...(next.sheets[entry.sheetId][change.rowKey] || {}) };
        if (target === change.original) delete rowEdits[change.columnKey]; else rowEdits[change.columnKey] = target;
        if (Object.keys(rowEdits).length) next.sheets[entry.sheetId][change.rowKey] = rowEdits; else delete next.sheets[entry.sheetId][change.rowKey];
      }
      return next;
    });
    const next = direction === 'undo' ? { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] } : { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) };
    historyRef.current = next; setHistory(next);
    if (entry.sheetId !== sheet?.id) setSheetId(entry.sheetId);
    say({ notice: `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label.toLowerCase()} · ${number(entry.changes.length)} ${entry.changes.length === 1 ? 'cell' : 'cells'}` });
    scheduleSave();
  }

  function matrixFor(range, includeHeader) {
    const matrix = [];
    if (includeHeader) matrix.push(columns.slice(range.left, range.right + 1).map((column) => column.label));
    for (let row = range.top; row <= range.bottom; row++) { const values = []; for (let column = range.left; column <= range.right; column++) values.push(String(getCell(row, column) ?? '')); matrix.push(values); }
    return matrix;
  }
  function copyRange(range, current) { const matrix = matrixFor(range, current?.header); say({ notice: `Copied ${number(matrix.length * (range.right - range.left + 1))} cells · paste straight into Google Sheets` }); return { text: toTSV(matrix), html: toHTMLTable(matrix) }; }
  function sheetMatrix(onlyShown = false) {
    const rows = onlyShown ? displayRows : sheet.rows.map((_, index) => index); const visible = onlyShown ? columns : allColumns;
    return [visible.map((column) => column.label), ...rows.map((rowIndex) => visible.map((column) => String(rawCell(rowIndex, column.index) ?? '')))];
  }
  async function copySheet() {
    try { await navigator.clipboard.writeText(toTSV(sheetMatrix())); say({ notice: `Copied “${sheet.name}” (${number(sheet.rows.length)} rows). Paste into cell A1 of a Google Sheet.` }); }
    catch (_) { say({ error: 'The clipboard is unavailable right now. Download the tab as CSV instead.' }); }
    setMenu(null);
  }
  function downloadSheet(onlyShown) { downloadText(`${fileSafe(workbook.name)} - ${fileSafe(sheet.name)}.csv`, toCSV(sheetMatrix(onlyShown)), 'text/csv;charset=utf-8'); setMenu(null); }

  function setColumnWidth(viewColumn, width) { const key = columns[viewColumn].key; patchView((current) => ({ widths: { ...(current.widths || {}), [key]: width } })); }
  useEffect(() => { if (sheetView.widths && viewKey) prefs.write(`widths:${viewKey}`, { ...savedWidths, ...sheetView.widths }); }, [sheetView.widths]); // eslint-disable-line react-hooks/exhaustive-deps
  function autoFit(viewColumn) {
    const column = columns[viewColumn]; const values = displayRows.slice(0, 400).map((rowIndex) => rawCell(rowIndex, column.index));
    const longest = Math.max(String(column.label).length * 7.6 + 40, ...values.map((value) => Math.min(String(value ?? '').split('\n')[0].length, 90) * 7.1 + 26));
    setColumnWidth(viewColumn, Math.round(Math.max(64, Math.min(640, longest))));
  }
  function setSort(columnIndex, direction) { patchView({ sort: direction ? { column: columnIndex, direction } : null }); setMenu(null); }
  function setFilter(key, filter) { patchView((current) => ({ filters: { ...(current.filters || {}), [key]: filter }, selection: null })); }
  function hideColumn(key) { const next = [...new Set([...hidden, key])]; patchView({ hidden: next, selection: null }); prefs.write(`hidden:${viewKey}`, next); setMenu(null); }
  function showColumns(next) { patchView({ hidden: next }); prefs.write(`hidden:${viewKey}`, next); }
  function toggleWrap() { const next = !wrap; patchView({ wrap: next }); prefs.write('wrap', next); }
  function toggleFrozen() { const next = frozenColumns ? 0 : 1; patchView({ frozen: next }); prefs.write(`frozen:${viewKey}`, next); }

  function openFind() { setFind((current) => ({ ...current, open: true })); requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select(); }); }
  function closeFind() { setFind({ open: false, query: '', index: 0 }); gridRef.current?.focus(); }
  function stepFind(delta) { if (matches.length) setFind((current) => ({ ...current, index: (Math.min(current.index, matches.length - 1) + delta + matches.length) % matches.length })); }

  function chooseSheet(id) { if (id === sheet?.id) return; setSheetId(id); setFormulaDraft(null); setMenu(null); requestAnimationFrame(() => gridRef.current?.focus()); }
  function chooseWorkbook(id) { flushSave(); setWorkbookId(id); setMenu(null); setFind({ open: false, query: '', index: 0 }); }

  async function importFile(targetId) {
    setMenu(null); setPending('import');
    try {
      const result = await api.importWorkbook(targetId ? { workbookId: targetId } : {}); if (!result) return;
      await refreshList(); setWorkbookId(result.id);
      say({ notice: `${targetId ? 'Updated' : 'Imported'} “${result.name}” · ${result.sheets.length} ${result.sheets.length === 1 ? 'tab' : 'tabs'}.${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}` });
    } catch (error) { say({ error: error.message || String(error) }); }
    finally { setPending(''); }
  }
  async function pullGoogle(event, targetId) {
    event?.preventDefault(); setPending('google');
    try {
      const result = await api.pullGoogleSheet({ spreadsheetUrl: googleUrl, workbookId: targetId }); setMenu(null); setGoogleUrl('');
      await refreshList(); setWorkbookId(result.id); say({ notice: `Pulled “${result.name}” from Google Sheets · ${result.sheets.length} tabs.` });
    } catch (error) { say({ error: error.message || String(error) }); }
    finally { setPending(''); }
  }
  async function removeWorkbook() {
    setMenu(null);
    if (!window.confirm(`Remove “${workbook.name}” from Sheets? Your original file isn’t affected, but edits made here are deleted.`)) return;
    try { await api.removeWorkbook({ workbookId: workbook.id }); setWorkbook(null); await refreshList(); say({ notice: 'Workbook removed.' }); }
    catch (error) { say({ error: error.message || String(error) }); }
  }
  async function renameWorkbook(event) {
    event.preventDefault(); const name = new FormData(event.currentTarget).get('name');
    try { await api.renameWorkbook({ workbookId: workbook.id, name }); setMenu(null); await refreshList(); setWorkbook((current) => current && { ...current, name: String(name).trim() }); }
    catch (error) { say({ error: error.message || String(error) }); }
  }

  function commitFormula() {
    if (formulaDraft === null || !active) return;
    if (formulaDraft !== activeValue) commitCell(active.row, active.column, formulaDraft);
    setFormulaDraft(null); gridRef.current?.focus();
  }

  // ⌘F finds within the sheet from anywhere on the page.
  function onViewKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); openFind(); }
  }

  const research = workbook?.kind === 'research';
  const activeFilters = Object.entries(filters).filter(([, filter]) => filter);
  const editCount = Object.values(edits.sheets || {}).reduce((sum, rows) => sum + Object.values(rows).reduce((inner, cells) => inner + Object.keys(cells).length, 0), 0);
  const activeColumn = active ? columns[active.column] : null;
  // Sorted or filtered rows aren't contiguous in the source sheet, so a multi-row range reads as its size, like Sheets does while dragging.
  const multiCell = bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right);
  const nameBox = !active || !bounds ? '' : !multiCell ? cellAddress(sheetRowNumber(active.row), activeColumn.index)
    : (sort || Object.values(filters).some(Boolean)) && bounds.top !== bounds.bottom ? `${number(bounds.bottom - bounds.top + 1)}R × ${number(bounds.right - bounds.left + 1)}C`
      : `${cellAddress(sheetRowNumber(bounds.top), columns[bounds.left].index)}:${cellAddress(sheetRowNumber(bounds.bottom), columns[bounds.right].index)}`;
  const isLink = /^https?:\/\/\S+$/i.test(activeValue.trim());
  const statusCopy = research && workbook ? STATUS_COPY[workbook.status] : '';

  if (workbooks === null) return <section className="sheets-view" aria-busy="true"><SheetSkeleton /></section>;

  if (!workbooks.length) {
    return <section className="sheets-view sheets-empty-state" onKeyDown={onViewKeyDown}>
      <div className="sheets-welcome">
        <span className="sheets-welcome-icon"><FileSpreadsheet size={26} aria-hidden="true" /></span>
        <h2>Your research, as a spreadsheet</h2>
        <p>Every research run opens here with the tabs you know from the Golden Thread sheet: Theme Repository, Twitter, Reddit, LinkedIn, Theme Summary Data and more. You can also bring in an existing Google Sheet.</p>
        {listError && <p className="sheets-inline-error" role="alert">{listError}</p>}
        <div className="sheets-welcome-actions">
          <button type="button" onClick={() => onNavigate?.('research-programs')}><Search size={15} aria-hidden="true" />Start a research run</button>
          <button type="button" className="ghost" disabled={Boolean(pending)} onClick={() => importFile()}>{pending === 'import' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}Import .xlsx or .csv</button>
        </div>
        <form className="sheets-google-inline" onSubmit={(event) => pullGoogle(event)}>
          <label htmlFor="sheets-google-url">Or pull a Google Sheet through your Sheets bridge</label>
          <div><input id="sheets-google-url" value={googleUrl} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /><button type="submit" className="ghost" disabled={!googleUrl.trim() || Boolean(pending)}>{pending === 'google' ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}Pull tabs</button></div>
        </form>
      </div>
    </section>;
  }

  const research_runs = workbooks.filter((entry) => entry.kind === 'research');
  const imported = workbooks.filter((entry) => entry.kind !== 'research');
  const headerMeta = workbook ? [research ? 'Research run' : workbook.source?.kind === 'google-sheets' ? 'Pulled from Google Sheets' : `Imported${workbook.source?.fileName ? ` from ${workbook.source.fileName}` : ''}`, `${workbook.sheets.length} tabs`, relative(listing?.updatedAt) && `Updated ${relative(listing?.updatedAt)}`].filter(Boolean).join(' · ') : '';

  return <section className="sheets-view" onKeyDown={onViewKeyDown}>
    <header className="sheets-bar">
      <div className="sheets-identity">
        <span className="sheets-mark" aria-hidden="true"><Sheet size={17} /></span>
        <button type="button" className="sheets-picker" aria-haspopup="menu" aria-expanded={menu?.kind === 'workbooks'} onClick={(event) => setMenu({ kind: 'workbooks', anchor: event.currentTarget.getBoundingClientRect() })}>
          <span className="sheets-picker-name">{workbook?.name || listing?.name || 'Choose a workbook'}</span><ChevronDown size={15} aria-hidden="true" />
        </button>
        <span className="sheets-meta">{headerMeta}</span>
      </div>
      <div className="sheets-actions">
        <span className={`sheets-save ${saveState}`} role="status" title={research ? 'Edits stay in this workbook. They don’t change the research run.' : 'Edits are saved with this workbook.'}>
          {saveState === 'saving' || saveState === 'pending' ? <><LoaderCircle className="spin" size={13} aria-hidden="true" />Saving…</> : saveState === 'error' ? 'Not saved' : editCount ? <><Check size={13} aria-hidden="true" />{number(editCount)} {editCount === 1 ? 'edit' : 'edits'} saved</> : null}
        </span>
        <button type="button" className="ghost icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={!history.undo.length} onClick={() => step('undo')}><Undo2 size={16} /></button>
        <button type="button" className="ghost icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!history.redo.length} onClick={() => step('redo')}><Redo2 size={16} /></button>
        <button type="button" className="ghost" aria-haspopup="menu" disabled={Boolean(pending)} onClick={(event) => setMenu({ kind: 'import', anchor: event.currentTarget.getBoundingClientRect() })}>{pending ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}Import</button>
        <button type="button" aria-haspopup="menu" disabled={!sheet} onClick={(event) => setMenu({ kind: 'export', anchor: event.currentTarget.getBoundingClientRect() })}><Download size={15} aria-hidden="true" />Export</button>
      </div>
    </header>

    {statusCopy && <div className={`sheets-run-note ${workbook.status}`}><span>{statusCopy}</span><button type="button" className="ghost" onClick={() => onNavigate?.(workbook.status === 'awaiting-review' ? 'trend-board' : 'research-programs')}>{workbook.status === 'awaiting-review' ? 'Review themes' : 'Open run'}<ArrowUpRight size={14} aria-hidden="true" /></button></div>}

    <div className="sheets-toolbar" role="toolbar" aria-label="Sheet tools">
      <div className={`sheets-find${find.open ? ' open' : ''}`}>
        <Search size={14} aria-hidden="true" />
        <input ref={findRef} aria-label="Find in sheet" placeholder="Find in sheet" value={find.query} onFocus={() => !find.open && setFind((current) => ({ ...current, open: true }))}
          onChange={(event) => setFind({ open: true, query: event.target.value, index: 0 })}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); stepFind(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { event.preventDefault(); closeFind(); } }} />
        {find.query && <span className="sheets-find-count" aria-live="polite">{matches.length ? `${Math.min(find.index, matches.length - 1) + 1} of ${matches.length >= 5000 ? '5,000+' : number(matches.length)}` : 'No matches'}</span>}
        {find.query && <><button type="button" className="ghost icon-button" aria-label="Previous match" disabled={!matches.length} onClick={() => stepFind(-1)}><ChevronLeft size={14} /></button><button type="button" className="ghost icon-button" aria-label="Next match" disabled={!matches.length} onClick={() => stepFind(1)}><ChevronRight size={14} /></button><button type="button" className="ghost icon-button" aria-label="Close find" onClick={closeFind}><X size={14} /></button></>}
        {!find.query && <kbd>⌘F</kbd>}
      </div>
      {activeFilters.map(([key, filter]) => { const column = allColumns.find((entry) => entry.key === key); return <span key={key} className="sheets-chip"><Filter size={12} aria-hidden="true" />{column?.label || key}{filter.values ? `: ${filter.values.length === 1 ? (filter.values[0] || '(Blanks)') : `${filter.values.length} values`}` : ''}{filter.contains ? ` contains “${filter.contains}”` : ''}<button type="button" aria-label={`Remove ${column?.label || key} filter`} onClick={() => setFilter(key, null)}><X size={12} /></button></span>; })}
      {(activeFilters.length > 1 || (activeFilters.length > 0 && Boolean(sort))) && <button type="button" className="ghost sheets-tool" onClick={() => patchView({ filters: {}, sort: null })}><FilterX size={15} aria-hidden="true" />Clear all</button>}
      {sort && !activeFilters.length && <span className="sheets-chip">{sort.direction === 'desc' ? <ArrowUpAZ size={12} aria-hidden="true" /> : <ArrowDownAZ size={12} aria-hidden="true" />}Sorted by {allColumns[sort.column]?.label}<button type="button" aria-label="Remove sort" onClick={() => setSort(sort.column, null)}><X size={12} /></button></span>}
      <span className="sheets-toolbar-gap" />
      <button type="button" className={`ghost sheets-tool${wrap ? ' on' : ''}`} aria-pressed={wrap} onClick={toggleWrap} title="Show more of long posts in each row"><WrapText size={15} aria-hidden="true" />Wrap</button>
      <button type="button" className={`ghost sheets-tool${frozenColumns ? ' on' : ''}`} aria-pressed={Boolean(frozenColumns)} onClick={toggleFrozen} title="Keep the first column in view while scrolling sideways"><Snowflake size={15} aria-hidden="true" />Freeze</button>
      <button type="button" className={`ghost sheets-tool${hidden.length ? ' on' : ''}`} aria-haspopup="menu" disabled={!sheet} onClick={(event) => setMenu({ kind: 'columns', anchor: event.currentTarget.getBoundingClientRect() })}><Columns3 size={15} aria-hidden="true" />Columns{hidden.length ? ` · ${hidden.length} hidden` : ''}</button>
      <span className="sheets-count">{sheet ? (displayRows.length === sheet.rows.length ? `${number(sheet.rows.length)} ${sheet.rows.length === 1 ? 'row' : 'rows'}` : `${number(displayRows.length)} of ${number(sheet.rows.length)} rows`) : ''}</span>
    </div>

    <div className={`sheets-formula${formulaExpanded ? ' expanded' : ''}`}>
      <span className="sheets-namebox" aria-label="Selected cell">{nameBox}</span>
      <span className="sheets-fx" aria-hidden="true">fx</span>
      <textarea aria-label={activeColumn ? `${activeColumn.label} value` : 'Cell value'} rows={1} disabled={!active} readOnly={!active}
        value={formulaDraft ?? (active ? (activeColumn?.type === 'json' ? prettyCell(activeValue) : activeValue) : '')}
        placeholder={active ? '' : sheet?.note || 'Select a cell to read or edit it here'}
        onChange={(event) => setFormulaDraft(event.target.value)}
        onBlur={commitFormula}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); commitFormula(); } if (event.key === 'Escape') { event.preventDefault(); setFormulaDraft(null); gridRef.current?.focus(); } }} />
      {isLink && <button type="button" className="ghost sheets-open-link" onClick={() => api.openSourceUrl(activeValue.trim())}><ArrowUpRight size={14} aria-hidden="true" />Open link</button>}
      <button type="button" className="ghost icon-button" aria-label={formulaExpanded ? 'Collapse cell text' : 'Expand cell text'} title={formulaExpanded ? 'Collapse' : 'Read long cells in full'} onClick={() => setFormulaExpanded((value) => !value)}>{formulaExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    </div>

    <div className="sheets-stage">
      {loadError ? <div className="sheets-problem" role="alert"><strong>This workbook didn’t open.</strong><span>{loadError}</span><button type="button" className="ghost" onClick={() => { setLoadError(''); refreshList(); }}>Try again</button></div>
        : !workbook || (loading && workbook.id !== workbookId) ? <SheetSkeleton />
          : <SheetGrid key={viewKey} gridRef={gridRef} label={`${workbook.name}, ${sheet.name}`} columns={columns} rowCount={displayRows.length} getCell={getCell} isEdited={isEdited} sheetRowNumber={sheetRowNumber}
            selection={selection} onSelect={setSelection} wrap={wrap} frozenColumns={frozenColumns} findMatches={matchSet} activeMatch={activeMatch} sort={sort} filters={filters}
            onColumnMenu={(column, anchor) => setMenu({ kind: 'column', column, anchor })} onResizeColumn={setColumnWidth} onAutoFitColumn={autoFit}
            onCommit={commitCell} onClear={clearCells} onCopy={copyRange} onPaste={pasteAt} onUndo={() => step('undo')} onRedo={() => step('redo')} onFind={openFind}
            onOpenUrl={(url) => api.openSourceUrl(url)} onContextMenu={(point) => setMenu({ kind: 'context', ...point, anchor: { left: point.x, right: point.x, top: point.y, bottom: point.y } })}
            emptyState={sheet.empty ? <div className="sheet-empty-card"><strong>{sheet.empty.title}</strong><span>{sheet.empty.detail}</span>{sheet.id === 'taxonomy' && <button type="button" className="ghost" onClick={() => importFile()}><Upload size={14} aria-hidden="true" />Import your Google Sheet</button>}{['summary', 'counts', 'themes'].includes(sheet.id) && research && <button type="button" className="ghost" onClick={() => onNavigate?.(workbook.status === 'awaiting-review' ? 'trend-board' : 'research-programs')}>{workbook.status === 'awaiting-review' ? 'Review themes' : 'Open Research programs'}<ArrowUpRight size={14} aria-hidden="true" /></button>}</div>
              : activeFilters.length ? <div className="sheet-empty-card"><strong>No rows match these filters</strong><span>Loosen a filter to see more of this tab.</span><button type="button" className="ghost" onClick={() => patchView({ filters: {} })}><FilterX size={14} aria-hidden="true" />Clear filters</button></div>
                : <div className="sheet-empty-card"><strong>This tab is empty</strong></div>} />}
    </div>

    <footer className="sheets-tabs">
      <button type="button" className="ghost icon-button sheets-all-tabs" aria-label="All tabs" title="All tabs" aria-haspopup="menu" onClick={(event) => setMenu({ kind: 'tabs', anchor: event.currentTarget.getBoundingClientRect() })}><List size={16} /></button>
      <div className="sheets-tab-strip" role="tablist" aria-label="Workbook tabs">
        {workbook?.sheets.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={entry.id === sheet?.id} className={`sheets-tab${entry.id === sheet?.id ? ' active' : ''}${entry.rows.length ? '' : ' empty'}`} data-tint={TAB_TINT[entry.id] || TAB_TINT[entry.name.toLowerCase()] || undefined}
          onClick={() => chooseSheet(entry.id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const list = workbook.sheets; const index = list.findIndex((item) => item.id === entry.id); const next = list[(index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; chooseSheet(next.id); requestAnimationFrame(() => document.querySelector(`.sheets-tab[data-id="${next.id}"]`)?.focus()); }} data-id={entry.id}>
          {(TAB_TINT[entry.id] || TAB_TINT[entry.name.toLowerCase()]) && <i className="sheets-tab-dot" aria-hidden="true" />}<span>{entry.name}</span>{entry.rows.length > 0 && <small>{number(entry.rows.length)}</small>}
        </button>)}
      </div>
      <div className="sheets-stats" aria-live="polite">{stats && <>{stats.numericCount > 0 && <><span>Sum <strong>{formatStat(stats.sum)}</strong></span><span>Avg <strong>{formatStat(stats.average)}</strong></span><span>Min <strong>{formatStat(stats.min)}</strong></span><span>Max <strong>{formatStat(stats.max)}</strong></span></>}<span>Count <strong>{number(stats.count)}</strong></span></>}</div>
    </footer>

    {toast && <div className={`sheets-toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'} key={toast.error || toast.notice}><span>{toast.error || toast.notice}</span><button type="button" aria-label="Dismiss" onClick={() => setToast(null)}><X size={13} /></button></div>}
    {menu?.kind === 'workbooks' && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Workbooks" width={360} className="sheets-workbook-menu">
      {research_runs.length > 0 && <p className="sheet-menu-label">Research runs</p>}
      {research_runs.map((entry) => <button key={entry.id} type="button" role="menuitemcheckbox" aria-checked={entry.id === workbookId} className="sheet-menu-item workbook" onClick={() => chooseWorkbook(entry.id)}><Sheet size={15} aria-hidden="true" /><span><strong>{entry.name}</strong><small>{[relative(entry.createdAt), `${number(entry.rowCount)} posts`, entry.status && entry.status !== 'succeeded' ? entry.status.replace('-', ' ') : ''].filter(Boolean).join(' · ')}</small></span>{entry.id === workbookId && <Check size={15} aria-hidden="true" />}</button>)}
      {imported.length > 0 && <p className="sheet-menu-label">Imported</p>}
      {imported.map((entry) => <button key={entry.id} type="button" role="menuitemcheckbox" aria-checked={entry.id === workbookId} className="sheet-menu-item workbook" onClick={() => chooseWorkbook(entry.id)}><FileSpreadsheet size={15} aria-hidden="true" /><span><strong>{entry.name}</strong><small>{[entry.source?.kind === 'google-sheets' ? 'Google Sheets' : entry.source?.fileName, `${entry.sheetCount} tabs`, `${number(entry.rowCount)} rows`].filter(Boolean).join(' · ')}</small></span>{entry.id === workbookId && <Check size={15} aria-hidden="true" />}</button>)}
      {workbook?.kind === 'import' && <><div className="sheet-menu-rule" /><MenuItem icon={Pencil} onClick={(event) => setMenu({ kind: 'rename', anchor: menu.anchor })}>Rename this workbook</MenuItem>{workbook.source?.kind === 'google-sheets' ? <MenuItem icon={Link2} onClick={() => { setGoogleUrl(workbook.source.spreadsheetUrl); pullGoogle(null, workbook.id); }}>Pull the latest from Google Sheets</MenuItem> : <MenuItem icon={Upload} onClick={() => importFile(workbook.id)}>Replace with a newer file…</MenuItem>}<MenuItem icon={Trash2} danger onClick={removeWorkbook}>Remove from Sheets</MenuItem></>}
    </Popover>}
    {menu?.kind === 'rename' && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Rename workbook" width={320}><form className="sheets-rename" onSubmit={renameWorkbook}><label htmlFor="sheets-rename">Workbook name</label><input id="sheets-rename" name="name" defaultValue={workbook?.name} maxLength={160} /><div><button type="button" className="ghost" onClick={() => setMenu(null)}>Cancel</button><button type="submit">Rename</button></div></form></Popover>}
    {menu?.kind === 'import' && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Import" width={340}>
      <MenuItem icon={Upload} onClick={() => importFile()}>Spreadsheet file (.xlsx, .csv)…</MenuItem>
      <p className="sheet-menu-help">In Google Sheets choose File → Download → Microsoft Excel to bring every tab at once.</p>
      <div className="sheet-menu-rule" />
      <form className="sheets-google-form" onSubmit={(event) => pullGoogle(event)}><label htmlFor="sheets-google-pull">Pull from a Google Sheets link</label><input id="sheets-google-pull" value={googleUrl} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /><button type="submit" disabled={!googleUrl.trim() || Boolean(pending)}>{pending === 'google' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}Pull tabs</button><small>Uses the Sheets bridge from Settings.</small></form>
    </Popover>}
    {menu?.kind === 'export' && sheet && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Export" width={300}>
      <MenuItem icon={ClipboardCopy} onClick={copySheet}>Copy “{sheet.name}” for Google Sheets</MenuItem>
      <MenuItem icon={Download} onClick={() => downloadSheet(false)}>Download this tab (.csv)</MenuItem>
      {displayRows.length !== sheet.rows.length || hidden.length ? <MenuItem icon={Filter} onClick={() => downloadSheet(true)}>Download what’s shown (.csv)</MenuItem> : null}
    </Popover>}
    {menu?.kind === 'columns' && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Columns" width={280} className="sheets-columns-menu">
      <div className="sheets-columns-head"><span>Show columns</span><button type="button" onClick={() => showColumns([])} disabled={!hidden.length}>Show all</button></div>
      <div className="sheets-columns-list">{allColumns.map((column) => <label key={column.key} className="sheet-filter-option"><input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => showColumns(hidden.includes(column.key) ? hidden.filter((key) => key !== column.key) : [...hidden, column.key])} /><span>{column.label || '(Untitled)'}</span><small>{columnLetter(column.index)}</small></label>)}</div>
    </Popover>}
    {menu?.kind === 'column' && columns[menu.column] && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label={`${columns[menu.column].label} options`} width={menu.filtering ? 300 : 240}>
      {menu.filtering ? <FilterPanel column={columns[menu.column]} values={distinctValues(sheet.rows.map((_, index) => index), rawCell, columns[menu.column].index)} current={filters[columns[menu.column].key]} onApply={(filter) => setFilter(columns[menu.column].key, filter)} onClose={() => setMenu(null)} />
        : <><MenuItem icon={ArrowDownAZ} onClick={() => setSort(columns[menu.column].index, 'asc')}>Sort A → Z</MenuItem><MenuItem icon={ArrowUpAZ} onClick={() => setSort(columns[menu.column].index, 'desc')}>Sort Z → A</MenuItem>{sort?.column === columns[menu.column].index && <MenuItem icon={X} onClick={() => setSort(null, null)}>Remove sort</MenuItem>}<div className="sheet-menu-rule" /><MenuItem icon={Filter} onClick={() => setMenu({ ...menu, filtering: true })}>{filters[columns[menu.column].key] ? 'Edit filter…' : 'Filter…'}</MenuItem>{filters[columns[menu.column].key] && <MenuItem icon={FilterX} onClick={() => { setFilter(columns[menu.column].key, null); setMenu(null); }}>Remove filter</MenuItem>}<div className="sheet-menu-rule" /><MenuItem icon={MoveHorizontal} onClick={() => { autoFit(menu.column); setMenu(null); }}>Fit to content</MenuItem><MenuItem icon={EyeOff} onClick={() => hideColumn(columns[menu.column].key)}>Hide column</MenuItem></>}
    </Popover>}
    {menu?.kind === 'tabs' && workbook && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="All tabs" width={260}>{workbook.sheets.map((entry) => <button key={entry.id} type="button" role="menuitemcheckbox" aria-checked={entry.id === sheet?.id} className="sheet-menu-item" onClick={() => chooseSheet(entry.id)}><span className="sheet-menu-gap" /><span>{entry.name}</span><small>{entry.rows.length ? number(entry.rows.length) : '—'}</small></button>)}</Popover>}
    {menu?.kind === 'context' && columns[menu.column] && <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Cell options" width={260}>
      <MenuItem icon={ClipboardCopy} hint="⌘C" onClick={() => { const data = copyRange(bounds, selection); navigator.clipboard?.writeText(data.text).catch(() => {}); setMenu(null); }}>Copy</MenuItem>
      <MenuItem icon={Trash2} hint="⌫" onClick={() => { clearCells(bounds); setMenu(null); }}>Clear cells</MenuItem>
      <div className="sheet-menu-rule" />
      <MenuItem icon={Filter} onClick={() => { const value = String(getCell(menu.row, menu.column) ?? ''); setFilter(columns[menu.column].key, { values: [value] }); setMenu(null); }}>Show only “{String(getCell(menu.row, menu.column) || '(Blanks)').slice(0, 28)}”</MenuItem>
      <MenuItem icon={ArrowDownAZ} onClick={() => setSort(columns[menu.column].index, 'asc')}>Sort A → Z by this column</MenuItem>
      <MenuItem icon={ArrowUpAZ} onClick={() => setSort(columns[menu.column].index, 'desc')}>Sort Z → A by this column</MenuItem>
      {/^https?:\/\/\S+$/i.test(String(getCell(menu.row, menu.column) || '').trim()) && <><div className="sheet-menu-rule" /><MenuItem icon={ArrowUpRight} hint="⌘-click" onClick={() => { api.openSourceUrl(String(getCell(menu.row, menu.column)).trim()); setMenu(null); }}>Open link</MenuItem></>}
    </Popover>}
  </section>;
}

function SheetSkeleton() {
  return <div className="sheet-skeleton" aria-hidden="true">
    <div className="sheet-skeleton-head">{Array.from({ length: 8 }, (_, index) => <span key={index} style={{ width: [90, 260, 120, 130, 80, 80, 80, 150][index] }} />)}</div>
    {Array.from({ length: 14 }, (_, row) => <div key={row} className="sheet-skeleton-row" style={{ '--i': row }}>{Array.from({ length: 8 }, (_, index) => <span key={index} style={{ width: [90, 260, 120, 130, 80, 80, 80, 150][index] }}><i style={{ width: `${40 + ((row * 7 + index * 13) % 50)}%` }} /></span>)}</div>)}
  </div>;
}
