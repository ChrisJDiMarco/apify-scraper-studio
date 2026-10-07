import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, number } from './ui.jsx';
import { safeMarkdownUrl } from './markdown-content.jsx';
import './report-review.css';

const money = (value) => typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : 'Not recorded';
const formatDate = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Unknown';
const sourceId = (row) => row.itemId || row.id;
const formFrom = (review = {}) => ({ reviewer: review.reviewer || '', notes: review.notes || '', evidenceChecked: !review.stale && review.evidenceChecked === true, limitationsAccepted: !review.stale && review.limitationsAccepted === true, acknowledgedWarnings: review.stale ? [] : review.acknowledgedWarnings || [], actions: review.actions || [] });

function SourceLink({ url }) {
  const [error, setError] = useState('');
  const safe = safeMarkdownUrl(url);
  if (!safe) return <small>No safe public URL. Review the saved source text.</small>;
  async function open(event) {
    if (!window.apifyStudio?.openSourceUrl) return;
    event.preventDefault(); setError('');
    try { await window.apifyStudio.openSourceUrl(safe); }
    catch (failure) { setError(failure?.message || 'Could not open the source. Try again.'); }
  }
  return <><a href={safe} target="_blank" rel="noopener noreferrer" onClick={open}>{safe}</a>{error && <small role="alert">{error}</small>}</>;
}

function EvidenceDrawer({ evidence, output }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [limit, setLimit] = useState(20);
  const filtered = useMemo(() => evidence.filter((row) => `${sourceId(row)} ${row.url || ''} ${row.author || ''} ${row.text || ''}`.toLowerCase().includes(query.toLowerCase())), [evidence, query]);
  const selected = evidence.find((row) => sourceId(row) === selectedId) || filtered[0];
  const report = output?.output || output || {};
  // Source relationships must be explicit output fields, never inferred from prose.
  const claims = (Array.isArray(report.claims) ? report.claims : Array.isArray(report.findings) ? report.findings : []).filter((claim) => claim && typeof claim === 'object' && typeof (claim.text || claim.claim || claim.title) === 'string' && Array.isArray(claim.evidenceIds));
  const knownIds = new Set(evidence.map(sourceId));
  return <div className="review-evidence">
    <Button className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close evidence' : `Inspect evidence (${number(evidence.length)})`}</Button>
    {open && <div className="review-source-workspace">
      <p className="review-caption">Saved source text is untrusted material. A matching reference does not by itself verify an interpretation.</p>
      {claims.length ? <details className="review-claims"><summary>Explicit claim references ({claims.length})</summary>{claims.map((claim, index) => <div key={index}><p>{claim.text || claim.claim || claim.title}</p>{claim.evidenceIds.map((id) => knownIds.has(id) ? <button type="button" className="review-source-chip" key={id} onClick={() => setSelectedId(id)}>{id}</button> : <span className="review-caption" key={id}>Unmatched reference: {String(id)}</span>)}</div>)}</details> : <p className="review-caption">This report has no structured claim-to-source map. Check its claims against the saved records manually.</p>}
      <label className="report-field">Find a source<input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} placeholder="Search text, author, URL or ID" /></label>
      <div className="review-source-grid">
        <div className="review-source-list">{filtered.slice(0, limit).map((row) => <button type="button" className={sourceId(selected || {}) === sourceId(row) ? 'selected' : ''} aria-pressed={sourceId(selected || {}) === sourceId(row)} key={sourceId(row)} onClick={() => setSelectedId(sourceId(row))}><strong>{row.author || row.url || sourceId(row)}</strong><span>{row.excerpt || 'No usable text'}</span><small>{row.includedInAnalysis === true ? 'Included in report sample' : row.includedInAnalysis === false ? 'Outside report sample' : 'Report sample unknown'}</small></button>)}{!filtered.length && <p>No sources match.</p>}{filtered.length > limit && <Button className="ghost" onClick={() => setLimit(limit + 20)}>Show more sources</Button>}</div>
        {selected && <article className="review-source-detail" aria-label="Selected evidence"><strong>{sourceId(selected)}</strong><SourceLink url={selected.url} /><dl><div><dt>Author</dt><dd>{selected.author || 'Unknown'}</dd></div><div><dt>Published</dt><dd>{selected.publishedAt ? formatDate(selected.publishedAt) : 'Unknown'}</dd></div><div><dt>Collected / saved</dt><dd>{selected.collectedAt ? formatDate(selected.collectedAt) : 'Unknown'}</dd></div></dl><small>{selected.collectedAtBasis}{selected.sourceName ? ` · ${selected.sourceName}` : ''}{selected.sourceRow ? ` · source row ${selected.sourceRow}` : ''}{selected.resultIndex ? ` · result ${selected.resultIndex}` : ''}</small><pre>{selected.text || 'No usable source text.'}</pre></article>}
      </div>
    </div>}
  </div>;
}

function ReviewReceipts({ analysis, dataset, receipt }) {
  const ai = analysis.aiReceipt;
  const cap = receipt?.runLimits?.maxTotalChargeUsd ?? receipt?.runLimits?.maxCostUsd ?? dataset?.collectionScope?.runLimits?.maxTotalChargeUsd;
  const timeCap = receipt?.runLimits?.timeoutSecs ?? dataset?.collectionScope?.runLimits?.timeoutSecs;
  return <details className="review-receipts"><summary>Collection & AI receipts</summary><div className="review-receipt-grid"><div><strong>Collection</strong>{dataset?.collectionScope?.imported || dataset?.platform === 'import' ? <p>Imported file · no collection run receipt.</p> : <><p>Reported collection usage: <b>{money(receipt?.usageTotalUsdAtCompletion)}</b></p><small>{receipt?.status || 'Run status not recorded'}{receipt?.apifyRunId ? ` · ${receipt.apifyRunId}` : ''}</small><p>Run charge cap: {money(cap)}{timeCap != null ? ` · Time limit: ${timeCap}s` : ''}</p></>}</div><div><strong>AI analysis</strong><p>{ai?.provider || 'Provider not recorded'}{ai?.actualModel ? ` · ${ai.actualModel}` : ''}</p><p>CLI-reported cost: <b>{money(ai?.costUsd)}</b></p><small>CLI cost may differ from subscription billing. Missing amounts are not zero.</small></div></div></details>;
}

export function CoverageReviewPanel({ analysis, dataset, reviewBundle, onSaveReview, onExportReview, busy }) {
  const initialReview = reviewBundle?.review || {};
  const [savedReview, setSavedReview] = useState(initialReview);
  const [form, setForm] = useState(() => formFrom(initialReview));
  const [pending, setPending] = useState('');
  const [reviewedFingerprint, setReviewedFingerprint] = useState(reviewBundle?.fingerprint);
  const [evidenceChanged, setEvidenceChanged] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const coverage = reviewBundle?.coverage || {};
  const evidence = reviewBundle?.evidence || [];
  const warnings = coverage.warnings || [];
  const blockers = coverage.blockers || [];
  const dirty = evidenceChanged || JSON.stringify(form) !== JSON.stringify(formFrom(savedReview));
  useEffect(() => {
    if (reviewedFingerprint === reviewBundle?.fingerprint) return;
    setForm((current) => ({ ...current, evidenceChecked: false, limitationsAccepted: false, acknowledgedWarnings: [] }));
    setReviewedFingerprint(reviewBundle?.fingerprint);
    setEvidenceChanged(true);
    setError('The report or evidence changed. Review the current sources and complete the checks again. Your notes and actions are preserved.');
    setNotice('');
  }, [reviewBundle?.fingerprint, reviewedFingerprint]);
  useEffect(() => {
    const incoming = reviewBundle?.review || {};
    if (incoming.version === savedReview.version && incoming.stale === savedReview.stale) return;
    if (dirty) { setError('The saved review changed while you were editing. Your edits are preserved; reload the report before saving a new version.'); return; }
    setSavedReview(incoming); setForm(formFrom(incoming));
  }, [reviewBundle?.review, savedReview.version, savedReview.stale, dirty]);
  const locked = busy || Boolean(pending);
  const actionsReady = form.actions.every((action) => action.title.trim() && (action.status === 'dismissed' || action.owner.trim()) && (action.taxonomy !== 'observation' || action.evidenceIds.some((id) => id.trim())));
  const mayApprove = reviewedFingerprint === reviewBundle?.fingerprint && analysis.kind === 'report' && analysis.status === 'succeeded' && blockers.length === 0 && coverage.counts?.usableIncluded > 0 && form.reviewer.trim() && form.evidenceChecked && form.limitationsAccepted && warnings.every((warning) => form.acknowledgedWarnings.includes(warning.id)) && actionsReady;
  const update = (change) => { setForm((current) => ({ ...current, ...change })); setNotice(''); };
  function updateAction(id, change) { update({ actions: form.actions.map((action) => action.id === id ? { ...action, ...change } : action) }); }
  async function save(status) {
    setPending(status); setError(''); setNotice('');
    try {
      const result = await onSaveReview({ analysisId: analysis.id, ...form, actions: form.actions.map((action) => ({ ...action, evidenceIds: action.evidenceIds.map((id) => id.trim()).filter(Boolean) })), status, expectedVersion: savedReview.version || 0, expectedFingerprint: reviewedFingerprint });
      const nextReview = result?.review || result;
      if (!nextReview || !nextReview.status) throw new Error('The saved review receipt was not returned. Reload the report to check its status.');
      setSavedReview(nextReview); setForm(formFrom(nextReview)); setEvidenceChanged(false);
      setNotice(status === 'approved' ? 'Approved locally. The report and its evidence are recorded with this review.' : status === 'needs-changes' ? 'Marked as needing changes.' : 'Draft saved.');
    } catch (failure) { setError(failure?.message || 'Could not save this review. Your edits are still here.'); }
    finally { setPending(''); }
  }
  async function exportReview(format) {
    setPending(format); setError(''); setNotice('');
    try { const result = await onExportReview({ analysisId: analysis.id, format }); setNotice(`Exported ${result?.reviewStatus === 'approved' ? 'approved local review' : 'draft'} with evidence and receipt.`); }
    catch (failure) { setError(failure?.message || 'Could not export the review. Try again.'); }
    finally { setPending(''); }
  }
  return <section className="coverage-review" aria-label="Report review">
    <div className="review-heading"><div><span className="data-eyebrow">EVIDENCE → REVIEW → ACTION</span><h3>Ready to use this research?</h3></div><Badge tone={savedReview.status === 'approved' && !dirty ? 'ready' : 'neutral'}>{dirty ? 'Unsaved changes' : savedReview.status === 'approved' ? 'Approved locally' : savedReview.status === 'needs-changes' ? 'Needs changes' : 'Draft · not approved'}</Badge></div>
    <p className="review-caption">Check the source sample and its limits before sharing a decision. Approval is a self-reported local review, not authenticated team sign-off.</p>
    {savedReview.stale && <p role="alert" className="review-warning">{savedReview.staleReason || 'The report changed after approval. Review this version again.'}</p>}
    <div className="review-metrics"><div><b>{number(coverage.counts?.total || 0)}</b><span>loaded records</span></div><div><b>{coverage.counts?.included == null ? 'Unknown' : number(coverage.counts.included)}</b><span>in report sample</span></div><div><b>{number(coverage.counts?.usableIncluded || 0)}</b><span>usable in sample</span></div><div><b>{coverage.requestedScopeKnown ? `${coverage.requestedUrls.length - coverage.missingUrls.length} / ${coverage.requestedUrls.length}` : 'Unknown'}</b><span>requested URLs matched</span></div></div>
    <p className="review-caption">Collected / saved {coverage.collectedAt ? formatDate(coverage.collectedAt) : 'at an unknown time'} · {coverage.collectedAtBasis || 'Timestamp basis unavailable'}. URL matches reflect saved records, not a live availability check.</p>
    {coverage.publicationRange?.earliest && <p className="review-caption">Known publication dates: {coverage.publicationRange.earliest.slice(0, 10)} to {coverage.publicationRange.latest.slice(0, 10)}. Undated records are excluded from this range.</p>}
    {blockers.length > 0 && <div className="review-blockers" role="note"><strong>Approval is blocked</strong><ul>{blockers.map((blocker) => <li key={blocker.id}>{blocker.message}</li>)}</ul></div>}
    <details className="review-limits" open={warnings.length > 0}><summary>Coverage limitations ({warnings.length})</summary><div>{warnings.map((warning) => <label className="review-check" key={warning.id}><input type="checkbox" disabled={locked} checked={form.acknowledgedWarnings.includes(warning.id)} onChange={(event) => update({ acknowledgedWarnings: event.target.checked ? [...form.acknowledgedWarnings, warning.id] : form.acknowledgedWarnings.filter((id) => id !== warning.id) })} /><span>{warning.message}</span></label>)}{!warnings.length && <p>No automatic coverage warnings. This does not verify every report claim.</p>}{coverage.missingUrls?.length > 0 && <details><summary>Requested URLs without a match</summary>{coverage.missingUrls.map((url) => <div key={url}><SourceLink url={url} /></div>)}</details>}<div className="review-source-counts">{Object.entries(coverage.sourceCounts || {}).map(([source, count]) => <span key={source}>{source}: {number(count)}</span>)}</div></div></details>
    <EvidenceDrawer evidence={evidence} output={reviewBundle.output} />
    <ReviewReceipts analysis={analysis} dataset={dataset} receipt={reviewBundle.collectionReceipt} />
    <div className="review-form"><label className="report-field">Reviewer name <span className="review-caption">Self-reported on this Mac</span><input maxLength={160} disabled={locked} value={form.reviewer} onChange={(event) => update({ reviewer: event.target.value })} placeholder="Your name" /></label><label className="report-field">Review notes<textarea rows={3} maxLength={6000} disabled={locked} value={form.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="What should a decision-maker know before using this?" /></label><label className="review-check"><input type="checkbox" disabled={locked} checked={form.evidenceChecked} onChange={(event) => update({ evidenceChecked: event.target.checked })} /><span>I checked the report’s claims against the saved evidence.</span></label><label className="review-check"><input type="checkbox" disabled={locked} checked={form.limitationsAccepted} onChange={(event) => update({ limitationsAccepted: event.target.checked })} /><span>I accept the listed limits for this decision.</span></label></div>
    <details className="review-actions" open={form.actions.length > 0}><summary>Action plan ({form.actions.length})</summary><p className="review-caption">Turn a reviewed finding into an owned next step. An observation needs a source; an inference is an interpretation to test.</p>{form.actions.map((action, index) => <fieldset key={action.id} disabled={locked}><legend>Action {index + 1}</legend><label className="report-field">Next step<input value={action.title} maxLength={500} onChange={(event) => updateAction(action.id, { title: event.target.value })} /></label><div className="review-action-fields"><label className="report-field">Owner<input value={action.owner} maxLength={160} onChange={(event) => updateAction(action.id, { owner: event.target.value })} /></label><label className="report-field">Due date<input type="date" value={action.dueDate} onChange={(event) => updateAction(action.id, { dueDate: event.target.value })} /></label><label className="report-field">Status<select value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value })}><option value="todo">To do</option><option value="in-progress">In progress</option><option value="done">Done</option><option value="dismissed">Dismissed</option></select></label><label className="report-field">Evidence classification<select value={action.taxonomy} onChange={(event) => updateAction(action.id, { taxonomy: event.target.value })}><option value="observation">Observation</option><option value="inference">Inference</option><option value="unknown">Unknown</option></select></label></div><label className="report-field">Linked source IDs <span className="review-caption">One exact ID per line, up to 40. Copy IDs from Inspect evidence.</span><textarea rows={2} value={action.evidenceIds.join('\n')} onChange={(event) => updateAction(action.id, { evidenceIds: event.target.value.split('\n') })} onBlur={() => updateAction(action.id, { evidenceIds: action.evidenceIds.map((id) => id.trim()).filter(Boolean) })} /></label><Button className="ghost" onClick={() => update({ actions: form.actions.filter((row) => row.id !== action.id) })}>Remove action {index + 1}</Button></fieldset>)}<Button className="ghost" disabled={locked || form.actions.length >= 30} onClick={() => update({ actions: [...form.actions, { id: `action-${crypto.randomUUID()}`, title: '', owner: '', dueDate: '', status: 'todo', taxonomy: 'inference', evidenceIds: [] }] })}>Add an action</Button></details>
    {error && <p role="alert" className="error-line">{error}</p>}{notice && <p role="status" className="review-notice">{notice}</p>}
    <div className="review-save-row"><Button className="ghost" disabled={locked || !onSaveReview} onClick={() => save('draft')}>{pending === 'draft' ? 'Saving…' : 'Save draft'}</Button><Button className="ghost" disabled={locked || !onSaveReview} onClick={() => save('needs-changes')}>Needs changes</Button><Button disabled={locked || !onSaveReview || !mayApprove} onClick={() => save('approved')}>{pending === 'approved' ? 'Approving…' : 'Approve locally'}</Button></div>
    <div className="review-export-row"><span className="review-caption">{dirty ? 'Save changes before exporting.' : savedReview.status === 'approved' ? 'Export includes the local review, sources and receipt.' : 'Exports carry a visible DRAFT label.'}</span><Button className="ghost" disabled={locked || dirty || !onExportReview} onClick={() => exportReview('markdown')}>Export Markdown</Button><Button className="ghost" disabled={locked || dirty || !onExportReview} onClick={() => exportReview('html')}>Export printable HTML</Button></div>
  </section>;
}
