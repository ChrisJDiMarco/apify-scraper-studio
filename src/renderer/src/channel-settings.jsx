import React, { useEffect, useId, useState } from 'react';
import { ArrowLeft, History, ImagePlus, LoaderCircle, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import KIT, { customChannelList, isCustomChannel } from '../../shared/channel-table.js';
import { EmptyBlock, SaveBar } from './studio-kit.jsx';
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
    let live = true; setData(null); setProblem('');
    Promise.resolve(api.readChannelSettings({ channelId })).then((result) => { if (live) setData(result || null); }, (failure) => { if (live) setProblem(failure?.message || 'This channel’s settings couldn’t be loaded.'); });
    return () => { live = false; };
  }, [channelId, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTab('knowledge'); setEditing(false); }, [channelId]); // another channel opens on its knowledge
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
    <div className="simple-page-head"><div><h1>{fixed ? 'My channel' : name === 'this channel' ? 'Channel' : name}</h1><p>{fixed ? `What ${name}’s assets should know about the channel, and the instructions that write them.` : 'This channel’s knowledge and the instructions that write its assets. Its owner can edit them too.'}</p></div>
      {!fixed && list(channels).length > 0 && <div className="simple-head-actions">{mayManage && <><button type="button" className="studio-quiet" {...writeProps(viewer)} onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" />Edit channel</button><button type="button" className="studio-quiet" {...writeProps(viewer)} onClick={remove}><Trash2 size={14} aria-hidden="true" />Remove</button></>}<label className="cs-program-pick" htmlFor={pickId}><span className="sr-only">Channel</span><select id={pickId} className="simple-program-pick" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>}</div>
    {editing && mayManage && <ChannelForm api={api} formats={formats} channel={{ id: channelId, name: current?.name || name, short: current?.short || '', formats: list(customChannelList().find((row) => row.id === channelId)?.formats) }} onCancel={() => setEditing(false)} onSaved={(saved) => { setEditing(false); onNotice?.(`Saved “${saved?.name || name}”.`); setReload((value) => value + 1); }} />}
    <div className="people-tabs channel-tabs" role="tablist" aria-label="Channel settings">{[['knowledge', 'Channel knowledge'], ['images', 'Image examples'], ['instructions', 'Asset instructions']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {!data && !problem && <p className="studio-hint" role="status">Loading {name}…</p>}
    {data && tab === 'knowledge' && <KnowledgeForm key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'images' && <ChannelImages key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'instructions' && <InstructionsTab key={`${data.channelId}:${reload}`} api={api} data={data} viewer={viewer} channels={channels} onOpenChannel={fixed ? undefined : setChannelId} onNotice={onNotice} onSaved={() => setReload((value) => value + 1)} />}
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

// The Asset instructions tab: every prompt that writes this channel's assets, saved together from one save bar with one
// note for the history. A prompt an admin locked, and an added channel's (borrowed) prompts, are shown read only.
function InstructionsTab({ api, data, viewer, channels = [], onOpenChannel, onNotice, onSaved }) {
  const [drafts, setDrafts] = useState({}); // promptId → { blockId: text }
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const prompts = list(data.prompts);
  const readOnlyAll = Boolean(data.custom) || viewer.preview;
  const changedOf = (detail) => Object.fromEntries(Object.entries(drafts[detail.prompt.id] || {}).filter(([blockId, text]) => text !== (detail.blocks?.[blockId] ?? '')));
  const changedPrompts = readOnlyAll ? [] : prompts.filter((detail) => !detail.lockedForYou && Object.keys(changedOf(detail)).length);
  const changes = changedPrompts.reduce((sum, detail) => sum + Object.keys(changedOf(detail)).length, 0);
  // Where a borrowed prompt's own channel is: the built-in channel whose formats include it (assets.<format>).
  const ownerOf = (detail) => { const format = String(detail.prompt?.id || '').replace(/^assets\./, ''); const folder = KIT.folders.find((row) => !row.custom && list(row.deliverables).includes(format)); return folder ? list(channels).find((row) => row.id === folder.id) || { id: folder.id, name: folder.general } : null; };
  async function saveAll() {
    setSaving(true); setProblem('');
    try {
      for (const detail of changedPrompts) await api.saveChannelInstructions({ channelId: data.channelId, promptId: detail.prompt.id, blocks: changedOf(detail), expectedVersion: detail.version, note: note.trim() || 'Changed in Channels' });
      onNotice?.(changedPrompts.length === 1 ? `Saved “${changedPrompts[0].prompt.name}”. New assets use it.` : `Saved ${changedPrompts.length} instructions. New assets use them.`);
      setDrafts({}); setNote(''); onSaved?.();
    } catch (failure) { setProblem(failure?.message || 'That couldn’t be saved. Try again.'); }
    finally { setSaving(false); }
  }
  async function restore(detail, version) {
    setSaving(true); setProblem('');
    try { await api.revertChannelInstructions({ channelId: data.channelId, promptId: detail.prompt.id, toVersion: version, expectedVersion: detail.version }); onNotice?.(`Restored version ${version} of “${detail.prompt.name}”.`); onSaved?.(); }
    catch (failure) { setProblem(failure?.message || 'That couldn’t be restored. Try again.'); }
    finally { setSaving(false); }
  }
  if (!prompts.length) return <EmptyBlock title="No asset instructions">{data.channelName} has no asset instructions in this edition.</EmptyBlock>;
  return <div className="channel-prompts">
    <SaveBar changes={changes} saving={saving} saveLabel={changes && changedPrompts.length > 1 ? 'Save instructions' : 'Save instruction'} onSave={saveAll} onDiscard={() => { setDrafts({}); setNote(''); setProblem(''); }} />
    {data.custom && <p className="studio-hint" role="note">{data.channelName} writes with the instructions of the formats it makes, plus its own channel knowledge. They belong to the channels below, so they’re read only here.</p>}
    {changes > 0 && <label className="studio-field channel-history-note"><span>Note for the history</span><input value={note} maxLength={200} placeholder="What changed, and why" onChange={(event) => setNote(event.target.value)} /></label>}
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {prompts.map((detail) => <InstructionCard key={`${detail.prompt.id}:${detail.version}`} detail={detail} viewer={viewer} readOnly={readOnlyAll} owner={data.custom ? ownerOf(detail) : null} onOpenChannel={onOpenChannel} draftOf={(blockId) => drafts[detail.prompt.id]?.[blockId]} onDraft={(blockId, text) => setDrafts((current) => ({ ...current, [detail.prompt.id]: { ...(current[detail.prompt.id] || {}), [blockId]: text } }))} saving={saving} onRestore={(version) => restore(detail, version)} />)}
  </div>;
}

// One prompt that writes this channel's assets: its editable parts (the tab keeps the drafts) and earlier versions to
// restore. Read only (locked by an admin, or borrowed by an added channel) shows the text as text.
function InstructionCard({ detail, viewer, readOnly = false, owner = null, onOpenChannel, draftOf, onDraft, saving, onRestore }) {
  const titleId = useId();
  const editable = list(detail.prompt?.blocks).filter((block) => block.editable && Object.prototype.hasOwnProperty.call(detail.blocks || {}, block.id));
  const locked = Boolean(detail.lockedForYou) || readOnly;
  return <section className="cs-panel channel-prompt" aria-labelledby={titleId}>
    <div className="cs-panel-title"><div><h3 id={titleId}>{detail.prompt?.name}</h3><p>{detail.version ? `Version ${detail.version}${detail.updatedBy?.name ? `, saved by ${detail.updatedBy.name}` : ''}${detail.updatedAt ? ` on ${formatDay(detail.updatedAt)}` : ''}` : 'The studio’s default text'}{detail.lockedForYou ? '. Read only: an admin locked it.' : ''}</p></div>
      {owner && onOpenChannel && <button type="button" className="studio-quiet" onClick={() => onOpenChannel(owner.id)}>Open {owner.name}</button>}</div>
    {editable.map((block) => <div key={block.id} className="studio-field"><span>{block.label}</span>
      {locked ? <div className="channel-readonly-text">{detail.blocks?.[block.id] ?? ''}</div>
        : <textarea rows={6} aria-label={`${detail.prompt?.name}: ${block.label}`} value={draftOf(block.id) ?? detail.blocks?.[block.id] ?? ''} disabled={viewer.preview} onChange={(event) => onDraft(block.id, event.target.value)} />}</div>)}
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
      <thead><tr><th scope="col">Channel</th>{owners && <th scope="col">Owner</th>}<th scope="col">Channel knowledge</th><th scope="col">Asset instructions</th><th scope="col">Last saved</th></tr></thead>
      <tbody>{list(channels).map((channel) => { const data = rows[channel.id]; const fill = data && !data.problem ? knowledgeFilled(data) : null; const own = list(owners?.[channel.id]); return <tr key={channel.id} className="channel-row" onClick={(event) => { if (!event.target.closest('button, a')) onOpen(channel.id); }}>
        <th scope="row"><button type="button" className="simple-file-open" onClick={() => onOpen(channel.id)}>{channel.name}</button>{isCustomChannel(channel.id) && <span className="channel-added-tag">Added</span>}</th>
        {owners && <td>{own.length ? own.join(', ') : <span className="channel-table-none">None</span>}</td>}
        <td>{!data ? 'Loading…' : data.problem ? data.problem : fill.filled === 0 ? <span className="channel-table-none">None yet</span> : `${fill.filled} of ${fill.total} filled in`}</td>
        <td>{fill ? `${list(data.prompts).length} ${list(data.prompts).length === 1 ? 'prompt' : 'prompts'}` : ''}</td>
        <td className="simple-file-date">{fill && data.updatedAt ? `${formatDay(data.updatedAt)}${data.updatedBy?.name ? `, ${data.updatedBy.name}` : ''}` : fill ? 'Never' : ''}</td>
      </tr>; })}</tbody>
    </table></div> : <EmptyBlock title="No channels yet" action={mayAdd ? <button type="button" className="simple-primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />Add channel</button> : null}>Channels are where the team publishes. Each gets its own knowledge, owner and assets.</EmptyBlock>}
    {/* Under 600px the table is a list: the name, then its facts on one line; the whole row opens the channel. */}
    {list(channels).length > 0 && <ul className="channel-list-narrow" aria-label="Channels">{list(channels).map((channel) => { const data = rows[channel.id]; const fill = data && !data.problem ? knowledgeFilled(data) : null; const own = list(owners?.[channel.id]); return <li key={channel.id}><button type="button" onClick={() => onOpen(channel.id)}><strong>{channel.name}{isCustomChannel(channel.id) && <span className="channel-added-tag">Added</span>}</strong><small>{[owners ? (own.length ? own.join(', ') : 'No owner') : '', !data ? 'Loading…' : data.problem ? data.problem : fill.filled === 0 ? 'No knowledge yet' : `Knowledge ${fill.filled} of ${fill.total}`, fill ? `${list(data.prompts).length} ${list(data.prompts).length === 1 ? 'prompt' : 'prompts'}` : ''].filter(Boolean).join(', ')}</small></button></li>; })}</ul>}
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
