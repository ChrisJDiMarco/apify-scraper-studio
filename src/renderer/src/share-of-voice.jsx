import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, ChartNoAxesCombined, ChevronLeft, ChevronRight, Database, RefreshCw, Settings2, Upload } from 'lucide-react';
import { friendlyMessage, number } from './ui.jsx';
import { writeProps } from './viewer.js';
import './share-of-voice.css';

const NETWORKS = [['linkedin', 'LinkedIn'], ['x', 'X'], ['reddit', 'Reddit']];
const COLORS = ['var(--voice-ink)', '#067b71', '#ad4a24', '#345eb3', '#957029', '#83638e'];
const ratio = (part, total) => total ? part / total : null;
const percent = (value, digits = 1) => value === null ? '—' : new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const dateLabel = (date, options = { month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(new Date(date));
const lines = (value) => value.split('\n').map((part) => part.trim()).filter(Boolean);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const workspaceBrand = (program, brand) => program.brand?.mode === 'own' ? program.brand.name : brand;
const emptyConfig = (program, brand) => ({
  enabled: true, source: 'program', terms: '',
  brands: workspaceBrand(program, brand) || '',
});
const formatSettings = (settings, program, brand) => settings.revision ? {
  enabled: settings.enabled, source: settings.source, terms: settings.terms.join('\n'),
  brands: settings.brands.map((row) => [row.name, row.aliases.filter((alias) => alias !== row.name).join(', ')].filter(Boolean).join(' | ')).join('\n'),
} : emptyConfig(program, brand);

function DailyChart({ data, brands }) {
  const traces = brands.slice(0, COLORS.length);
  const width = 820;
  const height = 198;
  const x = (index) => 39 + (width - 53) * (data.length === 1 ? 0.5 : index / (data.length - 1));
  const y = (value) => 13 + (height - 25) * (1 - value);
  const points = (index) => data.map((row) => ratio(row.brands[index], sum(row.brands)));
  return <figure className="voice-chart">
    <div className="voice-chart-head"><div><h3>Daily share of voice</h3><p>Share of tracked brand mentions within the selected posts</p></div><ChartNoAxesCombined size={20} aria-hidden="true" /></div>
    <svg role="img" aria-label="Daily competitive share of voice by brand, from zero to one hundred percent" viewBox={`0 0 ${width} ${height}`} className="voice-plot">
      {[1, 0.75, 0.5, 0.25, 0].map((level) => <g key={level}><line x1="39" x2={width - 14} y1={y(level)} y2={y(level)} stroke="var(--voice-rule)" strokeDasharray={level ? '3 4' : undefined} /><text x="33" y={y(level) + 4} textAnchor="end">{Math.round(level * 100)}%</text></g>)}
      {traces.map((brand, index) => {
        const values = points(index);
        const d = values.map((value, tick) => value === null ? '' : `${tick && values[tick - 1] !== null ? 'L' : 'M'}${x(tick)},${y(value)}`).join(' ');
        return <g key={brand.name} color={COLORS[index]}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth={index === 0 ? 3.4 : 1.8} vectorEffect="non-scaling-stroke" />
          {values.map((value, tick) => value !== null && (data.length <= 14 || values[tick - 1] == null && values[tick + 1] == null) ? <circle key={data[tick].date} cx={x(tick)} cy={y(value)} r={index === 0 ? 3.6 : 2.7} fill="currentColor"><title>{dateLabel(data[tick].date)} · {brand.name} · {percent(value)}</title></circle> : null)}
        </g>;
      })}
    </svg>
    <div className="voice-chart-dates"><span>{dateLabel(data[0].date)}</span>{data.length > 1 && <span>{dateLabel(data.at(-1).date)}</span>}</div>
    <figcaption>{traces.map((brand, index) => <span key={brand.name}><i style={{ background: COLORS[index] }} />{brand.name}</span>)}{brands.length > traces.length && <span>All brands listed below</span>}</figcaption>
  </figure>;
}

function exportEvidence(rows) {
  const csvCell = (value) => {
    const safe = String(value ?? '');
    return '"' + (/^[=+\-@\t\r]/.test(safe) ? "'" : '') + safe.replaceAll('"', '""') + '"';
  };
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'share-of-voice-daily.csv'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareOfVoice({ api, program, viewer, editable = false, brand = '' }) {
  const [query, setQuery] = useState({ days: 7, platform: '', brand: -1, offset: 0, start: '', end: '' });
  const [custom, setCustom] = useState(false);
  const [dates, setDates] = useState({ start: '', end: '' });
  const [result, setResult] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [revision, refresh] = useState(0);
  const canEdit = editable && typeof api.saveShareOfVoice === 'function' && !viewer?.preview;
  useEffect(() => {
    let live = true;
    api.readShareOfVoice({ programId: program.id, ...query }).then((data) => {
      if (!live) return;
      setResult(data); setError('');
    }).catch((failure) => { if (live) setError(friendlyMessage(failure?.message || failure)); });
    return () => { live = false; };
  }, [api, program.id, program.shareOfVoiceEnabled, program.shareOfVoiceRevision, query, revision, program.shareOfVoiceDataAt]);
  const settings = result?.settings;
  const enabled = Boolean(settings?.enabled);
  function changeQuery(patch) { setError(''); setQuery((current) => ({ ...current, offset: 0, ...patch })); }
  function openSettings() {
    setDraft({ ...formatSettings(settings, program, brand), revision: settings?.revision || '' }); setSettingsOpen(true); setActionError(''); setMessage('');
  }
  async function save(event) {
    event.preventDefault();
    if (!draft || !canEdit) return;
    const brands = lines(draft.brands).map((line) => { const [name, ...aliases] = line.split('|'); return { name, aliases: aliases.join('|').split(',').map((entry) => entry.trim()).filter(Boolean) }; });
    setPending(true); setActionError(''); setMessage('');
    try {
      await api.saveShareOfVoice({ programId: program.id, revision: draft.revision, config: { enabled: draft.enabled, source: draft.source, terms: lines(draft.terms), brands } });
      setSettingsOpen(false); setMessage(draft.enabled ? 'Tracking settings saved.' : 'Tracking paused. Your settings and imported posts are saved.'); changeQuery({ brand: -1 }); refresh((value) => value + 1);
    } catch (failure) { setActionError(friendlyMessage(failure?.message || failure)); refresh((value) => value + 1); }
    finally { setPending(false); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canEdit) return;
    setPending(true); setActionError(''); setMessage('');
    try {
      if (file.size > 6 * 1024 * 1024) throw new Error('Choose a CSV of at most 6 MB.');
      const outcome = await api.importShareOfVoice({ programId: program.id, csv: await file.text() });
      setMessage(`Added ${number(outcome.added)} posts. ${number(outcome.accepted - outcome.added + outcome.duplicates)} duplicates merged${outcome.skipped ? ` · ${number(outcome.skipped)} unusable rows skipped` : ''}.`);
      changeQuery({ start: '', end: '' }); setCustom(false); refresh((value) => value + 1);
    } catch (failure) { setActionError(friendlyMessage(failure?.message || failure)); }
    finally { setPending(false); }
  }
  if (error) return <div className="voice-empty"><p role="alert">{error}</p><button type="button" className="simple-quiet" onClick={() => refresh((value) => value + 1)}>Try again</button>{result && <button type="button" className="simple-quiet" onClick={() => { setCustom(false); changeQuery({ start: '', end: '' }); }}>Reset dates</button>}</div>;
  if (!settings) return <p className="voice-empty" role="status">Reading tracking settings…</p>;
  const brands = settings.brands;
  const rank = (result.brandCounts || []).map((count, index) => ({ count, index })).sort((a, b) => b.count - a.count || a.index - b.index);
  const totalMentions = sum(result.brandCounts || []);
  const own = brands[0]?.name || 'Your brand';
  const brandCount = result.brandCounts?.[0] ?? 0;
  const observed = result.coverage?.platforms || [];
  const missing = (result.coverage?.expected || []).filter((platform) => !observed.includes(platform));
  const interrupted = (result.coverage?.partial || 0) + (result.coverage?.failed || 0);
  const coverage = interrupted || missing.length;
  const completeDateRange = result.firstDate === result.start && result.lastDate === result.end;
  return <section className="voice">
    <header className="voice-intro">
      <div><h2>Share of voice</h2><p>{enabled ? `${own} in the conversation about ${program.name}` : 'Measure how often your brand comes up alongside competitors in this program’s topic.'}</p></div>
      {canEdit && <button type="button" className={enabled ? 'simple-quiet' : 'simple-primary'} onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()} aria-expanded={settingsOpen}><Settings2 size={16} aria-hidden="true" />{settingsOpen ? 'Close settings' : enabled ? 'Tracking settings' : 'Set up tracking'}</button>}
    </header>
    {message && <p className="voice-notice" role="status">{message}</p>}
    {actionError && <p className="voice-warning" role="alert">{actionError}</p>}
    {settingsOpen && draft && <form className="voice-config" onSubmit={save}>
      <label className="voice-checkbox"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Track share of voice</label>
      <label>Post source<select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option value="program">Saved program collections</option><option value="import">Tracker CSV export</option></select></label>
      <label>Topic keywords<textarea rows="4" value={draft.terms} onChange={(event) => setDraft({ ...draft, terms: event.target.value })} placeholder={'AI search\nAI overviews\nanswer engine optimization'} aria-describedby="voice-terms-hint" /><small id="voice-terms-hint">One phrase per line. A post matches if it contains any phrase.</small></label>
      <label>Tracked brands<textarea rows="4" value={draft.brands} onChange={(event) => setDraft({ ...draft, brands: event.target.value })} placeholder={'Your brand | Product name, @brand\nCompetitor | Alternate name'} aria-describedby="voice-brands-hint" /><small id="voice-brands-hint">Your brand first, then competitors, one per line. Add aliases after a | and separate them with commas.</small></label>
      <button type="submit" className="simple-primary" {...writeProps(viewer, pending)}>{pending ? 'Saving…' : 'Save tracking settings'}</button>
    </form>}
    {!enabled ? <div className="voice-empty"><ChartNoAxesCombined size={28} aria-hidden="true" /><h3>Build a view of your market conversation</h3><p>{canEdit ? 'Choose a topic and the brands you want to follow to start measuring the collected posts.' : 'Tracking is currently paused.'}</p></div> : <>
      <div className="voice-toolbar">
        <div className="voice-period" aria-label="Reporting period">
          {[7, 30, 90].map((days) => <button key={days} type="button" aria-pressed={!custom && query.days === days} onClick={() => { setCustom(false); changeQuery({ days, start: '', end: '' }); }}>{days} days</button>)}
          <button type="button" aria-pressed={custom} onClick={() => { if (!custom) setDates({ start: result.start, end: result.end }); setCustom(!custom); if (custom) changeQuery({ start: '', end: '' }); }}>Custom</button>
        </div>
        <label className="voice-select"><span className="sr-only">Platform</span><select value={query.platform} onChange={(event) => changeQuery({ platform: event.target.value })}><option value="">All platforms</option>{NETWORKS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <button className="simple-quiet" type="button" onClick={() => refresh((value) => value + 1)} aria-label="Refresh share of voice" title="Refresh"><RefreshCw size={15} aria-hidden="true" /></button>
      </div>
      {custom && <form className="voice-toolbar voice-custom" onSubmit={(event) => { event.preventDefault(); changeQuery(dates); }}>
        <label>From<input type="date" required value={dates.start} max={dates.end || undefined} onChange={(event) => setDates({ ...dates, start: event.target.value })} /></label>
        <label>Through<input type="date" required value={dates.end} min={dates.start || undefined} onChange={(event) => setDates({ ...dates, end: event.target.value })} /></label>
        <button className="simple-quiet" type="submit">Apply dates</button>
      </form>}
      <div className="voice-source">
        <Database size={16} aria-hidden="true" />
        <div><strong>{settings.source === 'import' ? 'Tracker export' : 'Program collections'}</strong><span>{dateLabel(result.start)} – {dateLabel(result.end, { month: 'short', day: 'numeric', year: 'numeric' })} UTC{result.lastDate && !completeDateRange ? ` · Posts available ${dateLabel(result.firstDate, { month: 'short', day: 'numeric', year: 'numeric' })} to ${dateLabel(result.lastDate, { month: 'short', day: 'numeric', year: 'numeric' })}` : result.lastDate ? '' : ' · No dated posts yet'}{result.refreshedAt ? ` · Updated ${dateLabel(result.refreshedAt)}` : ''}</span></div>
        {settings.source === 'import' && canEdit && <label className="simple-quiet voice-upload"><Upload size={15} aria-hidden="true" />{pending ? 'Importing…' : 'Import tracker CSV'}<input type="file" accept=".csv,text/csv" disabled={pending} aria-label="Import tracker CSV" onChange={importFile} /></label>}
      </div>
      {settings.source === 'import' && canEdit && <details className="voice-import-help"><summary>CSV format</summary><p>Include every on-topic post, including posts that name no tracked brand. CSV columns are platform, published_at, text, and optionally post_id, url, author, and type.</p></details>}
      {Boolean(coverage) && <p className="voice-warning">{interrupted ? `${number(interrupted)} source collections were incomplete or unavailable. ` : ''}{missing.length ? `No saved coverage for ${missing.map((id) => NETWORKS.find(([network]) => network === id)?.[1] || id).join(', ')}. ` : ''}Shares use the posts available in this sample.</p>}
      {!result.postsCount ? <div className="voice-empty"><ChartNoAxesCombined size={26} aria-hidden="true" /><h3>{result.lastDate ? 'No on-topic posts in this view' : 'Waiting for the first posts'}</h3><p>{result.lastDate ? 'Try a wider date range, a different platform, or review your topic keywords.' : settings.source === 'import' ? 'Import the tracker’s on-topic posts to populate this dashboard.' : 'Saved collections from this program will populate the dashboard as they arrive.'}</p></div> : <>
        <div className="voice-metrics">
          <article className="voice-metric"><span>On-topic posts</span><strong>{number(result.postsCount)}</strong><small>{NETWORKS.filter(([id]) => result.platformCounts[id]).map(([id, name]) => `${name} ${number(result.platformCounts[id])}`).join(' · ')}</small></article>
          <article className="voice-metric"><span>Share of conversation</span><strong>{percent(ratio(brandCount, result.postsCount), 2)}</strong><small>{number(brandCount)} posts mentioning {own} / {number(result.postsCount)} on-topic posts</small></article>
          <article className="voice-metric voice-metric-feature"><span>Competitive share of voice</span><strong>{percent(ratio(brandCount, totalMentions))}</strong><small>{number(brandCount)} of {number(totalMentions)} tracked brand mentions{brandCount ? ` · Rank ${1 + rank.filter((row) => row.count > brandCount).length} of ${brands.length}` : ''}</small></article>
        </div>
        <div className="voice-grid">
          <DailyChart data={result.series} brands={brands} />
          <section className="voice-rank"><h3>Tracked brands</h3><p>Select a brand to see its posts</p>
            {rank.map(({ count, index }) => <button key={brands[index].name} type="button" aria-pressed={query.brand === index} onClick={() => changeQuery({ brand: query.brand === index ? -1 : index })}><span>{brands[index].name}</span><strong>{percent(ratio(count, totalMentions))}</strong></button>)}
          </section>
        </div>
        <section className="voice-posts">
          <header><div><h3>{query.brand >= 0 ? `Posts mentioning ${brands[query.brand]?.name || 'this brand'}` : 'Posts behind the numbers'}</h3><p>{number(result.matches)} matching posts</p></div>
            {query.brand >= 0 && <button type="button" className="simple-quiet" onClick={() => changeQuery({ brand: -1 })}>All posts</button>}
            <button type="button" className="simple-quiet" onClick={() => exportEvidence([['Date (UTC)', 'On-topic posts', ...brands.map((row) => row.name)], ...result.series.map((row) => [row.date, row.posts, ...row.brands])])}><ArrowDownToLine size={15} aria-hidden="true" /> Daily CSV</button>
          </header>
          {result.posts.length === 0 && <p className="voice-empty">No posts mention this brand in the selected period and platform.</p>}
          {result.posts.map((post) => <article key={post.id}>
            <div className="voice-post-meta"><strong>{NETWORKS.find(([id]) => id === post.platform)?.[1]}{post.author ? ` · ${post.author}` : ''}</strong><span>{dateLabel(post.publishedAt)}</span></div>
            <p>{post.text}</p>
            <div className="voice-post-foot"><span>{post.brands.map((index) => brands[index].name).join(' · ') || 'No tracked brand mentioned'}</span>{post.url && <a href={post.url} target="_blank" rel="noreferrer" onClick={typeof api.openSourceUrl === 'function' ? (event) => { event.preventDefault(); Promise.resolve(api.openSourceUrl(post.url)).catch((failure) => setActionError(friendlyMessage(failure?.message || failure))); } : undefined}>Original post <ArrowUpRight size={13} aria-hidden="true" /></a>}</div>
          </article>)}
          {result.matches > 20 && <footer><button type="button" className="simple-quiet" disabled={!result.offset} onClick={() => changeQuery({ offset: Math.max(0, result.offset - 20) })}><ChevronLeft size={16} />Previous</button><span>{number(result.offset + 1)}–{number(Math.min(result.offset + 20, result.matches))} of {number(result.matches)}</span><button type="button" className="simple-quiet" disabled={result.offset + 20 >= result.matches} onClick={() => changeQuery({ offset: result.offset + 20 })}>Next<ChevronRight size={16} /></button></footer>}
        </section>
      </>}
      <details className="voice-method"><summary>How these numbers are counted</summary><p>We count distinct published posts matching any configured topic phrase, using UTC dates. A post contributes one mention per tracked brand it names. A post naming two brands counts once in the topic volume and once for each of those brands. The denominator for competitive share of voice is the sum of those brand mentions. Shares describe the collected sample. The current keywords and aliases apply throughout the date range.</p><p><strong>Topic keywords</strong> {settings.terms.join(', ')}</p></details>
    </>}
  </section>;
}
