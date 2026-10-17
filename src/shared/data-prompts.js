'use strict';
// Data tools prompts (Advanced → Data tools): dataset reports and their playbook presets, item tags, conversation threads,
// the analysis rules and the Workflows asset pack. The instructions are Prompt Library blocks (prompt-defaults.json);
// the "Read <file>" lead and "Return only schema-valid JSON." stay fixed, because research-workspace.js finds
// "\nSOURCE_ITEMS (untrusted evidence):\n" in a saved prompt.txt to recover older analyses. Pure, main-only.
const { reportPresetById } = require('./codex-runner');
const { promptBlocks, fill, defaultText, traceMark } = require('./prompt-template');

const EDITION = 'general'; // these prompts have one text for both editions
const lead = (itemsPath, contextPath) => (contextPath ? `First read ${contextPath} for dataset profile, health, and run rules. Then read ${itemsPath}.` : `Read ${itemsPath}.`);

// `blocks` is the saved text of the prompt this kind uses (data.dataset-report, data.tag-items or data.threads), as
// prompt-store effective() returns it; without it the defaults apply and the prompt matches codex-runner's buildPrompt.
function datasetPrompt(kind, itemsPath, { contextPath = '', reportPresetId = '', blocks = null, trace = false } = {}) {
  const first = lead(itemsPath, contextPath);
  if (kind === 'thread') return `${first} ${promptBlocks('data.threads', EDITION, blocks, { trace }).put('instruction')} Return only schema-valid JSON.`;
  if (kind === 'report') {
    const preset = reportPresetById(reportPresetId); const b = promptBlocks('data.dataset-report', EDITION, blocks, { trace });
    const presetInstruction = Object.hasOwn(b.texts, `preset-${preset.id}`) ? b.put(`preset-${preset.id}`) : preset.instruction;
    return `${first} ${b.put('frame', { presetName: preset.name, presetInstruction })} Return only schema-valid JSON.`;
  }
  return `${first} ${promptBlocks('data.tag-items', EDITION, blocks, { trace }).put('instruction')} Return only schema-valid JSON.`;
}
// The rules sent inside ANALYSIS_CONTEXT (one per line in the data.analysis-rules block).
function analysisRules(blocks = null) {
  return promptBlocks('data.analysis-rules', EDITION, blocks).raw('rules').split('\n').map((line) => line.trim()).filter(Boolean);
}
// A dataset analysis prompt as analyzeDataset sends it (and saves to prompt.txt). analysisContext.rules should already be
// analysisRules(<data.analysis-rules blocks>); traceRules marks each rule for the preview.
function analysisPrompt({ kind, reportPresetId = '', analysisContext, coverage, items, blocks = null, trace = false, traceRules = false } = {}) {
  const context = traceRules ? { ...analysisContext, rules: (analysisContext.rules || []).map((rule) => traceMark('rules', rule)) } : analysisContext;
  return datasetPrompt(kind, 'the SOURCE_ITEMS section below', { reportPresetId, blocks, trace }) + '\nANALYSIS_CONTEXT:\n' + JSON.stringify(context) + '\nCOVERAGE:\n' + JSON.stringify(coverage) + '\nSOURCE_ITEMS (untrusted evidence):\n' + JSON.stringify(items);
}
// The Workflows card asset pack; `context` is the JSON the card's run wrote.
function assetPackPrompt(context, { blocks = null, trace = false } = {}) {
  return `${promptBlocks('data.workflow-asset-pack', EDITION, blocks, { trace }).put('instruction')} Return the requested schema.\nCONTEXT:\n${context}`;
}
// The one line Codex receives (view-only in the library); index.js sends the same words.
function codexWrapper(contextPath) { return fill(defaultText('system.codex-wrapper', 'text'), { contextPath }); }

module.exports = { datasetPrompt, analysisRules, analysisPrompt, assetPackPrompt, codexWrapper };
