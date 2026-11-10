import React, { useEffect, useId, useState } from 'react';
import { History, Save } from 'lucide-react';
import { formatDay, useViewer, writeProps } from './viewer.js';
import './channel-settings.css';

// A channel's settings: its knowledge (what the channel's team knows about writing for it, shared/channel-knowledge.json)
// and its asset instructions (the editable text of the prompts that write its assets, with versions and Restore). A
// channel owner sees their own channel (Studio › My channel: `channelId` fixed); admins and editors pick any channel
// (Studio › Channels). Saving goes through the server, which pins a channel owner to their own channel and keeps a
// prompt an admin locked read-only. Nothing here costs anything.
const list = (value) => (Array.isArray(value) ? value : []);
export function ChannelSettings({ api, channels = [], channelId: fixed = '', onNotice }) {
  const viewer = useViewer();
  const pickId = useId();
  const [channelId, setChannelId] = useState(fixed || list(channels)[0]?.id || '');
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
  return <div className="simple-page channel-settings" data-spot="channel.settings">
    <div className="simple-page-head"><div><h1>{fixed ? 'My channel' : 'Channels'}</h1><p>{fixed ? `What ${name}’s assets should know about the channel, and the instructions that write them.` : 'Each channel’s knowledge and the instructions that write its assets. Channel owners edit their own.'}</p></div>
      {!fixed && list(channels).length > 0 && <div className="simple-head-actions"><label className="cs-program-pick" htmlFor={pickId}><span className="sr-only">Channel</span><select id={pickId} className="simple-program-pick" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>}</div>
    <div className="simple-segment" role="tablist" aria-label="Channel settings">{[['knowledge', 'Channel knowledge'], ['instructions', 'Asset instructions']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {problem && <p className="studio-error" role="alert">{problem}</p>}
    {!data && !problem && <p className="studio-hint" role="status">Loading {name}…</p>}
    {data && tab === 'knowledge' && <KnowledgeForm key={data.channelId} api={api} data={data} viewer={viewer} onNotice={onNotice} />}
    {data && tab === 'instructions' && <div className="channel-prompts">
      {!data.prompts.length && <p className="studio-hint">No asset instructions for {name} in this edition.</p>}
      {data.prompts.map((detail) => <InstructionCard key={`${detail.prompt.id}:${detail.version}`} api={api} channelId={data.channelId} detail={detail} viewer={viewer} onNotice={onNotice} onSaved={() => setReload((value) => value + 1)} />)}
    </div>}
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
