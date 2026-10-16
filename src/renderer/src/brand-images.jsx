import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Palette, Trash2 } from 'lucide-react';
import { Badge, Button } from './ui.jsx';

const list = (value) => (Array.isArray(value) ? value : []);

// Settings → Brand reference images. The pictures a channel asset kit draws send these to the image model with their
// prompt, as the Golden Thread n8n workflow did: style examples guide the look and are never copied, and an approved
// logo is merged in exactly, in a clean footer. A set without a logo draws none and leaves the footer clean.
// Thumbnails, errors and work in progress belong to one workspace, so switching workspaces starts the section afresh.
export function BrandImages(props) { return <BrandImageSets key={props.workspace?.id || 'none'} {...props} />; }
const MISSING_FILE = /missing from the studio/i; // readBrandImage's answer when the stored file is gone
function BrandImageSets({ api, workspace, busy, imagesConfigured }) {
  const sets = list(workspace?.brandImageSets);
  const [thumbs, setThumbs] = useState({}); // image id → data URL, 'missing' (the file is gone) or 'error' (try again)
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState('');
  const [problems, setProblems] = useState({});
  const loading = useRef(new Set()); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ids = sets.flatMap((set) => list(set.images).map((image) => image.id)).join('|');
  useEffect(() => {
    for (const imageId of ids.split('|').filter(Boolean)) {
      if (thumbs[imageId] || loading.current.has(imageId)) continue;
      loading.current.add(imageId);
      Promise.resolve().then(() => api.readBrandImage({ workspaceId: workspace.id, imageId }))
        .then((result) => { if (mounted.current) setThumbs((current) => ({ ...current, [imageId]: result?.dataUrl || 'error' })); })
        .catch((error) => { if (mounted.current) setThumbs((current) => ({ ...current, [imageId]: MISSING_FILE.test(error?.message || '') ? 'missing' : 'error' })); })
        .finally(() => loading.current.delete(imageId));
    }
  }, [ids, workspace?.id, attempt]);
  const retry = (imageId) => { setThumbs((current) => { const next = { ...current }; delete next[imageId]; return next; }); setAttempt((value) => value + 1); };
  if (!workspace?.id || !sets.length) return null;
  const total = sets.reduce((sum, set) => sum + list(set.images).length, 0);
  const disabled = busy || Boolean(working);

  // The browser studio opens its file picker inside this click, so nothing is awaited before the API call.
  async function run(setId, key, task) {
    if (working) return;
    setWorking(key); setProblems((current) => ({ ...current, [setId]: '' }));
    try { await task(); }
    catch (error) { setProblems((current) => ({ ...current, [setId]: error?.message || 'That didn’t work. Please try again.' })); }
    finally { setWorking(''); }
  }
  const add = (set, role) => run(set.id, `${set.id}:${role}`, () => api.addBrandImage({ workspaceId: workspace.id, family: set.id, role }));
  const changeRole = (set, image, role) => run(set.id, image.id, () => api.setBrandImageRole({ workspaceId: workspace.id, imageId: image.id, role }));
  const remove = (set, image) => { if (window.confirm(`Remove “${image.name}” from ${set.label}?`)) run(set.id, image.id, () => api.removeBrandImage({ workspaceId: workspace.id, imageId: image.id })); };

  return <section className="settings-block settings-brand-images" aria-labelledby="settings-brand-images-title" data-spot="settings.brand-images">
    <div className="settings-image-heading"><span className="settings-image-icon"><Palette size={21} aria-hidden="true" /></span><div><h3 id="settings-brand-images-title">Brand reference images</h3><p>Style examples and approved logos that channel asset pictures send to the image model.</p></div><Badge tone={total ? 'ready' : 'neutral'}>{total ? `${total} saved` : 'None yet'}</Badge></div>
    <p className="brand-images-intro">Style examples teach the look (palette, type and texture) and are never copied. An approved logo is placed exactly as supplied in a clean footer; without one, pictures draw no logo and leave the footer clean. New channel asset runs use what’s here, and a run keeps the images it started with.{imagesConfigured ? '' : ' Pictures are drawn once an OpenAI key is saved under Image generation.'}</p>
    <div className="brand-sets">{sets.map((set) => {
      const images = list(set.images); const hasLogo = images.some((image) => image.role === 'logo'); const full = images.length >= set.max;
      return <article className="brand-set" key={set.id} aria-labelledby={`brand-set-${set.id}`}>
        <div className="brand-set-head"><div><h4 id={`brand-set-${set.id}`}>{set.label}</h4><p>{set.hint}</p></div><span className="brand-set-count">{images.length} of {set.max}</span></div>
        {images.length ? <ul className="brand-set-images">{images.map((image) => {
          const thumb = thumbs[image.id];
          return <li key={image.id} className={image.role === 'logo' ? 'is-logo' : undefined}>
            <span className="brand-thumb">{thumb === 'missing' ? <span className="brand-thumb-missing">File missing</span> : thumb === 'error' ? <button type="button" className="ghost brand-thumb-retry" onClick={() => retry(image.id)}>Preview didn’t load. Retry</button> : thumb ? <img src={thumb} alt={image.name} /> : <span className="brand-thumb-loading" role="img" aria-label="Loading picture" />}</span>
            <span className="brand-image-name" title={image.name}>{image.name}</span>
            <small>{image.width} × {image.height}</small>
            <span className="brand-image-actions">
              <select aria-label={`How ${image.name} is used`} value={image.role} disabled={disabled} onChange={(event) => changeRole(set, image, event.target.value)}><option value="style">Style example</option><option value="logo" disabled={hasLogo && image.role !== 'logo'}>Approved logo</option></select>
              <Button type="button" className="ghost brand-image-remove" aria-label={`Remove ${image.name}`} disabled={disabled} onClick={() => remove(set, image)}>{working === image.id ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}</Button>
            </span>
          </li>;
        })}</ul> : <p className="brand-set-empty">No reference images yet. These pictures follow the brand colors only and leave the footer clean.</p>}
        <div className="brand-set-actions">
          <Button type="button" disabled={disabled || full} onClick={() => add(set, 'style')}>{working === `${set.id}:style` ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}Add style example…</Button>
          <Button type="button" className="ghost" disabled={disabled || full || hasLogo} onClick={() => add(set, 'logo')}>{working === `${set.id}:logo` ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}Add approved logo…</Button>
          <small>{full ? 'This set is full. Remove a picture to add another.' : hasLogo ? 'One approved logo per set. Remove it to use a different one.' : 'PNG, JPEG or WebP, under 10 MB.'}</small>
        </div>
        {problems[set.id] && <p className="error-line" role="alert">{problems[set.id]}</p>}
      </article>;
    })}</div>
  </section>;
}
