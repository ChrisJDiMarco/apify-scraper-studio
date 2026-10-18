import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search } from 'lucide-react';
import { groupPaletteItems, rankPaletteItems } from './palette-content.js';
import { Empty } from './ui.jsx';
import { keyLabel } from './platform.js';

// The ⌘K palette in both layouts (App.jsx mounts it once; the channel owner's shell has none). Items are { id, label, icon?, group?, hint?, shortcut?, keywords?, action, args }: typed words
// match the label and the keywords, results show under their group's heading (best match first), and `fallback`
// adds one last item for whatever was typed (App's "Ask AI: <text>"). `limit` caps each group: `idle` before typing,
// `search` after (0 keeps every match). A page's `shortcut` (⌘3, Ctrl+3 on Windows) shows beside it, so the palette teaches the keys.
export function CommandPalette({ open, items = [], onClose, onRun, placeholder = 'Search reports, trends and pages…', fallback, limit = { idle: 0, search: 0 } }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const typed = query.trim();
  const sections = useMemo(() => {
    const grouped = groupPaletteItems(rankPaletteItems(items, typed), (typed ? limit?.search : limit?.idle) || 0);
    const extra = typed && fallback ? fallback(typed) : null;
    return extra ? [...grouped.filter((section) => section.items.length), { group: extra.group || '', items: [extra] }] : grouped.filter((section) => section.items.length);
  }, [items, typed, fallback, limit?.idle, limit?.search]);
  const visible = sections.flatMap((section) => section.items);
  const selectedIndex = Math.min(activeIndex, visible.length - 1);
  // Enter runs the first match before any arrow key, so show that row as chosen from the start.
  const highlightedIndex = Math.max(0, selectedIndex);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    setQuery('');
    setActiveIndex(-1);
    inputRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  function runItem(item) {
    if (!item) return;
    onRun(item);
    onClose();
  }

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const buttons = Array.from(dialogRef.current?.querySelectorAll('[data-palette-command]') || []);
    if (event.key === 'Tab') {
      event.preventDefault();
      const controls = [inputRef.current, ...buttons].filter(Boolean);
      const current = controls.indexOf(document.activeElement);
      const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visible.length) return;
      const next = event.key === 'ArrowDown'
        ? (selectedIndex + 1) % visible.length
        : (selectedIndex <= 0 ? visible.length - 1 : selectedIndex - 1);
      setActiveIndex(next);
      buttons[next]?.focus();
      buttons[next]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runItem(visible[Math.max(0, selectedIndex)]);
      return;
    }
    // Typing while a result is focused keeps refining the search instead of being lost.
    if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && document.activeElement !== inputRef.current) {
      inputRef.current?.focus();
    }
  }

  if (!open) return null;
  let position = -1;
  const renderItem = (item) => {
    position += 1;
    const index = position;
    const Icon = item.icon || Command;
    return (
      <button type="button" data-palette-command="" className={[index === highlightedIndex ? 'active' : '', item.action === 'ask' ? 'palette-ask' : ''].filter(Boolean).join(' ')} key={item.id} onFocus={() => setActiveIndex(index)} onMouseMove={() => index !== selectedIndex && setActiveIndex(index)} onClick={() => runItem(item)}>
        <Icon size={16} aria-hidden="true" />
        {item.hint ? <span className="palette-text"><span>{item.label}</span><small>{item.hint}</small></span> : <span>{item.label}</span>}
        {item.shortcut && <kbd className="palette-shortcut" aria-hidden="true">{keyLabel(item.shortcut)}</kbd>}
        <kbd aria-hidden="true">↵</kbd>
      </button>
    );
  };
  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} aria-label="Search commands" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }} placeholder={placeholder} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" aria-label="Matching commands">
          {sections.map((section, sectionIndex) => (section.group
            ? <div className="palette-group" role="group" aria-labelledby={`palette-group-${sectionIndex}`} key={section.group}><h3 className="palette-group-label" id={`palette-group-${sectionIndex}`}>{section.group}</h3>{section.items.map(renderItem)}</div>
            : <React.Fragment key={`ungrouped-${sectionIndex}`}>{section.items.map(renderItem)}</React.Fragment>))}
          {!visible.length && <Empty title="No matches" detail="Try another word, or the name of a page, report or trend." />}
        </div>
      </section>
    </div>
  );
}
