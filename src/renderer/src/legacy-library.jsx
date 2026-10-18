import React from 'react';
import { ExternalLink, FolderOpen } from 'lucide-react';
import { Button, formatDate, label, short } from './ui.jsx';
import { revealLabel } from './platform.js';
import './workspace-pages.css';

// Items made with the earlier content board stay reachable in Library after the board was folded into the Trend board:
// the Library shows them as a collapsed "From the earlier content board" folder, which renders this list when opened.
export function LegacyLibrary({ state, busy, onOpenAsset, onRevealAsset }) {
  const assets = (state.assets || []).filter((asset) => asset && asset.id);
  const cards = (state.cards || []).filter((card) => card && card.id && !String(card.id).startsWith('dataset-'));
  if (!assets.length && !cards.length) return null;
  return <section className="ws ws-legacy" aria-labelledby="legacy-library-title">
    <div className="ws-card">
      <div className="ws-card-head"><div><h3 id="legacy-library-title">From the earlier content board</h3><p className="ws-hint">Kept here so nothing is lost. New work flows through the Trend board and Create content.</p></div></div>
      <ul className="ws-legacy-list">
        {assets.map((asset) => <li key={asset.id}><div><strong>{asset.title || 'Generated asset'}</strong><small>{[asset.channel, label(asset.status || 'draft'), asset.createdAt && formatDate(asset.createdAt)].filter(Boolean).join(' · ')}</small>{asset.markdown && <small>{short(asset.markdown, 140)}</small>}</div>
          {asset.assetPath && <span className="ws-head-actions"><Button className="ghost" disabled={busy} onClick={() => onOpenAsset(asset.id)}><ExternalLink size={13} aria-hidden="true" />Open</Button><Button className="ghost" disabled={busy} onClick={() => onRevealAsset(asset.id)}><FolderOpen size={13} aria-hidden="true" />{revealLabel()}</Button></span>}</li>)}
        {cards.map((card) => <li key={card.id}><div><strong>{card.title || 'Untitled card'}</strong><small>{[label(card.column || 'detected'), card.date].filter(Boolean).join(' · ')}</small></div></li>)}
      </ul>
    </div>
  </section>;
}
