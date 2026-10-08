import React, { useEffect, useState } from 'react';
import { Boxes, Check, FileText, Layers3, Plus, Table2, Trash2, Upload } from 'lucide-react';
import { Button, Badge, formatDate, number } from './ui.jsx';

// The research knowledge the n8n Golden Thread workflow read on every run: the Taxonomy Lookup
// tab (priority scoring), the Product & Solution Registry (toolkit angles) and the ICP,
// positioning and AI-visibility documents the toolkit prompt quotes.
const DOC_KINDS = [['icp', 'ICP (ideal customer profile)'], ['positioning', 'Positioning'], ['ai-visibility', 'AI search positioning & glossary'], ['other', 'Other background']];
const list = (value) => (Array.isArray(value) ? value : []);
function Field({ id, label, hint, children }) { return <div className="cs-field"><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }

function TaxonomyCard({ workspace, api, action, disabled }) {
  const taxonomy = workspace.taxonomy;
  const [workbooks, setWorkbooks] = useState([]);
  const [workbookId, setWorkbookId] = useState('');
  useEffect(() => { let live = true; Promise.resolve(api.listWorkbooks?.()).then((rows) => { if (!live) return; const imported = list(rows).filter((row) => row.kind === 'import'); setWorkbooks(imported); setWorkbookId((current) => current || imported.find((row) => list(row.sheets).some((sheet) => /taxonomy/i.test(sheet.name)))?.id || imported[0]?.id || ''); }).catch(() => {}); return () => { live = false; }; }, [api]);
  async function useWorkbook(id) {
    const workbook = await api.readWorkbook({ workbookId: id });
    const sheet = list(workbook?.sheets).find((entry) => /taxonomy/i.test(entry.name)) || list(workbook?.sheets).find((entry) => entry.columns.some((column) => /^zone$/i.test(column)) && entry.columns.some((column) => /^category$/i.test(column)));
    if (!sheet) throw new Error('That workbook has no Taxonomy Lookup tab (a tab with Category and Zone columns).');
    return api.saveWorkspaceTaxonomy({ workspaceId: workspace.id, rows: [sheet.columns, ...sheet.rows], sourceName: `${workbook.name} · ${sheet.name}` });
  }
  async function importFile() {
    const imported = await api.importWorkbook({});
    if (!imported) return null;
    setWorkbooks((rows) => [imported, ...rows.filter((row) => row.id !== imported.id)]); setWorkbookId(imported.id);
    return useWorkbook(imported.id);
  }
  const categories = list(taxonomy?.categories);
  return <section className="cs-panel cs-research-knowledge-card" aria-labelledby="cs-taxonomy-title">
    <div className="cs-panel-title"><div><h3 id="cs-taxonomy-title">Taxonomy lookup</h3><p>Each theme is matched to a category so its priority tier reflects your blog’s zone and recent coverage (the n8n Calculate Trend Velocity step).</p></div><span className="cs-mini-icon"><Table2 size={20} aria-hidden="true" /></span></div>
    {categories.length ? <div className="cs-knowledge-status"><Badge>{number(categories.length)} categories</Badge><span>{taxonomy.source?.name || 'Saved taxonomy'}{taxonomy.source?.importedAt ? ` · ${formatDate(taxonomy.source.importedAt)}` : ''}</span></div> : <p className="cs-knowledge-empty">No taxonomy yet. Without it, every theme scores as new territory.</p>}
    {categories.length > 0 && <div className="cs-taxonomy-preview" role="table" aria-label="Taxonomy categories"><div role="row" className="head"><span role="columnheader">Category</span><span role="columnheader">Zone</span><span role="columnheader">Velocity</span><span role="columnheader">Articles</span></div>{categories.slice(0, 8).map((entry) => <div role="row" key={entry.category}><span role="cell">{entry.category}</span><span role="cell"><em className={`zone-${entry.zone.toLowerCase()}`}>{entry.zone}</em></span><span role="cell">{entry.velocity}</span><span role="cell">{number(entry.articleCount)}</span></div>)}{categories.length > 8 && <p>+ {categories.length - 8} more in Sheets → Taxonomy Lookup</p>}</div>}
    <div className="cs-knowledge-actions">
      {workbooks.length > 0 && <Field id="cs-taxonomy-workbook" label="Imported workbook"><select id="cs-taxonomy-workbook" value={workbookId} disabled={disabled} onChange={(event) => setWorkbookId(event.target.value)}>{workbooks.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
      <div className="cs-knowledge-buttons">
        {workbooks.length > 0 && <Button type="button" disabled={disabled || !workbookId} onClick={() => action('Loading the taxonomy', () => useWorkbook(workbookId), 'Taxonomy loaded. New runs score priority against it.')}><Layers3 size={14} aria-hidden="true" />Use its Taxonomy Lookup tab</Button>}
        <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => action('Importing the spreadsheet', importFile, 'Taxonomy loaded from the spreadsheet.')}><Upload size={14} aria-hidden="true" />Import spreadsheet (.xlsx, .csv)…</Button>
        {categories.length > 0 && <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => window.confirm('Remove the taxonomy? Priority tiers fall back to new territory until you load one again.') && action('Removing the taxonomy', () => api.saveWorkspaceTaxonomy({ workspaceId: workspace.id, taxonomy: null }), 'Taxonomy removed.')}><Trash2 size={14} aria-hidden="true" />Remove</Button>}
      </div>
    </div>
  </section>;
}

function RegistryCard({ workspace, api, action, disabled }) {
  const products = list(workspace.products);
  const enterprise = products.filter((product) => product.segment === 'enterprise');
  const selfServe = products.filter((product) => product.segment === 'self-serve');
  const registryDoc = list(workspace.referenceDocs).find((doc) => doc.kind === 'registry');
  const [text, setText] = useState('');
  const [enterpriseNames, setEnterpriseNames] = useState(() => list(workspace.enterpriseProducts).join(', ') || (workspace.editionId === 'semrush' ? 'Enterprise SEO, Enterprise SI (Site Intelligence), Enterprise AIO' : ''));
  const [googleUrl, setGoogleUrl] = useState('');
  async function load(value, title) { return api.importProductRegistry({ workspaceId: workspace.id, text: value, title, enterpriseProducts: enterpriseNames }); }
  async function fromDocument(payload) { const doc = await api.importStudioSource(payload); if (!doc) return null; setText(doc.text); return load(doc.text, doc.title || 'Product & Solution Registry'); }
  return <section className="cs-panel cs-research-knowledge-card" aria-labelledby="cs-registry-title">
    <div className="cs-panel-title"><div><h3 id="cs-registry-title">Product & solution registry</h3><p>The toolkit’s Enterprise angle may only use Enterprise products; its self-serve angle only tools listed in the headline toolkit’s own table (the n8n v6.1 rules and toolkit check).</p></div><span className="cs-mini-icon"><Boxes size={20} aria-hidden="true" /></span></div>
    {products.length ? <div className="cs-knowledge-status"><Badge>{number(products.length)} products</Badge><span>{enterprise.length} Enterprise · {selfServe.length} self-serve{registryDoc ? ` · ${registryDoc.title} (${number(registryDoc.characters || 0)} characters)` : ''}</span></div> : <p className="cs-knowledge-empty">No registry loaded. Toolkits will state the gap instead of naming products.</p>}
    {products.length > 0 && <div className="cs-registry-segments"><div><h4>Enterprise</h4><p>{enterprise.map((product) => product.name).join(' · ') || 'None'}</p></div><div><h4>Self-serve (affiliate-safe)</h4><p>{selfServe.map((product) => `${product.name} (${list(product.tools).length} tools)`).join(' · ') || 'None'}</p></div></div>}
    <Field id="cs-registry-enterprise" label="Enterprise products" hint="Exact registry names, comma-separated. Everything else is treated as self-serve."><input id="cs-registry-enterprise" value={enterpriseNames} disabled={disabled} onChange={(event) => setEnterpriseNames(event.target.value)} /></Field>
    <Field id="cs-registry-text" label="Registry document text" hint="Paste the whole document, including its “Tool Name | Core Function | Key Tags” tables, or import it below."><textarea id="cs-registry-text" rows={5} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} placeholder="1. SEO Toolkit&#10;URL: https://…&#10;Tool Name | Core Function | Key Tags&#10;…" /></Field>
    <div className="cs-knowledge-buttons">
      <Button type="button" disabled={disabled || !text.trim()} onClick={() => action('Loading the registry', () => load(text, 'Product & Solution Registry'), 'Registry loaded.')}><Check size={14} aria-hidden="true" />Load pasted registry</Button>
      <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => action('Importing the registry document', () => fromDocument({}), 'Registry loaded from the document.')}><Upload size={14} aria-hidden="true" />Import document (.docx, .md, .txt)…</Button>
    </div>
    <div className="cs-inline-field"><Field id="cs-registry-google" label="Or a Google Doc link"><input id="cs-registry-google" type="url" value={googleUrl} disabled={disabled} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="https://docs.google.com/document/d/…" /></Field><Button type="button" className="cs-quiet" disabled={disabled || !googleUrl.trim()} onClick={() => action('Reading the Google Doc', () => fromDocument({ url: googleUrl.trim() }), 'Registry loaded from Google Docs.')}>Read Google Doc</Button></div>
  </section>;
}

function ReferenceDocsCard({ workspace, api, action, disabled }) {
  const docs = list(workspace.referenceDocs).filter((doc) => doc.kind !== 'registry');
  const [kind, setKind] = useState('icp');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [googleUrl, setGoogleUrl] = useState('');
  async function save(value, docTitle, source) { const saved = await api.saveReferenceDoc({ workspaceId: workspace.id, doc: { kind, title: docTitle || title || DOC_KINDS.find(([key]) => key === kind)[1], text: value, source } }); setBody(''); setTitle(''); setGoogleUrl(''); return saved; }
  async function fromDocument(payload) { const doc = await api.importStudioSource(payload); if (!doc) return null; return save(doc.text, title || doc.title, { kind: payload.url ? 'google-doc' : 'file', name: doc.title || '' }); }
  return <section className="cs-panel cs-research-knowledge-card" aria-labelledby="cs-docs-title">
    <div className="cs-panel-title"><div><h3 id="cs-docs-title">Toolkit context documents</h3><p>The ICP, positioning and AI-search guides the editorial toolkit reads, exactly as the n8n toolkit prompt did.</p></div><span className="cs-mini-icon"><FileText size={20} aria-hidden="true" /></span></div>
    {docs.length ? <ul className="cs-reference-docs">{docs.map((doc) => <li key={doc.id}><div><strong>{doc.title}</strong><small>{DOC_KINDS.find(([key]) => key === doc.kind)?.[1] || doc.kind} · {number(doc.characters || 0)} characters · {formatDate(doc.updatedAt)}</small></div><Button type="button" className="cs-quiet" aria-label={`Remove ${doc.title}`} disabled={disabled} onClick={() => window.confirm(`Remove “${doc.title}”?`) && action('Removing the document', () => api.deleteReferenceDoc({ workspaceId: workspace.id, docId: doc.id }), 'Document removed.')}><Trash2 size={13} aria-hidden="true" />Remove</Button></li>)}</ul> : <p className="cs-knowledge-empty">No documents yet. Add the ICP and positioning guides for n8n-equivalent toolkits.</p>}
    <div className="cs-two-fields"><Field id="cs-doc-kind" label="Document type"><select id="cs-doc-kind" value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value)}>{DOC_KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field id="cs-doc-title" label="Title"><input id="cs-doc-title" value={title} disabled={disabled} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Semrush ICP" /></Field></div>
    <Field id="cs-doc-text" label="Paste text"><textarea id="cs-doc-text" rows={4} value={body} disabled={disabled} onChange={(event) => setBody(event.target.value)} /></Field>
    <div className="cs-knowledge-buttons">
      <Button type="button" disabled={disabled || !body.trim()} onClick={() => action('Saving the document', () => save(body.trim(), title, { kind: 'paste', name: '' }), 'Document saved.')}><Plus size={14} aria-hidden="true" />Add pasted document</Button>
      <Button type="button" className="cs-quiet" disabled={disabled} onClick={() => action('Importing the document', () => fromDocument({}), 'Document added.')}><Upload size={14} aria-hidden="true" />Import file…</Button>
    </div>
    <div className="cs-inline-field"><Field id="cs-doc-google" label="Or a Google Doc link"><input id="cs-doc-google" type="url" value={googleUrl} disabled={disabled} onChange={(event) => setGoogleUrl(event.target.value)} placeholder="https://docs.google.com/document/d/…" /></Field><Button type="button" className="cs-quiet" disabled={disabled || !googleUrl.trim()} onClick={() => action('Reading the Google Doc', () => fromDocument({ url: googleUrl.trim() }), 'Document added from Google Docs.')}>Read Google Doc</Button></div>
  </section>;
}

export function ResearchKnowledge({ workspace, api = {}, action, disabled }) {
  if (!workspace?.id) return null;
  return <div className="cs-research-knowledge" id="research-knowledge">
    <div className="cs-field-heading"><h4>Research knowledge</h4><p>Used by research runs for theme scoring and the editorial toolkit. Stored on this Mac with the workspace.</p></div>
    <TaxonomyCard workspace={workspace} api={api} action={action} disabled={disabled} />
    <RegistryCard workspace={workspace} api={api} action={action} disabled={disabled} />
    <ReferenceDocsCard workspace={workspace} api={api} action={action} disabled={disabled} />
  </div>;
}
