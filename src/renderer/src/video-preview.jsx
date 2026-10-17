import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, ClipboardCopy, Download, LoaderCircle } from 'lucide-react';
import './ai-settings.css';

// Short social videos in Assets and the Library. The clip is read when its tile scrolls into view (readStudioAsset sends
// it as base64; the page plays it from a Blob URL, revoked when the tile goes away). Hovering plays it muted unless the
// person asked for reduced motion; the lightbox player has controls and the on-screen lines saved beside the clip.
export const duration = (seconds) => { const value = Math.max(0, Math.round(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function blobFrom(video) {
  if (!video?.base64) return '';
  try {
    const binary = atob(video.base64); const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: video.mime || 'video/mp4' }));
  } catch (_) { return ''; }
}

// Reads one video asset once and keeps its Blob URL for as long as the caller is mounted.
export function useVideoAsset(assetId, api, { enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', url: '', poster: '', captions: [], tooLarge: false, error: '' });
  useEffect(() => {
    if (!enabled || !assetId || typeof api?.readStudioAsset !== 'function') return undefined;
    let live = true; let url = '';
    setState((current) => ({ ...current, status: 'loading' }));
    api.readStudioAsset({ assetId }).then((result) => {
      if (!live) return;
      url = blobFrom(result?.video);
      setState({ status: 'ready', url, poster: result?.posterDataUrl || '', captions: Array.isArray(result?.captions) ? result.captions : [], tooLarge: Boolean(result?.tooLarge), error: '' });
    }).catch((error) => { if (live) setState((current) => ({ ...current, status: 'failed', error: error?.message || 'The video couldn’t be read.' })); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [assetId, api, enabled]);
  return state;
}

export function VideoTile({ asset, api, title }) {
  const box = useRef(null); const player = useRef(null); const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = box.current; if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return undefined; }
    const watch = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); watch.disconnect(); } }, { rootMargin: '200px' });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
  const video = useVideoAsset(asset?.id, api, { enabled: visible });
  const hover = (on) => { const node = player.current; if (!node || reducedMotion()) return; if (on) node.play?.()?.catch?.(() => {}); else { node.pause?.(); try { node.currentTime = 0; } catch (_) { /* not loaded */ } } };
  return <span className="video-tile" ref={box} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
    {video.url ? <video ref={player} src={video.url} poster={video.poster || undefined} muted playsInline preload="metadata" aria-label={title || asset?.title || 'Short video'} />
      : video.poster ? <img src={video.poster} alt="" /> : <span className="video-tile-placeholder">{video.status === 'loading' ? <LoaderCircle className="spin" size={22} aria-hidden="true" /> : <Clapperboard size={26} aria-hidden="true" />}</span>}
    {Number.isFinite(asset?.durationSeconds) && <span className="video-duration" aria-label={`${asset.durationSeconds} seconds`}>{duration(asset.durationSeconds)}</span>}
  </span>;
}

export function VideoPlayer({ asset, api, onDownload }) {
  const video = useVideoAsset(asset?.id, api);
  const [copied, setCopied] = useState(false);
  async function copyLines() { try { await navigator.clipboard?.writeText(video.captions.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (_) { setCopied(false); } }
  return <div className="video-player">
    {video.url ? <video src={video.url} poster={video.poster || undefined} controls playsInline preload="metadata" aria-label={asset?.title || 'Short video'} />
      : <span className="video-tile-placeholder is-large">{video.status === 'failed' ? video.error : video.tooLarge ? 'This clip is too long to play here. Download it to watch.' : <><LoaderCircle className="spin" size={26} aria-hidden="true" /><small>Loading the video…</small></>}</span>}
    <div className="video-player-meta">
      {Number.isFinite(asset?.durationSeconds) && <span>{duration(asset.durationSeconds)}{asset.aspectRatio ? ` · ${asset.aspectRatio}` : ''}{asset.sound ? ' · with sound' : ' · no sound'}</span>}
      {onDownload && <button type="button" className="ai-link" onClick={onDownload}><Download size={13} aria-hidden="true" />Download</button>}
    </div>
    {video.captions.length > 0 && <div className="video-captions"><div className="video-captions-head"><strong>On-screen lines</strong><button type="button" className="ai-link" onClick={copyLines}><ClipboardCopy size={13} aria-hidden="true" />{copied ? 'Copied' : 'Copy'}</button></div>
      <ol>{video.captions.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
      <small>Words in AI video often come out garbled, so the clip has none; add these in your editor.</small></div>}
  </div>;
}
