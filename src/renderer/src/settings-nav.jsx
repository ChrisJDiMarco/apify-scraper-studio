import React, { useRef } from 'react';
import { SETTINGS_GROUPS } from './settings-sections.js';
import { useNarrow } from './role-screens.jsx';

// The Settings section list: grouped links with a status dot each, sticky beside the page on wide screens and a
// "Jump to" menu above it on narrow ones. Links carry #/settings/<section>, so Copy link address works in the browser
// studio; a plain click jumps in place instead (onGo), and arrow keys, Home and End move between links.
export function SettingsNav({ sections = [], statuses = {}, active = '', onGo, narrow: forced }) {
  const media = useNarrow();
  const narrow = forced ?? media;
  const listRef = useRef(null);
  const groups = SETTINGS_GROUPS.map((group) => ({ ...group, sections: sections.filter((section) => section.group === group.id) })).filter((group) => group.sections.length);
  if (narrow) {
    return <div className="settings-jump">
      <label htmlFor="settings-jump">Jump to</label>
      <select id="settings-jump" value={sections.some((section) => section.id === active) ? active : sections[0]?.id || ''} onChange={(event) => onGo?.(event.target.value, { viaKeyboard: true })}>
        {groups.map((group) => <optgroup key={group.id} label={group.label}>
          {group.sections.map((section) => <option key={section.id} value={section.id}>{statuses[section.id]?.label ? `${section.label} · ${statuses[section.id].label}` : section.label}</option>)}
        </optgroup>)}
      </select>
    </div>;
  }
  function onKeyDown(event) {
    const links = [...(listRef.current?.querySelectorAll('.settings-nav-link') || [])];
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === 'ArrowDown' ? links[(index + 1) % links.length] : event.key === 'ArrowUp' ? links[(index - 1 + links.length) % links.length] : event.key === 'Home' ? links[0] : event.key === 'End' ? links[links.length - 1] : null;
    if (next) { event.preventDefault(); next.focus(); }
  }
  function onClick(event, id) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // ⌘-click and the context menu keep the link
    event.preventDefault();
    onGo?.(id, { viaKeyboard: event.detail === 0 });
  }
  return <nav className="settings-nav" aria-label="Settings sections" ref={listRef} onKeyDown={onKeyDown} data-spot="settings.nav">
    {groups.map((group) => <div key={group.id} className="settings-nav-section">
      <p className="settings-nav-group" id={`settings-nav-g-${group.id}`}>{group.label}</p>
      <ul aria-labelledby={`settings-nav-g-${group.id}`}>
        {group.sections.map((section) => { const status = statuses[section.id]; return <li key={section.id}>
          <a href={`#/settings/${section.id}`} className="settings-nav-link" aria-current={active === section.id ? 'location' : undefined} onClick={(event) => onClick(event, section.id)}>
            <span className="settings-nav-label">{section.label}</span>
            {status && <><span className={`settings-dot tone-${status.tone}`} aria-hidden="true" title={status.label} /><span className="sr-only">, {status.label}</span></>}
          </a>
        </li>; })}
      </ul>
    </div>)}
  </nav>;
}
