import React, { useEffect, useId, useRef, useState } from 'react';
import { Archive, ArrowLeft, ChevronRight, FileText, History, Image, ImagePlus, LoaderCircle, Pencil, Plus, Save, Trash2, Video } from 'lucide-react';
import KIT, { customChannelList, isCustomChannel } from '../../shared/channel-table.js';
import { EmptyBlock, SaveBar } from './studio-kit.jsx';
import { can, formatDay, plural, useViewer, writeProps } from './viewer.js';
import { useConfirm } from './confirm-dialog.jsx';
import './channel-settings.css';

// A channel's settings: its knowledge (what the channel's team knows about writing for it, shared/channel-knowledge.json)
// and its asset instructions (the editable text of the prompts that write its assets, with versions and Restore). A
// channel owner sees their own channel (Studio › My channel: `channelId` fixed); admins and editors pick any channel
// (Studio › Channels). Saving goes through the server, which pins a channel owner to their own channel and keeps a
// prompt an admin locked read-only. Nothing here costs anything.
// Studio › Channels opens on a table of every channel (who owns it, how much of its knowledge is filled in, when it was
// last saved), so an empty or ownerless channel is visible at a glance; a row opens that channel.
const list = (value) => (Array.isArray(value) ? value : []);
export function ChannelSettings({ api, channels = [], formats = [], channelId: fixed = '', onNotice }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false); // the Edit channel form, for a channel an admin added
  const viewer = useViewer();
  const pickId = useId();
  const [channelId, setChannelId] = useState(fixed || '');
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState('knowledge');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!channelId || typeof api?.readChannelSettings !== 'function') return undefined;
    let live = true; setProblem('');
    Promise.resolve(api.readChannelSettings({ channelId })).then((result) => { if (live) setData(result || null); }, (failure) => { if (live) setProblem(failure?.message || 'This channel’s settings couldn’t be loaded.'); });
    return () => { live = false; };
  }, [channelId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTab('knowledge'); setEditing(false); setData(null); }, [channelId]); // another channel opens on its knowledge
  const name = data?.channelName || list(channels).find((row) => row.id === channelId)?.name || 'this channel';
  if (!fixed && !channelId) return <ChannelTable api={api} channels={channels} formats={formats} onOpen={setChannelId} onNotice={onNotice} />;
  // A channel an admin added (custom-channels.js) can be edited or removed here; its asset instructions are the built-in
  // formats' own, shown read only.
  const added = !fixed && (Boolean(data?.custom) || isCustomChannel(channelId));
  const mayManage = added && can(viewer, 'saveCustomChannel') && typeof api?.saveCustomChannel === 'function';
  const current = list(channels).find((row) => row.id === channelId) || null;
  async function remove() {
    if (!(await confirm({ title: `Remove “${name}”?`, lines: ['It leaves the channel lists, trend routing and the Calendar, and anyone who owns it will need another channel.', 'Assets already made for it keep their files.'], confirmLabel: 'Remove channel', cancelLabel: 'Keep it', tone: 'danger' }))) return;
    try { await api.removeCustomChannel({ channelId }); onNotice?.(`Removed “${name}”.`); setChannelId(''); }
    catch (failure) { setProblem(failure?.message || 'That channel couldn’t be removed.'); }
  }
  return <div className="simple-page channel-settings" data-spot="channel.settings">
    {!fixed && <button type="button" className="simple-back" onClick={() => setChannelId('')}><ArrowLeft size={15} aria-hidden="true" />All channels</button>}
    <div className="simple-page-head"><div><h1>{fixed ? 'My channel' : name === 'this channel' ? 'Channel' : name}</h1><p>{fixed ? `Publishing settings for ${name}.` : 'Manage what this channel makes and the guidance it uses.'}</p></div>
      {!fixed && list(channels).length > 0 && <div className="simple-head-actions">{mayManage && <><button type="button" className="studio-quiet" {...writeProps(viewer)} onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" />Edit channel</button><button type="button" className="studio-quiet" {...writeProps(viewer)} onClick={remove}><Trash2 size={14} aria-hidden="true" />Remove</button></>}<label className="cs-program-pick" htmlFor={pickId}><span className="sr-only">Channel</span><select id={pickId} className="simple-program-pick" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>}</div>
    {editing && mayManage && <ChannelForm api={api} formats={formats} channel={{ id: channelId, name: current?.name || name, short: current?.short || '', formats: list(customChannelList().find((row) => row.id === channelId)?.formats) }} onCancel={() => setEditing(false)} onSaved={(saved) => { setEditing(false); onNotice?.(`Saved “${saved?.name || name}”.`); setReload((value) => value + 1); }} />}
    <div className="people-tabs channel-tabs" role="tablist" aria-label="Channel settings">{[['knowledge', 'Channel knowledge'], ['images', 'Image examples'], ['instructions', 'Asset types']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {!data && !problem && <p className="studio-hint" role="status">Loading {name}…</p>}
    {data && tab === 'knowledge' && <KnowledgeForm key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'images' && <ChannelImages key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'instructions' && <InstructionsTab key={data.channelId} api={api} data={data} viewer={viewer} channels={channels} onOpenChannel={fixed ? undefined : setChannelId} onNotice={onNotice} onSaved={() => setReload((value) => value + 1)} />}
  </div>;
}

function ChannelImages({ api, data, viewer, onNotice }) {
  const confirm = useConfirm();
  const [references, setReferences] = useState(list(data.references));
  const [pictures, setPictures] = useState({});
  const [drafts, setDrafts] = useState({});
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState('');
  const [problem, setProblem] = useState('');
  const mayAdd = can(viewer, 'addChannelReference');
  const mayEdit = can(viewer, 'saveChannelReference');
  const mayRemove = can(viewer, 'removeChannelReference');
  useEffect(() => {
    let live = true;
    if (typeof api.readChannelReference !== 'function') return undefined;
    for (const reference of references) if (!pictures[reference.id]) Promise.resolve().then(() => api.readChannelReference({ channelId: data.channelId, imageId: reference.id })).then((result) => { if (live && /^data:image\/(png|jpeg|webp);base64,/.test(result?.dataUrl || '')) setPictures((current) => ({ ...current, [reference.id]: result.dataUrl })); }, () => { if (live) setProblem('An example image couldn’t be loaded. Reopen this channel to try again.'); });
    return () => { live = false; };
  }, [references.map((row) => row.id).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add(event) {
    event.preventDefault(); if (!description.trim() || viewer.preview || pending) return;
    setPending('add'); setProblem('');
    try {
      const result = await api.addChannelReference({ channelId: data.channelId, description: description.trim() });
      if (result?.cancelled) return;
      if (!result?.reference?.id) throw new Error('The image example wasn’t saved. Try again.');
      setReferences((current) => [...current, result.reference]);
      if (result.dataUrl) setPictures((current) => ({ ...current, [result.reference.id]: result.dataUrl }));
      setDescription(''); onNotice?.(`Saved an image example for ${data.channelName}. Future pictures use its image and description.`);
    } catch (failure) { setProblem(failure?.message || 'That example couldn’t be saved. Try again.'); }
    finally { setPending(''); }
  }
  async function update(reference) {
    const next = String(drafts[reference.id] ?? reference.description).trim();
    if (!next || viewer.preview || pending) return;
    setPending(reference.id); setProblem('');
    try { const result = await api.saveChannelReference({ channelId: data.channelId, imageId: reference.id, description: next }); setReferences((current) => current.map((row) => row.id === reference.id ? result.reference : row)); setDrafts((current) => { const next = { ...current }; delete next[reference.id]; return next; }); onNotice?.('Saved the example’s description.'); }
    catch (failure) { setProblem(failure?.message || 'That description couldn’t be saved.'); }
    finally { setPending(''); }
  }
  async function remove(reference) {
    if (viewer.preview || pending || !(await confirm({ title: `Remove “${reference.name}”?`, lines: ['Future pictures will stop using this example. Existing assets stay as they are.'], confirmLabel: 'Remove example', danger: true }))) return;
    setPending(reference.id); setProblem('');
    try { await api.removeChannelReference({ channelId: data.channelId, imageId: reference.id }); setReferences((current) => current.filter((row) => row.id !== reference.id)); onNotice?.('Removed the image example.'); }
    catch (failure) { setProblem(failure?.message || 'That example couldn’t be removed.'); }
    finally { setPending(''); }
  }
  return <div className="channel-image-examples" data-spot="channel.image-examples">
    <p className="studio-hint">Show the visual styles that work for {data.channelName}. Future pictures use these examples and their descriptions alongside the brand rules. PNG, JPEG or WebP, up to 10 MB each; up to four examples.</p>
    <div className="channel-example-list">{references.map((reference) => {
      const draft = drafts[reference.id] ?? reference.description;
      return <section className="cs-panel channel-example" key={reference.id} aria-label={reference.name}>
        {pictures[reference.id] ? <img src={pictures[reference.id]} alt={`Example: ${reference.name}`} /> : <div className="channel-example-placeholder" role="status">Loading image…</div>}
        <div className="channel-example-copy"><strong>{reference.name}</strong><label className="studio-field"><span className="sr-only">Description for {reference.name}</span><textarea rows={3} maxLength={2000} disabled={viewer.preview || !mayEdit} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [reference.id]: event.target.value }))} /></label>
          <div className="channel-actions">{mayRemove && <button type="button" className="studio-quiet" aria-label={`Remove ${reference.name}`} {...writeProps(viewer, Boolean(pending))} onClick={() => remove(reference)}><Trash2 size={15} aria-hidden="true" />Remove</button>}{mayEdit && <button type="button" className="studio-primary" aria-label={`Save description for ${reference.name}`} {...writeProps(viewer, Boolean(pending) || !draft.trim() || draft.trim() === reference.description)} onClick={() => update(reference)}><Save size={15} aria-hidden="true" />Save description</button>}</div>
        </div>
      </section>;
    })}</div>
    {!references.length && <p className="studio-hint">No image examples yet. Add a post or design that worked well, and explain why.</p>}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {mayAdd && references.length < 4 && <form className="cs-panel channel-example-add" onSubmit={add}><label className="studio-field"><span>Why this example works</span><textarea rows={3} maxLength={2000} required disabled={viewer.preview || Boolean(pending)} value={description} placeholder="This post performed well last week. The bold headline and simple product layout work well for our audience." onChange={(event) => setDescription(event.target.value)} /></label><div className="channel-actions"><button type="submit" className="studio-primary" {...writeProps(viewer, Boolean(pending) || !description.trim() || typeof api.addChannelReference !== 'function')}>{pending === 'add' ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}Choose image and save example</button></div></form>}
    {references.length >= 4 && <p className="studio-hint">Four examples saved. Remove one before adding another.</p>}
  </div>;
}

function KnowledgeForm({ api, data, viewer, onNotice }) {
  const [values, setValues] = useState(data.knowledge || {});
  const [saved, setSaved] = useState(data.knowledge || {}); // what the server has, so the save bar leaves once it's saved
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const changes = viewer.preview ? 0 : list(data.fields).filter((field) => (values[field.id] || '') !== (saved[field.id] || '')).length;
  async function save(event) {
    event?.preventDefault?.(); if (!changes) return;
    setSaving(true); setProblem('');
    try { await api.saveChannelKnowledge({ channelId: data.channelId, knowledge: values }); setSaved({ ...values }); onNotice?.(`Saved ${data.channelName}’s channel knowledge. New assets for it use it.`); }
    catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  return <form id="channel-knowledge-form" className="channel-knowledge" onSubmit={save} data-spot="channel.knowledge">
    <SaveBar changes={changes} form="channel-knowledge-form" saving={saving} saveLabel="Save channel knowledge" onDiscard={() => { setValues({ ...saved }); setProblem(''); }} />
    <p className="studio-hint">The AI reads this when it writes {data.channelName}’s assets, after the studio’s brand knowledge.{data.updatedAt ? ` Last saved ${formatDay(data.updatedAt)}${data.updatedBy?.name ? ` by ${data.updatedBy.name}` : ''}.` : ''}</p>
    {list(data.fields).map((field) => <label key={field.id} className="studio-field"><span>{field.label}</span>
      <textarea rows={field.id === 'examples' ? 6 : 3} maxLength={field.limit} value={values[field.id] || ''} placeholder={field.placeholder} disabled={viewer.preview} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} /></label>)}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
  </form>;
}

const TYPE_ICONS = { text: FileText, image: Image, video: Video };
const TYPE_LABELS = { text: 'Written', image: 'Image', video: 'Video' };

function InstructionsTab({ api, data, viewer, channels = [], onOpenChannel, onNotice, onSaved }) {
  const confirm = useConfirm();
  const detailId = useId();
  const inspection = useRef(null);
  const [selected, select] = useState('');
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [drafts, setDrafts] = useState({}); // promptId → { blockId: text }
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const prompts = list(data.prompts);
  const savedTypes = list(data.assetTypes);
  const formats = data.formats || prompts.map(detail => ({ id: detail.prompt.id, kind: 'text', name: detail.prompt.name, promptId: detail.prompt.id }));
  const types = [...formats, ...savedTypes.filter(type => !type.archived).map(type => ({ ...type, kind: 'text', customType: true }))];
  const current = types.find(type => type.id === selected) || types[0];
  const detail = prompts.find(row => row.prompt.id === current?.promptId);
  const mayManageTypes = can(viewer, 'saveChannelAssetType') && typeof api.saveChannelAssetType === 'function';
  const mayEditInstructions = can(viewer, 'saveChannelInstructions');
  const readOnlyAll = Boolean(data.custom) || viewer.preview;
  const changedOf = (detail) => Object.fromEntries(Object.entries(drafts[detail.prompt.id] || {}).filter(([blockId, text]) => text !== (detail.blocks?.[blockId] ?? '')));
  const changedPrompts = readOnlyAll || !mayEditInstructions ? [] : prompts.filter((detail) => !detail.lockedForYou && Object.keys(changedOf(detail)).length);
  const changes = changedPrompts.reduce((sum, detail) => sum + Object.keys(changedOf(detail)).length, 0);
  // Where a borrowed prompt's own channel is: the built-in channel whose formats include it (assets.<format>).
  const ownerOf = (detail) => { const format = String(detail.prompt?.id || '').replace(/^assets\./, ''); const folder = KIT.folders.find((row) => !row.custom && list(row.deliverables).includes(format)); return folder ? list(channels).find((row) => row.id === folder.id) || { id: folder.id, name: folder.general } : null; };
  async function saveAll() {
    const saved = new Set();
    setSaving(true); setProblem('');
    try {
      for (const detail of changedPrompts) {
        await api.saveChannelInstructions({ channelId: data.channelId, promptId: detail.prompt.id, blocks: changedOf(detail), expectedVersion: detail.version, note: note.trim() || 'Changed in Channels' });
        saved.add(detail.prompt.id);
      }
      onNotice?.(changedPrompts.length === 1 ? `Saved “${changedPrompts[0].prompt.name}”. New assets use it.` : `Saved ${changedPrompts.length} instructions. New assets use them.`);
      setNote('');
    } catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally {
      if (saved.size) {
        setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !saved.has(id))));
        onSaved?.();
      }
      setSaving(false);
    }
  }
  async function restore(detail, version) {
    setSaving(true); setProblem('');
    try { await api.revertChannelInstructions({ channelId: data.channelId, promptId: detail.prompt.id, toVersion: version, expectedVersion: detail.version }); setDrafts((current) => ({ ...current, [detail.prompt.id]: {} })); onNotice?.(`Restored version ${version} of “${detail.prompt.name}”.`); onSaved?.(); }
    catch (failure) { setProblem(failure?.message || 'That couldn’t be restored. Try again.'); }
    finally { setSaving(false); }
  }
  async function setArchived(type, archived) {
    if (viewer.preview || archiving) return;
    if (archived && !(await confirm({ title: `Archive “${type.name}”?`, lines: ['This removes the type from new asset sets. You can restore it here, and existing assets stay available.'], confirmLabel: 'Archive asset type', tone: 'danger' }))) return;
    setArchiving(true); setProblem('');
    try {
      await api.saveChannelAssetType({ channelId: data.channelId, assetTypeId: type.id, revision: type.revision, archived });
      select(archived ? '' : type.id); onSaved?.(); onNotice?.(`${archived ? 'Archived' : 'Restored'} “${type.name}”.`);
    } catch (failure) { setProblem(failure?.message || 'That asset type couldn’t be updated. Try again.'); }
    finally { setArchiving(false); }
  }
  const archived = savedTypes.filter(type => type.archived);
  function inspect(type) {
    select(type.id);
    if (window.matchMedia?.('(max-width: 680px)').matches) window.requestAnimationFrame(() => {
      inspection.current?.focus({ preventScroll: true });
      inspection.current?.scrollIntoView({ block: 'start' });
    });
  }
  return <div className="channel-prompts" data-spot="channel.asset-types">
    <header className="channel-types-head">
      <div><h2>Asset types</h2><p>Choose a format to see its output and instructions. These formats appear in Make channel assets.</p></div>
      {mayManageTypes && !editing && <button type="button" className="simple-primary" {...writeProps(viewer)} onClick={() => setEditing({})}><Plus size={16} aria-hidden="true" />Add asset type</button>}
    </header>
    <SaveBar changes={changes} saving={saving} saveLabel={changes && changedPrompts.length > 1 ? 'Save instructions' : 'Save instruction'} onSave={saveAll} onDiscard={() => { setDrafts({}); setNote(''); setProblem(''); }} />
    {changes > 0 && <label className="studio-field channel-history-note"><span>Note for the history</span><input value={note} maxLength={200} disabled={saving} placeholder="What changed, and why" onChange={(event) => setNote(event.target.value)} /></label>}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {editing ? <AssetTypeForm api={api} channelId={data.channelId} assetType={editing} onCancel={() => setEditing(null)} onSaved={(type) => { setEditing(null); select(type.id); onSaved?.(); onNotice?.(`Saved “${type.name}”. It is available in Make channel assets.`); }} /> :
      <div className="channel-types-grid">
        <div>
          {types.length > 0 && <ul className="channel-type-list" aria-label="Available asset types">{types.map(type => {
            const Icon = TYPE_ICONS[type.kind] || FileText;
            return <li key={type.id}><button type="button" aria-pressed={current?.id === type.id} aria-controls={detailId} onClick={() => inspect(type)}><span className="channel-type-icon"><Icon size={18} aria-hidden="true" /></span><span><strong>{type.name}</strong><small>{type.customType ? 'Custom · Written' : TYPE_LABELS[type.kind]}</small></span><ChevronRight size={15} aria-hidden="true" /></button></li>;
          })}</ul>}
          {mayManageTypes && archived.length > 0 && <details className="channel-history channel-type-archive"><summary><Archive size={14} aria-hidden="true" />{plural(archived.length, 'archived type')}</summary><ul>{archived.map(type => <li key={type.id}><span>{type.name}</span><button type="button" className="simple-link" {...writeProps(viewer, archiving)} onClick={() => setArchived(type, false)}>Restore</button></li>)}</ul></details>}
        </div>
        {!current ? <EmptyBlock title="No asset types yet">Add a format to use it when making channel assets.</EmptyBlock> :
          <section ref={inspection} id={detailId} tabIndex={-1} className="channel-type-detail" aria-label={current.name}>
            <header><div><p>{current.customType ? 'Custom written format' : `${TYPE_LABELS[current.kind] || 'Asset'} format`}</p><h3>{current.name}</h3></div>{current.customType && mayManageTypes && <div className="channel-actions"><button type="button" className="studio-quiet" {...writeProps(viewer, archiving)} onClick={() => setEditing(current)}><Pencil size={14} aria-hidden="true" />Edit type</button><button type="button" className="studio-quiet" {...writeProps(viewer, archiving)} onClick={() => setArchived(current, true)}><Archive size={14} aria-hidden="true" />Archive</button></div>}</header>
            {list(current.sections).length > 0 && <div className="channel-type-sections"><h4>Output sections</h4><ol>{current.sections.map((heading, index) => <li key={index}>{heading}</li>)}</ol></div>}
            {current.customType ? <div className="channel-type-sections"><h4>Writing instructions</h4><p className="channel-type-instruction">{current.instruction}</p></div> :
              detail ? <InstructionCard key={`${detail.prompt.id}:${detail.version}`} detail={detail} viewer={viewer} readOnly={readOnlyAll || !mayEditInstructions} owner={data.custom ? ownerOf(detail) : null} onOpenChannel={onOpenChannel} draftOf={(blockId) => drafts[detail.prompt.id]?.[blockId]} onDraft={(blockId, text) => setDrafts((current) => ({ ...current, [detail.prompt.id]: { ...(current[detail.prompt.id] || {}), [blockId]: text } }))} saving={saving} onRestore={(version) => restore(detail, version)} /> :
                <div className="channel-type-sections"><h4>Generation guidance</h4><p>{current.kind === 'image' ? 'Image generation uses the studio’s visual prompts and this channel’s image examples.' : 'Short video uses the studio’s video prompts. Select it when making channel assets to include it in a set.'}</p>{can(viewer, 'listPrompts') && <a className="simple-link" href="#/studio/prompts">Open Prompt Library <ChevronRight size={13} aria-hidden="true" /></a>}</div>}
          </section>}
      </div>}
  </div>;
}

function AssetTypeForm({ api, channelId, assetType, onCancel, onSaved }) {
  const [name, setName] = useState(assetType.name || '');
  const [sections, setSections] = useState(list(assetType.sections).join('\n'));
  const [instruction, setInstruction] = useState(assetType.instruction || '');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState('');
  const title = assetType.id ? 'Edit asset type' : 'New asset type';
  async function save(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setProblem('');
    try {
      const result = await api.saveChannelAssetType({ channelId, assetTypeId: assetType.id, revision: assetType.revision, name, sections: sections.split('\n').map(value => value.trim()).filter(Boolean), instruction });
      onSaved(result.assetType);
    } catch (failure) { setProblem(failure?.message || 'This asset type couldn’t be saved. Try again.'); }
    finally { setPending(false); }
  }
  return <form className="channel-type-detail channel-type-form" aria-label={title} onSubmit={save}>
    <header><div><p>Custom written format</p><h3>{title}</h3></div></header>
    <label className="studio-field"><span>Asset type name</span><input autoFocus required maxLength={80} disabled={pending} value={name} placeholder="e.g. LinkedIn carousel brief" onChange={event => setName(event.target.value)} /></label>
    <label className="studio-field"><span>Output sections</span><textarea required rows={4} disabled={pending} value={sections} placeholder={'Opening hook\nSlide outline\nCall to action'} onChange={event => setSections(event.target.value)} /><small>One heading per line, in the order they should appear. Use up to 12.</small></label>
    <label className="studio-field"><span>Writing instructions</span><textarea required rows={5} maxLength={8000} disabled={pending} value={instruction} placeholder="Describe what to write, the intended audience, and any length or style requirements." onChange={event => setInstruction(event.target.value)} /><small>Used alongside brand and channel knowledge when a draft is generated.</small></label>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    <div className="channel-actions"><button type="button" className="studio-quiet" disabled={pending} onClick={onCancel}>Cancel</button><button type="submit" className="simple-primary" disabled={pending}>{pending ? 'Saving…' : 'Save asset type'}</button></div>
  </form>;
}

// One prompt that writes this channel's assets: its editable parts (the tab keeps the drafts) and earlier versions to
// restore. Read only (locked by an admin, or borrowed by an added channel) shows the text as text.
function InstructionCard({ detail, viewer, readOnly = false, owner = null, onOpenChannel, draftOf, onDraft, saving, onRestore }) {
  const titleId = useId();
  const editable = list(detail.prompt?.blocks).filter((block) => block.editable && Object.prototype.hasOwnProperty.call(detail.blocks || {}, block.id));
  const locked = Boolean(detail.lockedForYou) || readOnly;
  return <section className="channel-prompt channel-type-sections" aria-labelledby={titleId}>
    <div className="cs-panel-title"><div><h4 id={titleId}>Writing instructions</h4><p>{detail.version ? `Version ${detail.version}${detail.updatedBy?.name ? `, saved by ${detail.updatedBy.name}` : ''}${detail.updatedAt ? ` on ${formatDay(detail.updatedAt)}` : ''}` : owner ? `Shared with ${owner.name}` : 'Studio default'}{detail.lockedForYou ? ' · Locked by an admin' : ''}</p></div>
      {owner && onOpenChannel && <button type="button" className="studio-quiet" onClick={() => onOpenChannel(owner.id)}>Open {owner.name}</button>}</div>
    {editable.map((block) => <div key={block.id} className="studio-field"><span>{block.label}</span>
      {locked ? <div className="channel-readonly-text">{detail.blocks?.[block.id] ?? ''}</div>
        : <textarea rows={6} aria-label={`${detail.prompt?.name}: ${block.label}`} value={draftOf(block.id) ?? detail.blocks?.[block.id] ?? ''} disabled={saving} onChange={(event) => onDraft(block.id, event.target.value)} />}</div>)}
    {list(detail.history).length > 1 && <details className="channel-history"><summary><History size={14} aria-hidden="true" />Earlier versions</summary>
      <ul>{list(detail.history).filter((row) => row.version !== detail.version).map((row) => <li key={row.version}><span>Version {row.version}{row.by?.name ? `, ${row.by.name}` : ''}{row.at ? `, ${formatDay(row.at)}` : ''}{row.note ? `: ${row.note}` : ''}</span>
        {!locked && <button type="button" className="simple-link" {...writeProps(viewer, saving)} onClick={() => onRestore(row.version)}>Restore</button>}</li>)}</ul>
    </details>}
  </section>;
}

// Every channel in one table. Each channel's settings are read once (free), and the owners come from People when this
// role can read it; without it the Owner column is left out.
export function knowledgeFilled(data) {
  const fields = list(data?.fields);
  return { filled: fields.filter((field) => String(data?.knowledge?.[field.id] || '').trim()).length, total: fields.length };
}
const assetCount = (data) => list(data.formats || data.prompts).length + list(data.assetTypes).filter(type => !type.archived).length;
function ChannelTable({ api, channels = [], formats = [], onOpen, onNotice }) {
  const viewer = useViewer();
  const [adding, setAdding] = useState(false);
  const mayAdd = can(viewer, 'saveCustomChannel') && typeof api?.saveCustomChannel === 'function' && list(formats).length > 0;
  const [rows, setRows] = useState({}); // channelId → settings, or { problem }
  const [owners, setOwners] = useState(null); // channelId → [name], null when People can't be read
  const ids = list(channels).map((row) => row.id).join('|');
  useEffect(() => {
    if (typeof api?.readChannelSettings !== 'function') return undefined;
    let live = true; setRows({});
    for (const channel of list(channels)) Promise.resolve().then(() => api.readChannelSettings({ channelId: channel.id })).then((result) => { if (live) setRows((current) => ({ ...current, [channel.id]: result || {} })); }, (failure) => { if (live) setRows((current) => ({ ...current, [channel.id]: { problem: failure?.message || 'Couldn’t be loaded' } })); });
    return () => { live = false; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof api?.getTeam !== 'function') return undefined;
    let live = true;
    Promise.resolve().then(() => api.getTeam()).then((team) => { if (!live) return; const map = {}; for (const member of list(team?.members)) if (!member.disabled && member.base === 'channel' && member.channelId) (map[member.channelId] ||= []).push(member.name); setOwners(map); }, () => {});
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = list(channels).filter((channel) => rows[channel.id] && !rows[channel.id].problem);
  const empty = loaded.filter((channel) => knowledgeFilled(rows[channel.id]).filled === 0).length;
  const unowned = owners ? list(channels).filter((channel) => !list(owners[channel.id]).length).length : 0;
  return <div className="simple-page channel-settings" data-spot="channel.settings">
    <div className="simple-page-head"><div><h1>Channels</h1><p>Each channel’s knowledge and the instructions that write its assets. Channel owners edit their own.</p></div>{mayAdd && !adding && <div className="simple-head-actions"><button type="button" className="simple-primary" {...writeProps(viewer)} onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />Add channel</button></div>}</div>
    {adding && <ChannelForm api={api} formats={formats} onCancel={() => setAdding(false)} onSaved={(saved) => { setAdding(false); onNotice?.(`Added “${saved?.name || 'the channel'}”. Tell it about its audience and format below.`); if (saved?.id) onOpen(saved.id); }} />}
    {/* One notice for what needs doing; the table itself states facts in plain grey, never alarm red. */}
    {unowned > 0 && <div className="channel-notice" role="status"><span><strong>{unowned === list(channels).length ? 'No channel has an owner yet.' : `${unowned} ${unowned === 1 ? 'channel has' : 'channels have'} no owner.`}</strong> Owners get their channel’s briefs and say what they used.</span><a className="studio-quiet" href="#/studio/people">Assign owners</a></div>}
    {loaded.length === list(channels).length && empty > 0 && <p className="channel-table-note">{empty === list(channels).length ? 'No channel has channel knowledge yet' : `${empty} of ${list(channels).length} ${empty === 1 ? 'has' : 'have'} no channel knowledge yet`}: their assets are written from the brand knowledge alone.</p>}
    {list(channels).length ? <div className="simple-file-table-wrap"><table className="simple-file-table channel-table">
      <thead><tr><th scope="col">Channel</th>{owners && <th scope="col">Owner</th>}<th scope="col">Channel knowledge</th><th scope="col">Asset types</th><th scope="col">Last saved</th></tr></thead>
      <tbody>{list(channels).map((channel) => { const data = rows[channel.id]; const fill = data && !data.problem ? knowledgeFilled(data) : null; const own = list(owners?.[channel.id]); return <tr key={channel.id} className="channel-row" onClick={(event) => { if (!event.target.closest('button, a')) onOpen(channel.id); }}>
        <th scope="row"><button type="button" className="simple-file-open" onClick={() => onOpen(channel.id)}>{channel.name}</button>{isCustomChannel(channel.id) && <span className="channel-added-tag">Added</span>}</th>
        {owners && <td>{own.length ? own.join(', ') : <span className="channel-table-none">None</span>}</td>}
        <td>{!data ? 'Loading…' : data.problem ? data.problem : fill.filled === 0 ? <span className="channel-table-none">None yet</span> : `${fill.filled} of ${fill.total} filled in`}</td>
        <td>{fill ? plural(assetCount(data), 'asset type') : ''}</td>
        <td className="simple-file-date">{fill && data.updatedAt ? `${formatDay(data.updatedAt)}${data.updatedBy?.name ? `, ${data.updatedBy.name}` : ''}` : fill ? 'Never' : ''}</td>
      </tr>; })}</tbody>
    </table></div> : <EmptyBlock title="No channels yet" action={mayAdd ? <button type="button" className="simple-primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />Add channel</button> : null}>Channels are where the team publishes. Each gets its own knowledge, owner and assets.</EmptyBlock>}
    {/* Under 600px the table is a list: the name, then its facts on one line; the whole row opens the channel. */}
    {list(channels).length > 0 && <ul className="channel-list-narrow" aria-label="Channels">{list(channels).map((channel) => { const data = rows[channel.id]; const fill = data && !data.problem ? knowledgeFilled(data) : null; const own = list(owners?.[channel.id]); return <li key={channel.id}><button type="button" onClick={() => onOpen(channel.id)}><strong>{channel.name}{isCustomChannel(channel.id) && <span className="channel-added-tag">Added</span>}</strong><small>{[owners ? (own.length ? own.join(', ') : 'No owner') : '', !data ? 'Loading…' : data.problem ? data.problem : fill.filled === 0 ? 'No knowledge yet' : `Knowledge ${fill.filled} of ${fill.total}`, fill ? plural(assetCount(data), 'asset type') : ''].filter(Boolean).join(', ')}</small></button></li>; })}</ul>}
  </div>;
}


// Add channel / Edit channel: a name, a short name for narrow columns, and up to four built-in kinds of written asset the
// channel makes (each writes with that format's instructions plus this channel's own knowledge). Saving goes through
// saveCustomChannel (custom-channels.js on the server).
function ChannelForm({ api, formats = [], channel = null, onCancel, onSaved }) {
  const viewer = useViewer();
  const nameId = useId(); const shortId = useId(); const groupId = useId();
  const [name, setName] = useState(channel?.name || '');
  const [short, setShort] = useState(channel?.short && channel.short !== channel.name ? channel.short : '');
  const [picked, setPicked] = useState(() => new Set(list(channel?.formats)));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [nameError, setNameError] = useState('');
  const [formatError, setFormatError] = useState('');
  const toggle = (id) => { setFormatError(''); setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 4) next.add(id); return next; }); };
  async function submit(event) {
    event.preventDefault(); setProblem('');
    const missingName = !name.trim(); const missingFormat = !picked.size;
    setNameError(missingName ? 'Name the channel.' : ''); setFormatError(missingFormat ? 'Choose at least one kind of asset.' : '');
    if (missingName) { document.getElementById(nameId)?.focus(); return; }
    if (missingFormat) return;
    setSaving(true);
    try {
      const result = await api.saveCustomChannel({ ...(channel?.id ? { channelId: channel.id } : {}), name: name.trim(), short: short.trim(), formats: [...picked] });
      onSaved?.(result?.channel || { name: name.trim() });
    } catch (failure) { setProblem(failure?.message || 'That channel couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  return <form className="cs-panel channel-form" onSubmit={submit} aria-label={channel?.id ? 'Edit channel' : 'Add a channel'}>
    <div className="cs-panel-title"><div><h3>{channel?.id ? 'Edit channel' : 'Add a channel'}</h3><p>Name it and choose what it makes. Each kind of asset writes with the built-in format’s instructions plus this channel’s own knowledge, which you can add next.</p></div></div>
    <div className="channel-form-names">
      <label className="studio-field" htmlFor={nameId}><span>Channel name</span><input id={nameId} value={name} maxLength={60} placeholder="e.g. Podcast" disabled={saving} aria-invalid={nameError ? 'true' : undefined} aria-describedby={nameError ? `${nameId}-error` : undefined} onChange={(event) => { setName(event.target.value); setNameError(''); }} />{nameError && <small id={`${nameId}-error`} className="channel-field-error" role="alert">{nameError}</small>}</label>
      <label className="studio-field" htmlFor={shortId}><span>Short name <small>Optional, for narrow columns</small></span><input id={shortId} value={short} maxLength={24} placeholder={name.trim().slice(0, 24) || 'e.g. Podcast'} disabled={saving} onChange={(event) => setShort(event.target.value)} /></label>
    </div>
    <fieldset className="channel-form-formats" aria-describedby={groupId} disabled={saving}>
      <legend>What it makes</legend>
      <p id={groupId} className="studio-hint">Choose up to four. {picked.size ? `${picked.size} chosen.` : ''}</p>{formatError && <small className="channel-field-error" role="alert">{formatError}</small>}
      <div className="channel-format-grid">{list(formats).map((format) => <label key={format.id} className={`channel-format${picked.has(format.id) ? ' is-on' : ''}`}><input type="checkbox" checked={picked.has(format.id)} disabled={!picked.has(format.id) && picked.size >= 4} onChange={() => toggle(format.id)} /><span><strong>{format.label}</strong><small>Like {format.channel}</small></span></label>)}</div>
    </fieldset>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    <div className="channel-actions"><button type="button" className="studio-quiet" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" className="simple-primary" {...writeProps(viewer, saving)}>{saving ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}{channel?.id ? 'Save channel' : 'Add channel'}</button></div>
  </form>;
}
