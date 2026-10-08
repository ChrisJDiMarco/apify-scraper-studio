// Deterministic stand-in for Claude across the research stages. It reads the same prompts the
// pipeline sends (the n8n-ported formats) and returns schema-valid outputs, so tests exercise the
// real orchestration, validation and caching without any provider calls.
function jsonAfter(prompt, marker) {
  const start = prompt.lastIndexOf(marker);
  if (start < 0) throw new Error(`Fixture could not find “${marker}” in the prompt.`);
  const text = prompt.slice(start + marker.length).trimStart();
  const open = text[0]; const close = open === '[' ? ']' : '}';
  let depth = 0; let inString = false; let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true; else if (ch === open) depth++; else if (ch === close && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error(`Fixture could not parse JSON after “${marker}”.`);
}
const stageOf = (request) => {
  const props = request.schema?.properties || {};
  if (props.candidates) return 'discovery';
  if (props.themes) return 'synthesis';
  if (props.matches) return 'matching';
  if (props.assignments) return 'tagging';
  if (props.executiveSummary) return 'trend-report';
  if (props.whatHappened) return 'toolkit';
  return 'content';
};
function discoveryPosts(request) { return jsonAfter(request.prompt, 'RAW DATA BATCH (sorted by engagement):'); }
function synthesisCandidates(request) { return jsonAfter(request.prompt, 'INPUT CANDIDATES:'); }
function taggingPosts(request) { const marker = request.prompt.match(/POSTS TO ANALYZE \(\d+\):/g)?.at(-1); return marker ? jsonAfter(request.prompt, marker) : []; }
function themeIds(request) { return [...request.prompt.matchAll(/^Theme ID: (\S+)$/gm)].map((match) => match[1]); }
function evidenceIds(request) { return [...request.prompt.matchAll(/EVIDENCE_ID: (\S+)/g)].map((match) => match[1]); }

function researchOutput(request, options = {}) {
  const theme = { name: 'Reporting Workflow Friction Surge', description: 'Manual dashboard work creates friction.', ...(options.theme || {}) };
  switch (stageOf(request)) {
    case 'discovery': {
      const posts = discoveryPosts(request);
      return { candidates: [{ name: options.candidateName || 'Reporting workflow friction', summary: 'The supplied people describe manual reporting work.', painPoint: 'Workflow/Resource Overload', semanticIntentSignals: ['manual reporting', 'dashboards take forever', 'reporting is a mess'], actionability: 'Reduce manual assembly.', evidenceIds: posts.map((post) => post.id) }] };
    }
    case 'synthesis': {
      const candidates = synthesisCandidates(request);
      return { themes: [{ name: theme.name, description: theme.description, candidateIds: candidates.map((c) => c.id), novelty: theme.novelty || 'NEW ANGLE', matchingKeywords: theme.matchingKeywords || ['reporting', 'dashboards'], matchingCriteria: 'Specific reporting workflow friction.', negativeCriteria: 'Generic praise.', taxonomyCategory: theme.taxonomyCategory || 'Reporting', contentGap: 'OPEN', gapRationale: '', recentTrend: 'DORMANT', crossPlatform: candidates.some((c) => (c.platforms || []).length > 1), totalEvidence: candidates.reduce((sum, c) => sum + (c.evidence_count || 0), 0) }] };
    }
    case 'matching': {
      const themes = jsonAfter(request.prompt, 'NEW THEMES:'); const existing = jsonAfter(request.prompt, 'tracked):');
      return { matches: themes.map((t) => { const same = existing.find((e) => options.matchExisting !== false && e.name.toLowerCase() === t.name.toLowerCase()); return { themeId: t.id, matchedExistingId: same ? same.id : null, finalName: same ? same.name : t.name, nameSource: same ? 'existing' : 'new', reason: same ? 'Same topic.' : 'New topic.' }; }) };
    }
    case 'tagging': {
      const posts = taggingPosts(request); const ids = themeIds(request);
      return { assignments: posts.map((post, index) => ({ itemId: post.record_id, reason: options.offTopicEvery && index % options.offTopicEvery === 1 ? 'Off topic.' : 'Describes manual reporting.', themeId: options.offTopicEvery && index % options.offTopicEvery === 1 ? null : ids[0], confidence: options.offTopicEvery && index % options.offTopicEvery === 1 ? 0.2 : 0.86, painPoint: 'Workflow/Resource Overload', urgency: 'Strategic Planning', entities: { tools: options.tools || ['Google Search Console'], people: [], companies: ['Google'] } })) };
    }
    case 'trend-report': {
      const ids = evidenceIds(request);
      return { executiveSummary: 'Practitioners report manual reporting friction across the sample.', trendSummary: 'Dashboards take too much manual work.', quotes: [], evidenceLinks: ids.slice(0, 2).map((evidenceId) => ({ evidenceId, description: 'Practitioner describes manual reporting.' })), painPoints: ['Workflow/Resource Overload', 'Proving ROI/Attribution', 'Technical Complexity'].map((label, index) => ({ label, postCount: index === 0 ? ids.length : 0, text: 'Manual reporting slows teams down.' })), opportunities: [1, 2, 3].map((n) => ({ label: `Opportunity ${n}`, text: 'Automate the reporting workflow.' })), technicalDetails: { tools: 'Google Search Console', companies: 'Google', developments: 'Reporting automation.' }, topPerformingContent: { highestEngagementEvidenceId: ids[0] || '', highestEngagementNote: 'Most engaged post in the sample.', mostDiscussedTopic: 'Manual reporting', mostRequestedFeature: 'Automated dashboards' }, keyTakeaways: ['Reporting is manual.', 'Teams want automation.', 'Measurement gaps persist.'], caveats: ['Fixture output.'] };
    }
    case 'toolkit': {
      const props = request.schema.properties;
      const enterpriseId = props.enterpriseAngle?.properties?.productId?.enum?.find((id) => id) || '';
      const selfServeId = props.selfServeAngle?.properties?.productId?.enum?.find((id) => id) || '';
      const five = (label) => [1, 2, 3, 4, 5].map((n) => `${label} ${n} about manual reporting friction`);
      return { trendName: theme.name, whatHappened: 'Practitioners describe manual reporting work that slows teams down.', whyMatters: { intro: 'Reporting time is going up.', painPoints: [1, 2, 3].map((n) => ({ label: `Pain ${n}`, text: 'Manual reporting takes hours.' })) }, howToTalk: { intro: 'Lead with the practitioner reality.', talkingPoints: [1, 2, 3].map((n) => ({ label: `Angle ${n}`, text: 'Teams need faster reporting.' })) }, enterpriseAngle: { productId: enterpriseId, paragraph: enterpriseId ? 'At enterprise scale reporting spans many teams.' : 'No approved Enterprise product is registered yet.', capabilities: [1, 2, 3].map((n) => ({ name: `Capability ${n}`, text: 'Automates reporting.' })) }, selfServeAngle: { productId: selfServeId, paragraph: selfServeId ? 'Small teams can automate the basics.' : 'No approved self-serve toolkit is registered yet.', keyTools: (options.keyTools || ['Tool A', 'Tool B', 'Tool C']).map((toolName) => ({ toolName, text: 'Helps with this trend.' })), alsoFits: { productId: '', toolNames: [], text: '' } }, headlines: five('Headline'), subheads: five('Subhead'), hooks: five('Hook'), ctas: { enterprise: ['Book an enterprise demo', 'Talk to sales'], plg: ['Start free', 'Try the toolkit', 'See the tools'] }, caveats: ['Fixture output.'] };
    }
    default: return null;
  }
}

module.exports = { researchOutput, stageOf, jsonAfter, discoveryPosts, synthesisCandidates, taggingPosts, themeIds, evidenceIds };
