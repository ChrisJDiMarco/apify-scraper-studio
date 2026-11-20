import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, LoaderCircle, Sparkles } from 'lucide-react';
import { useConfirm } from './confirm-dialog.jsx';
import { MarkdownLink } from './markdown-content.jsx';
import { friendlyMessage } from './ui.jsx';
import { useCan, useViewer, writeProps } from './viewer.js';
import './website-setup.css';

export function fillEmptyFields(current, suggestions) {
  return { ...current, ...Object.fromEntries(Object.entries(suggestions || {}).filter(([key, value]) => value && !String(current[key] || '').trim())) };
}

export function WebsiteSetup({ api, mode, website, onWebsite, focus = '', wantBrand = true, disabled, onWorking, onDraft, onReview, result, fallback }) {
  const can = useCan();
  if (!can('suggestProgramSetup') || !api.estimateProgramSetup || !api.suggestProgramSetup) return fallback || null;
  return <WebsiteSetupForm {...{ api, mode, website, onWebsite, focus, wantBrand, disabled, onWorking, onDraft, onReview, result }} />;
}

function WebsiteSetupForm({ api, mode, website, onWebsite, focus, wantBrand, disabled, onWorking, onDraft, onReview, result }) {
  const viewer = useViewer();
  const confirm = useConfirm();
  const id = useId();
  const input = useRef(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const retry = useRef(null);
  const [open, setOpen] = useState(Boolean(website || result));
  const [localWebsite, setLocalWebsite] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const value = website ?? localWebsite;
  const update = onWebsite || setLocalWebsite;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function research() {
    if (inFlight.current || disabled || viewer.preview) return;
    setError('');
    if (!value.trim()) { setError('Enter the brand or product website.'); input.current?.focus(); return; }
    inFlight.current = true;
    onWorking?.(true);
    setStatus('Checking the website and estimate…');
    try {
      const estimate = await api.estimateProgramSetup({ websiteMode: mode, website: value.trim(), focus, wantBrand });
      if (!active.current) return;
      if (estimate?.problem) throw new Error(estimate.problem);
      if (!estimate?.website || !estimate.pageLimit) throw new Error('Website research is unavailable. You can continue filling out the form.');
      const cost = estimate.metered === false || estimate.estimateUsd == null ? 'AI cost depends on the connected model.'
        : `Estimated AI cost ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(estimate.estimateUsd)}.`;
      const ok = await confirm({ title: 'Research this website?', lines: [
        new URL(estimate.website).hostname,
        `Apify reads up to ${estimate.pageLimit} public pages and searches the web${focus.trim() ? ' using your research focus' : ''}. Standard Apify usage charges apply. ${cost}`,
        'Suggestions go into blank fields for you to edit before saving.',
      ], confirmLabel: 'Research website' });
      if (!ok || !active.current) return;
      setStatus('Reading public pages and drafting suggestions…');
      const payload = { websiteMode: mode, website: estimate.website, focus, wantBrand };
      const key = JSON.stringify(payload);
      const requestId = retry.current?.key === key ? retry.current.requestId : crypto.randomUUID();
      const draft = await api.suggestProgramSetup({ ...payload, requestId }).catch((failure) => {
        const lostResponse = failure?.status === 0 || ([502, 503, 504].includes(failure?.status) && !failure.ref && !failure.code);
        retry.current = lostResponse ? { key, requestId } : null;
        throw failure;
      });
      if (!draft?.about || !Array.isArray(draft.evidence)) {
        retry.current = { key, requestId };
        throw new Error('The draft response was incomplete. Try again to recover your draft.');
      }
      retry.current = null;
      if (active.current) onDraft(draft);
    } catch (failure) {
      if (active.current) setError(friendlyMessage(failure) || 'Website research couldn’t finish. Try again or continue filling out the form.');
    } finally {
      inFlight.current = false;
      if (active.current) { setStatus(''); onWorking?.(false); }
    }
  }

  return <section className="website-setup" aria-label="Website setup assistant">
    <button type="button" className="website-setup-toggle" aria-expanded={open} aria-controls={`${id}-panel`} {...writeProps(viewer, disabled || Boolean(status))} onClick={() => setOpen(!open)}>
      <Sparkles size={17} aria-hidden="true" /><span>Help me fill this out</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    <div id={`${id}-panel`} className="website-setup-panel" hidden={!open}>
      {!result && <p>{mode === 'workspace' ? 'Start with a website to draft your brand knowledge and product list.' : 'Start with a website to draft a research focus and find accounts and communities to follow.'}</p>}
      <label htmlFor={`${id}-url`}>Website</label>
      <div className="website-setup-input">
        <input ref={input} id={`${id}-url`} value={value} inputMode="url" maxLength={2000} placeholder="example.com" autoCapitalize="none" spellCheck={false}
          disabled={disabled || Boolean(status)} onChange={(event) => { update(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); research(); } }} />
        <button type="button" className="website-setup-research" {...writeProps(viewer, disabled || Boolean(status))} onClick={research}>{status && <LoaderCircle className="spin" size={15} aria-hidden="true" />}Research website</button>
      </div>
      <div className="website-setup-feedback" role="status">{status || (result ? 'Draft ready. Edit the suggestions before saving.' : '')}</div>
      {error && <p className="website-setup-error" role="alert">{error}</p>}
      {result && <>
        {onReview && <button type="button" className="website-setup-review" disabled={disabled || Boolean(status)} onClick={onReview}>Review brand fields</button>}
        {result.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
        <details className="website-setup-evidence"><summary>{result.evidence.length} {result.evidence.length === 1 ? 'source' : 'sources'} used in this draft</summary>
          <ul>{result.evidence.map(({ url, title, kind }) => <li key={url}><WebsiteSourceLink url={url}>{title}</WebsiteSourceLink><small>{new URL(url).hostname} · {kind === 'page' ? 'Website page' : 'Search result'}</small></li>)}</ul>
        </details>
      </>}
    </div>
  </section>;
}

export function WebsiteSourceLink({ url, children }) {
  return <MarkdownLink href={url}>{children}<ExternalLink size={12} aria-hidden="true" /></MarkdownLink>;
}
