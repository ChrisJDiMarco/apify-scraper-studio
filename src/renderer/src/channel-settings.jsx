import React, { useEffect, useId, useState } from 'react';
import { ArrowLeft, ArrowRight, History, ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { can, formatDay, useViewer, writeProps } from './viewer.js';
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
export function ChannelSettings({ api, channels = [], channelId: fixed = '', onNotice }) {
  const viewer = useViewer();
  const pickId = useId();
  const [channelId, setChannelId] = useState(fixed || '');
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState('knowledge');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!channelId || typeof api?.readChannelSettings !== 'function') return undefined;
    let live = true; setData(null); setProblem('');
    Promise.resolve(api.readChannelSettings({ channelId })).then((result) => { if (live) setData(result || null); }, (failure) => { if (live) setProblem(failure?.message || 'This channel’s settings couldn’t be loaded.'); });
    return () => { live = false; };
  }, [channelId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = data?.channelName || list(channels).find((row) => row.id === channelId)?.name || 'this channel';
  if (!fixed && !channelId) return <ChannelTable api={api} channels={channels} onOpen={setChannelId} />;
  return <div className="simple-page channel-settings" data-spot="channel.settings">
    {!fixed && <button type="button" className="simple-back" onClick={() => setChannelId('')}><ArrowLeft size={15} aria-hidden="true" />All channels</button>}
    <div className="simple-page-head"><div><h1>{fixed ? 'My channel' : name === 'this channel' ? 'Channel' : name}</h1><p>{fixed ? `What ${name}’s assets should know about the channel, and the instructions that write them.` : 'This channel’s knowledge and the instructions that write its assets. Its owner can edit them too.'}</p></div>
      {!fixed && list(channels).length > 0 && <div className="simple-head-actions"><label className="cs-program-pick" htmlFor={pickId}><span className="sr-only">Channel</span><select id={pickId} className="simple-program-pick" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>}</div>
    <div className="simple-segment" role="tablist" aria-label="Channel settings">{[['knowledge', 'Channel knowledge'], ['images', 'Image examples'], ['instructions', 'Asset instructions']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {!data && !problem && <p className="studio-hint" role="status">Loading {name}…</p>}
    {data && tab === 'knowledge' && <KnowledgeForm key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'images' && <ChannelImages key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'instructions' && <div className="channel-prompts">
      {!data.prompts.length && <p className="studio-hint">No asset instructions for {name} in this edition.</p>}
      {data.prompts.map((detail) => <InstructionCard key={`${detail.prompt.id}:${detail.version}`} api={api} channelId={data.channelId} detail={detail} viewer={viewer} onNotice={onNotice} onSaved={() => setReload((value) => value + 1)} />)}
    </div>}
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
  const [saved, setSaved] = useState(data.knowledge || {}); // what the server has, so Save turns off once it's saved
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const dirty = list(data.fields).some((field) => (values[field.id] || '') !== (saved[field.id] || ''));
  async function save(event) {
    event.preventDefault(); setSaving(true); setProblem('');
    try { await api.saveChannelKnowledge({ channelId: data.channelId, knowledge: values }); setSaved({ ...values }); onNotice?.(`Saved ${data.channelName}’s channel knowledge. New assets for it use it.`); }
    catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  return <form className="channel-knowledge" onSubmit={save} data-spot="channel.knowledge">
    <p className="studio-hint">The AI reads this when it writes {data.channelName}’s assets, after the studio’s brand knowledge.{data.updatedAt ? ` Last saved ${formatDay(data.updatedAt)}${data.updatedBy?.name ? ` by ${data.updatedBy.name}` : ''}.` : ''}</p>
    {list(data.fields).map((field) => <label key={field.id} className="studio-field"><span>{field.label}</span>
      <textarea rows={field.id === 'examples' ? 6 : 3} maxLength={field.limit} value={values[field.id] || ''} placeholder={field.placeholder} disabled={viewer.preview} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} /></label>)}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    <div className="channel-actions"><button type="submit" className="simple-primary" {...writeProps(viewer, saving || !dirty)}><Save size={15} aria-hidden="true" />Save channel knowledge</button></div>
  </form>;
}

// One prompt that writes this channel's assets: its editable parts, a note for the history, Save, and earlier versions to
// restore. A prompt an admin locked is shown read-only to anyone else.
function InstructionCard({ api, channelId, detail, viewer, onNotice, onSaved }) {
  const titleId = useId();
  const editable = list(detail.prompt?.blocks).filter((block) => block.editable && Object.prototype.hasOwnProperty.call(detail.blocks || {}, block.id));
  const [drafts, setDrafts] = useState({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const locked = Boolean(detail.lockedForYou);
  const changed = Object.fromEntries(Object.entries(drafts).filter(([blockId, text]) => text !== (detail.blocks?.[blockId] ?? '')));
  async function run(call, line) {
    setSaving(true); setProblem('');
    try { await call(); setDrafts({}); setNote(''); onNotice?.(line); onSaved?.(); }
    catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  const save = () => run(() => api.saveChannelInstructions({ channelId, promptId: detail.prompt.id, blocks: changed, expectedVersion: detail.version, note: note.trim() || 'Changed in My channel' }), `Saved “${detail.prompt.name}”.`);
  const restore = (version) => run(() => api.revertChannelInstructions({ channelId, promptId: detail.prompt.id, toVersion: version, expectedVersion: detail.version }), `Restored version ${version} of “${detail.prompt.name}”.`);
  return <section className="cs-panel channel-prompt" aria-labelledby={titleId}>
    <div className="cs-panel-title"><div><h3 id={titleId}>{detail.prompt?.name}</h3><p>{detail.version ? `Version ${detail.version}${detail.updatedBy?.name ? ` · ${detail.updatedBy.name}` : ''}${detail.updatedAt ? ` · ${formatDay(detail.updatedAt)}` : ''}` : 'The studio’s default text'}{locked ? ' · Locked by an admin' : ''}</p></div></div>
    {editable.map((block) => <label key={block.id} className="studio-field"><span>{block.label}</span>
      <textarea rows={6} value={drafts[block.id] ?? detail.blocks?.[block.id] ?? ''} disabled={locked || viewer.preview} onChange={(event) => setDrafts((current) => ({ ...current, [block.id]: event.target.value }))} /></label>)}
    {!locked && Object.keys(changed).length > 0 && <label className="studio-field"><span>Note for the history</span><input value={note} maxLength={200} placeholder="What changed, and why" onChange={(event) => setNote(event.target.value)} /></label>}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {!locked && <div className="channel-actions"><button type="button" className="simple-primary" {...writeProps(viewer, saving || !Object.keys(changed).length)} onClick={save}><Save size={15} aria-hidden="true" />Save instructions</button></div>}
    {list(detail.history).length > 1 && <details className="channel-history"><summary><History size={14} aria-hidden="true" />Earlier versions</summary>
      <ul>{list(detail.history).filter((row) => row.version !== detail.version).map((row) => <li key={row.version}><span>Version {row.version}{row.by?.name ? ` · ${row.by.name}` : ''}{row.at ? ` · ${formatDay(row.at)}` : ''}{row.note ? ` · ${row.note}` : ''}</span>
        {!locked && <button type="button" className="simple-link" {...writeProps(viewer, saving)} onClick={() => restore(row.version)}>Restore</button>}</li>)}</ul>
    </details>}
  </section>;
}

// Every channel in one table. Each channel's settings are read once (free), and the owners come from People when this
// role can read it; without it the Owner column is left out.
export function knowledgeFilled(data) {
  const fields = list(data?.fields);
  return { filled: fields.filter((field) => String(data?.knowledge?.[field.id] || '').trim()).length, total: fields.length };
}
function ChannelTable({ api, channels = [], onOpen }) {
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
  const summary = [loaded.length === list(channels).length && empty ? `${empty} of ${list(channels).length} ${empty === 1 ? 'has' : 'have'} no channel knowledge yet` : '', unowned ? `${unowned} ${unowned === 1 ? 'has' : 'have'} no owner` : ''].filter(Boolean).join(', and ');
  return <div className="simple-page channel-settings" data-spot="channel.settings">
    <div className="simple-page-head"><div><h1>Channels</h1><p>Each channel’s knowledge and the instructions that write its assets. Channel owners edit their own.</p></div></div>
    {summary && <p className="channel-table-note" role="status">{summary.replace(/^./, (letter) => letter.toUpperCase())}. Assets for a channel with no knowledge are written from the brand knowledge alone.</p>}
    {list(channels).length ? <div className="simple-file-table-wrap"><table className="simple-file-table channel-table">
      <thead><tr><th scope="col">Channel</th>{owners && <th scope="col">Owner</th>}<th scope="col">Channel knowledge</th><th scope="col">Asset instructions</th><th scope="col">Last saved</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{list(channels).map((channel) => { const data = rows[channel.id]; const fill = data && !data.problem ? knowledgeFilled(data) : null; const own = list(owners?.[channel.id]); return <tr key={channel.id}>
        <th scope="row"><button type="button" className="simple-file-open" onClick={() => onOpen(channel.id)}>{channel.name}</button></th>
        {owners && <td>{own.length ? own.join(', ') : <span className="channel-table-none">No owner</span>}</td>}
        <td>{!data ? 'Loading…' : data.problem ? data.problem : fill.filled === 0 ? <span className="channel-table-none">Empty</span> : `${fill.filled} of ${fill.total} filled in`}</td>
        <td>{fill ? `${list(data.prompts).length} ${list(data.prompts).length === 1 ? 'prompt' : 'prompts'}` : ''}</td>
        <td className="simple-file-date">{fill && data.updatedAt ? `${formatDay(data.updatedAt)}${data.updatedBy?.name ? ` · ${data.updatedBy.name}` : ''}` : fill ? 'Never' : ''}</td>
        <td className="program-run-open"><button type="button" className="simple-link" aria-label={`Open ${channel.name}`} onClick={() => onOpen(channel.id)}>Open<ArrowRight size={14} aria-hidden="true" /></button></td>
      </tr>; })}</tbody>
    </table></div> : <div className="simple-empty"><p>This edition has no channels.</p></div>}
  </div>;
}
