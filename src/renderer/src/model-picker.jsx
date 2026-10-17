import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Search } from 'lucide-react';
import MODELS from '../../shared/ai-models.json';
import PROVIDERS from '../../shared/ai-providers.json';
import './ai-settings.css';

// A searchable model list for one connection (Settings → Model routing, a research program's own stage choices).
// Claude and OpenAI pictures come from the studio's catalog; Codex, OpenRouter, OpenAI text and fal.ai are read through
// listAiModels (search, filters, paging). "Use this exact ID" takes any ID that fits the connection's pattern.
const CLAUDE_ROUTES = new Set(['auto', 'claude', 'claude-api']);
const FAMILY = Object.fromEntries([...PROVIDERS.connections, ...PROVIDERS.pseudo].map((entry) => [entry.id, entry.family]));
const tokens = (value) => (!Number.isFinite(value) ? '' : value >= 1000000 ? `${Number((value / 1000000).toFixed(1))}M` : `${Math.round(value / 1000)}K`);
const dollars = (value) => (value >= 1 ? `$${Number(value.toFixed(2))}` : `$${Number(value.toPrecision(2))}`);
export function priceLine(row) {
  if (Number.isFinite(row?.inputUsdPerMTok) && Number.isFinite(row?.outputUsdPerMTok)) return `${dollars(row.inputUsdPerMTok)} / ${dollars(row.outputUsdPerMTok)} per M tokens`;
  if (Number.isFinite(row?.unitUsd)) { const unit = String(row.unit || 'image').replace(/s$/, ''); return `${dollars(row.unitUsd)} a${/^[aeiou]/.test(unit) ? 'n' : ''} ${unit}`; }
  if (row?.estimateUsd?.medium) return `about ${dollars(row.estimateUsd.medium)} a picture`;
  return '';
}
// The catalog rows a connection lists without asking the server.
export function catalogModels(route, kind) {
  if (kind === 'text' && CLAUDE_ROUTES.has(route)) return MODELS.text.filter((row) => row.family === 'claude').map((row) => ({ ...row, route, kind, source: 'catalog' }));
  if (kind === 'image' && route === 'openai') return MODELS.images.filter((row) => row.route === 'openai').map((row) => ({ ...row, kind, imageInput: true, source: 'catalog' }));
  if (kind === 'image' && route === 'fal') return MODELS.images.filter((row) => row.route === 'fal').map((row) => ({ ...row, kind, source: 'catalog' }));
  if (kind === 'video') return MODELS.videos.map((row) => ({ ...row, kind, source: 'catalog' }));
  if (kind === 'text' && route === 'codex') return [{ id: '', label: 'Codex default', route: 'codex', kind, efforts: null, source: 'catalog' }];
  if (kind === 'text' && route === 'openai') return MODELS.openaiText.map((row) => ({ ...row, route, kind, source: 'catalog' }));
  return [];
}
export function modelName(route, kind, id) {
  if (route === 'codex' && !id) return 'Codex default';
  return catalogModels(route, kind).find((row) => row.id === id)?.label || id || '';
}
function fitsPattern(route, id) {
  const family = FAMILY[route]; const pattern = PROVIDERS.modelPatterns[family];
  return Boolean(pattern && id && new RegExp(pattern).test(id));
}

export function ModelPicker({ route, kind = 'text', value = '', onChange, api, id, label = 'Model', disabled = false, needs = {} }) {
  const auto = useId(); const inputId = id || `model-${auto}`; const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const [rows, setRows] = useState(() => catalogModels(route, kind)); const [loading, setLoading] = useState(false); const [problem, setProblem] = useState('');
  const [cursor, setCursor] = useState(null); const [active, setActive] = useState(0);
  const [structured, setStructured] = useState(kind === 'text'); const [takesRefs, setTakesRefs] = useState(false);
  const remote = !(kind === 'text' && CLAUDE_ROUTES.has(route)) && !(kind === 'image' && route === 'openai') && typeof api?.listAiModels === 'function';
  const timer = useRef(null); const asked = useRef(0); const box = useRef(null);
  useEffect(() => { setRows(catalogModels(route, kind)); setCursor(null); setProblem(''); }, [route, kind]);
  useEffect(() => {
    if (!open || !remote) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ask = ++asked.current; setLoading(true); setProblem('');
      try {
        const result = await api.listAiModels({ route, kind, query, filters: { ...(kind === 'text' && route === 'openrouter' ? { structured } : {}), ...(kind === 'image' ? { referenceImages: takesRefs } : {}) }, limit: 30 });
        if (ask !== asked.current) return;
        setRows(Array.isArray(result?.models) ? result.models : []); setCursor(result?.nextCursor || null);
        if (result?.stale) setProblem('The list couldn’t be refreshed just now; these are the last ones the studio saw.');
      } catch (error) { if (ask === asked.current) { setRows(catalogModels(route, kind)); setProblem(error?.message || 'The model list couldn’t be read.'); } }
      finally { if (ask === asked.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [open, remote, route, kind, query, structured, takesRefs, api]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  async function more() {
    if (!cursor || !remote) return;
    setLoading(true);
    try { const result = await api.listAiModels({ route, kind, query, cursor, filters: { ...(kind === 'text' && route === 'openrouter' ? { structured } : {}) }, limit: 30 }); setRows((current) => [...current, ...(result?.models || [])]); setCursor(result?.nextCursor || null); }
    catch (error) { setProblem(error?.message || 'More models couldn’t be read.'); } finally { setLoading(false); }
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = remote ? rows : rows.filter((row) => !q || row.id.toLowerCase().includes(q) || String(row.label || '').toLowerCase().includes(q));
    return list.filter((row) => !(needs.minContextTokens && Number.isFinite(row.contextTokens) && row.contextTokens < needs.minContextTokens));
  }, [rows, query, remote, needs.minContextTokens]);
  const exact = query.trim() && !shown.some((row) => row.id === query.trim()) && fitsPattern(route, query.trim()) ? query.trim() : '';
  const options = [...shown, ...(exact ? [{ id: exact, label: 'Use this exact ID', exact: true }] : [])];
  function choose(row) { onChange?.(row.id, row); setOpen(false); setQuery(''); }
  function onKey(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); choose(options[active]); }
    else if (event.key === 'Escape') { setOpen(false); }
  }
  const current = modelName(route, kind, value) || (value ? value : route === 'codex' ? 'Codex default' : 'Choose a model');
  return <div className="ai-picker" ref={box}>
    <label className="ai-sr-only" htmlFor={inputId}>{label}</label>
    <div className={`ai-picker-field${open ? ' is-open' : ''}`}>
      <Search size={14} aria-hidden="true" />
      <input id={inputId} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" spellCheck="false" disabled={disabled} placeholder={current} value={open ? query : ''} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={onKey} />
      <span className="ai-picker-current" aria-hidden={open ? 'true' : undefined}>{open ? '' : current}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </div>
    {open && <div className="ai-picker-pop">
      {(kind === 'text' && route === 'openrouter') || kind === 'image' ? <div className="ai-picker-chips" role="group" aria-label="Filters">
        {kind === 'text' && <button type="button" aria-pressed={structured} onClick={() => setStructured((on) => !on)}>Structured answers</button>}
        {kind === 'image' && <button type="button" aria-pressed={takesRefs} onClick={() => setTakesRefs((on) => !on)}>Takes reference images</button>}
      </div> : null}
      <ul id={listId} role="listbox" aria-label={label} className="ai-picker-list">
        {options.map((row, index) => <li key={`${row.id}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={row.id === value} className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); choose(row); }}>
          <span className="ai-picker-row-main"><strong>{row.exact ? `Use this exact ID: ${row.id}` : row.label || row.id}</strong>{!row.exact && row.id && <code>{row.id}</code>}</span>
          <span className="ai-picker-row-meta">
            {Number.isFinite(row.contextTokens) && <span>{tokens(row.contextTokens)}</span>}
            {priceLine(row) && <span>{priceLine(row)}</span>}
            {row.structured === 'native' && kind === 'text' && <span className="ai-badge">Structured answers</span>}
            {row.imageInput && kind === 'text' && <span className="ai-badge">Reads images</span>}
            {kind === 'image' && (row.referenceImages || 0) > 0 && <span className="ai-badge">Brand references</span>}
            {kind === 'video' && row.input === 'image' && <span className="ai-badge">Starts from a picture</span>}
          </span>
          {row.id === value && <Check size={14} aria-hidden="true" />}
        </li>)}
        {!options.length && !loading && <li className="ai-picker-empty" role="option" aria-selected="false" aria-disabled="true">{query ? 'No models match.' : 'No models to show.'}</li>}
      </ul>
      {loading && <p className="ai-picker-note"><LoaderCircle className="spin" size={13} aria-hidden="true" /> Loading models…</p>}
      {problem && <p className="ai-picker-note" role="status">{problem}</p>}
      {cursor && !loading && <button type="button" className="ai-link" onClick={more}>Show more</button>}
    </div>}
  </div>;
}
