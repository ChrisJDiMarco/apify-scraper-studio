import workflow from '../../shared/asset-workflow.json';
import { cardDraftFromInput, cardFromAsset } from '../../shared/assets.js';
import { evaluateArtifact } from './v5-ui-core.js';
import { useState } from 'react';
import { Badge, Button, Empty, JsonBlock, number, short, statusTone } from './ui.jsx';

function cardsForBoard(state) {
  const saved = new Map((state.cards || []).map((card) => [card.id, card]));
  const datasets = (state.datasets || []).map((dataset) => ({
    id: `dataset-${dataset.id}`,
    title: dataset.name,
    column: 'detected',
    datasetId: dataset.id,
    tags: [dataset.platform],
    signalCount: String(dataset.itemCount || 0),
    signalChange: 'Apify',
    priority: 'dataset',
    date: 'Dataset',
    ...(saved.get(`dataset-${dataset.id}`) || {}),
  }));
  const datasetCardIds = new Set(datasets.map((card) => card.id));
  return [...datasets, ...(state.cards || []).filter((card) => !datasetCardIds.has(card.id))];
}

function assetsForCard(state, cardId) {
  return (state.assets || []).filter((asset) => asset.cardId === cardId);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function KanbanView({ state, selectedDataset, busy, onMoveCard, onSaveCard, onGenerateAssets, onNavigate }) {
  const cards = cardsForBoard(state);
  const [selectedCardId, setSelectedCardId] = useState('');
  const selected = cards.find((card) => card.id === selectedCardId) || cards[0] || null;
  const selectCard = (card) => setSelectedCardId(card.id);
  const saveAndSelectCard = async (card) => {
    const saved = await onSaveCard(card);
    setSelectedCardId(saved?.id || card.id);
  };
  return (
    <section className="kanban-shell">
      <div className="kanban-board">
        {workflow.columns.map((column) => (
          <div className="kanban-column" key={column.id}>
            <div className="kanban-column-head"><strong>{column.name}</strong><Badge>{cards.filter((card) => card.column === column.id).length}</Badge></div>
            {cards.filter((card) => card.column === column.id).map((card) => (
              <article
                className={`kanban-card ${selected?.id === card.id ? 'active' : ''}`}
                key={card.id}
              >
                <button className="card-select" type="button" onClick={() => selectCard(card)} aria-pressed={selected?.id === card.id}>
                  <span><Badge tone={statusTone(card.column === 'ready' ? 'Ready' : card.column === 'generating' ? 'running' : '')}>{card.priority || card.column}</Badge><small>{card.date}</small></span>
                  <strong>{card.title}</strong>
                  <small>{number(String(card.signalCount || '0').replace(/\D/g, ''))} signals {card.signalChange ? `/ ${card.signalChange}` : ''}</small>
                  <span className="chip-row">{(card.tags || []).slice(0, 4).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</span>
                </button>
                <div className="button-row">
                  {workflow.columns.filter((col) => col.id !== card.column).slice(0, 3).map((col) => (
                    <Button
                      className="ghost"
                      key={col.id}
                      disabled={busy}
                      onClick={() => onMoveCard({ cardId: card.id, column: col.id, card })}
                    >
                      {col.name}
                    </Button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ))}
      </div>
      <AssetFactory
        busy={busy}
        card={selected}
        state={state}
        selectedDataset={selectedDataset}
        onSaveCard={saveAndSelectCard}
        onGenerateAssets={onGenerateAssets}
        onNavigate={onNavigate}
      />
    </section>
  );
}

function AssetFactory({ card, state, selectedDataset, busy, onSaveCard, onGenerateAssets, onNavigate }) {
  const [presetId, setPresetId] = useState(workflow.presets[0].id);
  const [cardError, setCardError] = useState('');
  const [savingCard, setSavingCard] = useState(false);
  const preset = workflow.presets.find((item) => item.id === presetId) || workflow.presets[0];
  const assets = card ? assetsForCard(state, card.id) : [];
  const doneCount = assets.filter((asset) => ['approved', 'done', 'posted'].includes(asset.status)).length;
  const runningCount = assets.filter((asset) => asset.status === 'running').length;
  const failedCount = assets.filter((asset) => asset.status === 'failed').length;
  const selectedTypes = preset.assetTypeIds;
  const draftTitle = selectedDataset?.name || '';

  return (
    <aside className="asset-factory panel">
      <div className="panel-head">
        <div><h3>Asset Factory</h3><p>{card ? card.title : 'Create or run a card to generate assets.'}</p></div>
        <Button className="ghost" onClick={() => onNavigate('assets')}>Library</Button>
      </div>
      {!card && <Empty title="Your content board is empty" detail="Collect a dataset to create a source card, or add your own idea below." action="Collect data" onAction={() => onNavigate('automation')} />}
      {card && (
        <>
          <div className="factory-summary">
            <Badge tone={statusTone(card.column === 'generating' ? 'running' : card.column === 'ready' ? 'Ready' : '')}>{card.column}</Badge>
            <strong>{doneCount} done / {runningCount} running / {failedCount} failed</strong>
          </div>
          <label>Generation preset
            <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              {workflow.presets.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.description}</option>)}
            </select>
          </label>
          <Button disabled={busy} onClick={() => onGenerateAssets({ card, assetTypeIds: selectedTypes, datasetId: card.datasetId || selectedDataset?.id })}>Generate {preset.name}</Button>
          <div className="asset-status-list">
            {workflow.assetTypes.map((assetType) => {
              const asset = assets.find((item) => item.assetType === assetType.id);
              return (
                <div className="asset-status" key={assetType.id}>
                  <span>{assetType.name}</span>
                  <Badge tone={statusTone(asset?.status)}>{asset?.status || 'not generated'}</Badge>
                  <Button className="ghost" disabled={busy} onClick={() => onGenerateAssets({ card, assetTypeIds: [assetType.id], datasetId: card.datasetId || selectedDataset?.id })}>Generate</Button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <form className="quick-card" onSubmit={async (event) => {
        event.preventDefault();
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        setCardError('');
        setSavingCard(true);
        try {
          await onSaveCard(cardDraftFromInput({
            title: form.get('title'),
            description: form.get('description'),
            tags: form.get('tags'),
          }, selectedDataset));
          formEl.reset();
        } catch (error) {
          setCardError(error.message || String(error));
        } finally {
          setSavingCard(false);
        }
      }}>
        <h3>New card</h3>
        <label>Card title<input name="title" defaultValue={draftTitle} placeholder="Your idea or research topic" required /></label>
        <label>Tags<input name="tags" placeholder="blog, linkedin, report" /></label>
        <label>Notes<textarea name="description" rows="3" placeholder="What would you like to create?" /></label>
        {cardError && <p className="field-error">{cardError}</p>}
        <Button disabled={busy || savingCard}>{savingCard ? 'Adding' : 'Add to Kanban'}</Button>
      </form>
    </aside>
  );
}

export function AssetsView({ state, onNavigate, onSaveAsset, onCreateCardFromAsset, onExportAssetPack, onOpenAssetsFolder, onOpenAsset, onRevealAsset }) {
  const assets = [...(state.assets || [])].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const statuses = [...new Set(assets.map((asset) => asset.status).filter(Boolean))].sort();
  const channels = [...new Set(assets.map((asset) => asset.channel).filter(Boolean))].sort();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = assets.filter((asset) => {
    const haystack = `${asset.title || ''} ${asset.markdown || ''} ${asset.error || ''}`.toLowerCase();
    return (!normalizedQuery || haystack.includes(normalizedQuery))
      && (status === 'all' || asset.status === status)
      && (channel === 'all' || asset.channel === channel);
  });
  const selected = filteredAssets.find((asset) => asset.id === selectedAssetId) || filteredAssets[0] || null;
  return (
    <section className="view-grid">
      <div className="panel">
        <div className="panel-head">
          <h3>Asset Library</h3>
          <div className="button-row">
            <Button className="ghost" onClick={onOpenAssetsFolder}>Folder</Button>
            <Button className="ghost" disabled={!filteredAssets.length} onClick={() => onExportAssetPack({ assetIds: filteredAssets.map((asset) => asset.id) })}>Export pack</Button>
            <Button onClick={() => onNavigate('kanban')}>Kanban</Button>
          </div>
        </div>
        <div className="asset-library-tools">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="all">All channels</option>
            {channels.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="asset-grid">
          {filteredAssets.map((asset) => (
            <button
              type="button"
              className={`asset-card ${selected?.id === asset.id ? 'active' : ''}`}
              key={asset.id}
              onClick={() => setSelectedAssetId(asset.id)}
              aria-pressed={selected?.id === asset.id}
            >
              <Badge tone={statusTone(asset.status)}>{asset.status}</Badge>
              <strong>{asset.title}</strong>
              <p>{short(asset.markdown || asset.error || asset.channel, 150)}</p>
              {asset.assetPath && <small>{asset.assetPath}</small>}
            </button>
          ))}
          {!assets.length && <Empty title="Library is empty" detail="Generate assets from a Kanban card to populate the library." action="Open Kanban" onAction={() => onNavigate('kanban')} />}
          {assets.length > 0 && filteredAssets.length === 0 && <Empty title="No matching assets" detail="Clear a filter or generate another asset pack from Kanban." />}
        </div>
      </div>
      <div className="panel asset-editor">
        <div className="panel-head"><h3>Asset Editor</h3><Badge>{selected?.channel || 'No asset'}</Badge></div>
        {selected ? (
          <AssetEditor
            key={selected.id}
            asset={selected}
            evidence={state.v5?.evidenceSummary?.sample || []}
            onSaveAsset={onSaveAsset}
            onCreateCardFromAsset={onCreateCardFromAsset}
            onOpenAsset={onOpenAsset}
            onRevealAsset={onRevealAsset}
          />
        ) : <JsonBlock value={{ assetTypes: workflow.assetTypes, automationRules: workflow.automationRules }} />}
        <WorkflowCatalog />
      </div>
    </section>
  );
}

function AssetEditor({ asset, evidence, onSaveAsset, onCreateCardFromAsset, onOpenAsset, onRevealAsset }) {
  const statusOptions = unique([asset.status, 'draft', 'in-review', 'running', 'failed', 'done', 'approved', 'posted']);
  const evalScore = evaluateArtifact(asset, evidence || []);
  const previewIssues = evalScore.issues.map((issue) => {
    if (issue === 'Some evidence IDs do not exist in the evidence graph.') return 'Some attached evidence IDs are outside the loaded preview.';
    if (issue.startsWith('Unsupported claim count:')) return `${evalScore.unsupportedClaims.length} sentences have no keyword match in the preview.`;
    return issue;
  });
  return (
    <form className="asset-edit-form" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSaveAsset({ ...asset, markdown: form.get('markdown'), status: form.get('status') });
    }}>
      <div className="artifact-eval">
        <Badge>{evalScore.score}/100 · heuristic</Badge>
        <div>
          <strong>Saved draft checks</strong>
          <small>{previewIssues.length ? previewIssues.join(' ') : 'Attached sources match the loaded preview.'}</small>
          <small>Keyword checks use a limited evidence preview. This score does not verify factual accuracy.</small>
        </div>
      </div>
      <select name="status" defaultValue={asset.status}>
        {statusOptions.map((status) => <option key={status}>{status}</option>)}
      </select>
      <textarea name="markdown" defaultValue={asset.markdown} rows="18" />
      {asset.evidenceIds?.length > 0 && (
        <div className="artifact-evidence">
          {asset.evidenceIds.map((id) => <span className="chip" key={id}>{id}</span>)}
        </div>
      )}
      {asset.assetPath && <code>{asset.assetPath}</code>}
      <div className="button-row">
        <Button>Save asset</Button>
        <Button type="button" className="ghost" onClick={() => onSaveAsset({ ...asset, status: 'approved' })}>Approve</Button>
        <Button type="button" className="ghost" onClick={() => onSaveAsset({ ...asset, status: 'in-review' })}>Send to review</Button>
        <Button type="button" className="ghost" onClick={() => onCreateCardFromAsset(cardFromAsset(asset))}>Create card</Button>
        <Button type="button" className="ghost" disabled={!asset.assetPath} onClick={() => onOpenAsset(asset.id)}>Open</Button>
        <Button type="button" className="ghost" disabled={!asset.assetPath} onClick={() => onRevealAsset(asset.id)}>Reveal</Button>
      </div>
    </form>
  );
}

function WorkflowCatalog() {
  return (
    <div className="workflow-catalog">
      <div>
        <h3>Asset Type Catalog</h3>
        <div className="catalog-grid">
          {workflow.assetTypes.map((assetType) => (
            <div className="catalog-item" key={assetType.id}>
              <strong>{assetType.name}</strong>
              <span>{assetType.channel}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3>Automation Rules</h3>
        <div className="rule-list">
          {workflow.automationRules.map((rule) => (
            <div className="rule-item" key={rule.id}>
              <strong>{rule.name}</strong>
              <span>{rule.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
