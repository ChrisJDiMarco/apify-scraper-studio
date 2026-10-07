const REPORT_BY_KIND = {
  'lead-list': 'lead-list',
  'job-listings': 'lead-list',
  'company-profiles': 'account-intelligence',
  'social-posts': 'subreddit-pulse',
  reviews: 'market-scan',
  'ecommerce-products': 'competitive-report',
  'web-pages': 'market-scan',
  table: 'market-scan',
  empty: 'market-scan',
};

const SOCIAL_PLATFORMS = ['reddit', 'x', 'twitter', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function hasAny(text, words) {
  const haystack = lower(text);
  return words.some((word) => haystack.includes(word));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function itemText(item) {
  if (!item || typeof item !== 'object') return '';
  return cleanText(item.text || item.title || item.body || item.description || item.content || item.name || item.companyName || item.company);
}

function itemUrl(item) {
  if (!item || typeof item !== 'object') return '';
  return cleanText(item.url || item.href || item.link || item.permalink || item.postUrl || item.website);
}

function keyText(item) {
  if (!item || typeof item !== 'object') return '';
  return Object.keys(item).join(' ').toLowerCase();
}

function valueText(item) {
  if (!item || typeof item !== 'object') return cleanText(item);
  return Object.values(item).map((value) => {
    if (value && typeof value === 'object') return valueText(value);
    return cleanText(value);
  }).join(' ');
}

function fieldSet(items) {
  const fields = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) fields.add(key);
  }
  return Array.from(fields).sort();
}

function count(items, predicate) {
  return items.reduce((sum, item) => sum + (predicate(item) ? 1 : 0), 0);
}

function scoreKind(dataset, sample, fields) {
  const datasetText = `${dataset?.name || ''} ${dataset?.platform || ''} ${fields.join(' ')}`;
  const platform = lower(dataset?.platform);
  const socialPlatform = SOCIAL_PLATFORMS.includes(platform);
  const scored = {
    'lead-list': 0,
    'job-listings': 0,
    'company-profiles': 0,
    'social-posts': socialPlatform ? 2 : 0,
    reviews: 0,
    'ecommerce-products': 0,
    'web-pages': 0,
    table: 1,
  };

  for (const item of sample) {
    const keys = keyText(item);
    const values = lower(valueText(item));
    const text = lower(itemText(item));

    if (hasAny(`${keys} ${values}`, ['email', 'company', 'account', 'lead', 'prospect', 'domain'])) scored['lead-list'] += 2;
    if (hasAny(`${keys} ${values}`, ['companyname', 'company name', 'organization', 'firm'])) scored['company-profiles'] += 2;
    if (hasAny(`${keys} ${values}`, ['job', 'role', 'position', 'hiring', 'career', 'recruit'])) scored['job-listings'] += 3;
    if (hasAny(`${keys} ${values}`, ['price', 'sku', 'product', 'inventory', 'ratingcount'])) scored['ecommerce-products'] += 3;
    if (hasAny(`${keys} ${values}`, ['rating', 'review', 'stars', 'sentiment'])) scored.reviews += 3;
    if (hasAny(`${keys} ${text}`, ['author', 'username', 'comment', 'post', 'thread', 'likes', 'shares'])) scored['social-posts'] += 2;
    if (itemUrl(item)) scored['web-pages'] += 1;
  }

  if (hasAny(datasetText, ['lead', 'prospect', 'account', 'sales'])) scored['lead-list'] += 5;
  if (hasAny(datasetText, ['job', 'hiring', 'career', 'role'])) scored['job-listings'] += 2;
  if (hasAny(datasetText, ['review', 'rating'])) scored.reviews += 2;
  if (hasAny(datasetText, ['product', 'price', 'ecommerce', 'shop'])) scored['ecommerce-products'] += 2;
  if (hasAny(datasetText, ['competitor', 'competitive'])) scored['ecommerce-products'] += 1;

  return Object.entries(scored).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
}

function recommendation(dataset, kind, reportPresetId, itemCount) {
  if (!itemCount) {
    return [{
      id: 'run-recipe',
      action: 'run-recipe',
      label: 'Run a recipe',
      args: {},
      why: 'No normalized rows are available yet.',
    }];
  }

  return [
    {
      id: 'report',
      action: 'analyze-dataset',
      label: kind === 'lead-list' || kind === 'job-listings' ? 'Build lead report' : 'Build analyst report',
      args: { datasetId: dataset.id, kind: 'report', reportPresetId },
      why: 'Turn the dataset into a structured AI report.',
    },
    {
      id: 'export-csv',
      action: 'export-dataset',
      label: 'Export CSV',
      args: { datasetId: dataset.id, format: 'csv' },
      why: 'Make the normalized rows portable.',
    },
    {
      id: 'create-card',
      action: 'create-card',
      label: 'Create follow-up card',
      args: {
        datasetId: dataset.id,
        title: `${dataset.name || 'Dataset'} follow-up`,
      },
      why: 'Move the next decision into the production board.',
    },
  ];
}

function datasetHealth(itemCount, quality, warnings = []) {
  if (!itemCount) {
    return {
      score: 0,
      label: 'Empty',
      tone: 'warning',
      checks: ['Run the recipe again or inspect the Actor mapper before analysis.'],
    };
  }
  const textScore = Math.round((quality.textCoverage || 0) * 40);
  const urlScore = Math.round((quality.urlCoverage || 0) * 25);
  const volumeScore = Math.min(25, Math.round(Math.log10(itemCount + 1) * 12));
  const warningPenalty = Math.min(30, warnings.length * 12);
  const score = clamp(25 + textScore + urlScore + volumeScore - warningPenalty, 0, 100);
  const label = score >= 82 ? 'Excellent' : score >= 64 ? 'Healthy' : score >= 42 ? 'Needs review' : 'Weak';
  return {
    score,
    label,
    tone: score >= 64 ? 'ready' : 'warning',
    checks: [
      `${Math.round((quality.textCoverage || 0) * 100)}% text coverage`,
      `${Math.round((quality.urlCoverage || 0) * 100)}% URL coverage`,
      `${itemCount} normalized row${itemCount === 1 ? '' : 's'}`,
    ],
  };
}

function profileDataset(dataset = {}, payload = {}) {
  const items = list(payload.items);
  const sample = items.slice(0, 100);
  const fields = fieldSet(sample);
  const itemCount = items.length;

  if (!itemCount) {
    const quality = { textCoverage: 0, urlCoverage: 0 };
    const warnings = ['Dataset has no normalized rows.'];
    return {
      datasetId: dataset.id || '',
      name: dataset.name || 'Dataset',
      kind: 'empty',
      label: 'Empty dataset',
      confidence: 0,
      reportPresetId: 'market-scan',
      itemCount: 0,
      fields,
      health: datasetHealth(0, quality, warnings),
      quality,
      warnings,
      recommendedActions: recommendation(dataset, 'empty', 'market-scan', 0),
      summary: 'No normalized rows are available yet.',
    };
  }

  const textCoverage = count(sample, (item) => itemText(item)) / sample.length;
  const urlCoverage = count(sample, (item) => itemUrl(item)) / sample.length;
  const [kind, score] = scoreKind(dataset, sample, fields);
  const reportPresetId = REPORT_BY_KIND[kind] || 'market-scan';
  const warnings = [];

  if (textCoverage < 0.25) warnings.push('Most rows do not contain readable text.');
  if (urlCoverage < 0.25) warnings.push('Most rows do not include URLs.');

  return {
    datasetId: dataset.id || '',
    name: dataset.name || 'Dataset',
    kind,
    label: kind.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
    confidence: Number(clamp(0.35 + score / Math.max(8, sample.length * 6), 0.35, 0.98).toFixed(2)),
    reportPresetId,
    itemCount,
    fields,
    health: datasetHealth(itemCount, {
      textCoverage: Number(textCoverage.toFixed(2)),
      urlCoverage: Number(urlCoverage.toFixed(2)),
    }, warnings),
    quality: {
      textCoverage: Number(textCoverage.toFixed(2)),
      urlCoverage: Number(urlCoverage.toFixed(2)),
    },
    warnings,
    recommendedActions: recommendation(dataset, kind, reportPresetId, itemCount),
    summary: `${itemCount} ${kind.replace('-', ' ')} row${itemCount === 1 ? '' : 's'} ready for ${reportPresetId.replace('-', ' ')}.`,
  };
}

function buildStudioIntelligence(state = {}, readPayload = () => ({})) {
  const datasets = list(state.datasets).slice(0, 12);
  const datasetProfiles = datasets.map((dataset) => {
    try {
      return profileDataset(dataset, readPayload(dataset) || {});
    } catch (error) {
      return {
        datasetId: dataset.id || '',
        name: dataset.name || 'Dataset',
        kind: 'table',
        label: 'Dataset',
        confidence: 0,
        reportPresetId: 'market-scan',
        itemCount: Number(dataset.itemCount) || 0,
        fields: [],
        health: datasetHealth(Number(dataset.itemCount) || 0, { textCoverage: 0, urlCoverage: 0 }, [error.message || String(error)]),
        quality: { textCoverage: 0, urlCoverage: 0 },
        warnings: [error.message || String(error)],
        recommendedActions: recommendation(dataset, 'table', 'market-scan', Number(dataset.itemCount) || 0),
        summary: 'Dataset profile could not be read.',
      };
    }
  });
  const setupSteps = buildSetupSteps(state);
  const readiness = buildReadinessSummary(setupSteps);
  const workPlansByDataset = Object.fromEntries(datasetProfiles.map((profile) => [
    profile.datasetId,
    buildWorkPlan({ ...state, selectedDatasetId: profile.datasetId }, datasetProfiles, readiness),
  ]));
  const suggestedCommandsByDataset = Object.fromEntries(datasetProfiles.map((profile) => [
    profile.datasetId,
    suggestCommands({ ...state, selectedDatasetId: profile.datasetId }, datasetProfiles),
  ]));

  return {
    datasetProfiles,
    nextActions: selectedProfile(datasetProfiles, state.selectedDatasetId)?.recommendedActions || [],
    operatorBrief: buildOperatorBrief(state, datasetProfiles, readiness),
    readiness,
    setupSteps,
    suggestedCommands: suggestCommands(state, datasetProfiles),
    suggestedCommandsByDataset,
    summary: datasetProfiles[0]?.summary || 'Create or run a recipe to start the workspace brain.',
    workPlan: buildWorkPlan(state, datasetProfiles, readiness),
    workPlansByDataset,
  };
}

function step(id, label, detail, view, done) {
  return { id, label, detail, view, done: Boolean(done), status: 'next' };
}

function buildSetupSteps(state = {}) {
  const steps = [
    step('token', 'Connect Apify', 'Save your API token once in Settings.', 'settings', state.keys?.APIFY_API_TOKEN),
    step('recipe', 'Save a recipe', 'Choose an Actor or saved task to run repeatedly.', 'automation', list(state.recipes).length > 0),
    step('dataset', 'Run a scrape', 'Create the first normalized dataset.', 'automation', list(state.datasets).length > 0),
    step('analysis', 'Generate intelligence', 'Run a report, tags, or threads on the dataset.', 'reports', list(state.analyses).some((analysis) => analysis.status === 'succeeded')),
  ];
  const currentIndex = steps.findIndex((item) => !item.done);
  return steps.map((item, index) => ({
    ...item,
    status: item.done ? 'done' : index === currentIndex ? 'current' : 'next',
  }));
}

function readinessLabel(percent) {
  if (percent >= 100) return 'Ready';
  if (percent >= 75) return 'Almost ready';
  if (percent >= 50) return 'Data ready';
  if (percent > 0) return 'Setting up';
  return 'Needs setup';
}

function buildReadinessSummary(steps = []) {
  const items = list(steps);
  const total = items.length;
  const doneCount = count(items, (item) => item.status === 'done' || item.done);
  const percent = total ? Math.round((doneCount / total) * 100) : 0;
  const currentStep = items.find((item) => item.status === 'current') || items.find((item) => !item.done) || null;

  return {
    percent,
    doneCount,
    total,
    label: readinessLabel(percent),
    detail: currentStep ? `${currentStep.label} is next.` : 'All launch steps are complete.',
    currentStep,
    nextView: currentStep?.view || 'dashboard',
  };
}

function action(id, label, detail, view, actionName = 'navigate', args = {}, priority = 50) {
  return { id, label, detail, view, action: actionName, args, priority };
}

function hasSucceededAnalysis(state, datasetId, kind = '') {
  return list(state.analyses).some((analysis) => (
    analysis.datasetId === datasetId
    && analysis.status === 'succeeded'
    && (!kind || analysis.kind === kind)
  ));
}

function datasetItemCount(dataset, profile) {
  return Number(profile?.itemCount ?? dataset?.itemCount) || 0;
}

function selectedProfile(datasetProfiles = [], selectedDatasetId = '') {
  const profiles = list(datasetProfiles);
  return profiles.find((profile) => profile.datasetId === selectedDatasetId) || profiles[0] || null;
}

function buildWorkPlan(state = {}, datasetProfiles = [], readiness = null) {
  const recipes = list(state.recipes);
  const datasets = list(state.datasets);
  const profile = selectedProfile(datasetProfiles, state.selectedDatasetId);
  const dataset = datasets.find((item) => item.id === profile?.datasetId) || datasets[0] || null;
  const recipe = recipes[0] || null;
  const itemCount = datasetItemCount(dataset, profile);
  const datasetEmpty = Boolean(dataset) && itemCount === 0;
  const plan = [];

  if (!state.keys?.APIFY_API_TOKEN) {
    plan.push(action('connect-apify', 'Connect Apify', 'Save the API token once so recipes can run.', 'settings', 'navigate', {}, 100));
  }
  if (!recipes.length) {
    plan.push(action('save-recipe', 'Save a recipe', 'Create an Actor or saved-task recipe from a template.', 'automation', 'navigate', {}, 92));
  }
  if (state.keys?.APIFY_API_TOKEN && recipe && !datasets.length) {
    plan.push(action('run-first-scrape', `Run ${recipe.name || 'recipe'}`, 'Create the first normalized dataset from Apify.', 'automation', 'run-recipe', { recipeId: recipe.id }, 88));
  }
  if (datasetEmpty && state.keys?.APIFY_API_TOKEN && recipe) {
    plan.push(action('rerun-empty-dataset', `Rerun ${recipe.name || 'recipe'}`, 'Latest dataset is empty; rerun after checking Actor input or mapper.', 'automation', 'run-recipe', { recipeId: recipe.id }, 86));
  }
  if (dataset && profile?.health?.score < 64) {
    plan.push(action('inspect-dataset-health', 'Inspect dataset quality', profile.health.checks.join(' / '), 'datasets', 'navigate', { datasetId: dataset.id }, 76));
  }
  if (dataset && !datasetEmpty && !hasSucceededAnalysis(state, dataset.id, 'report')) {
    plan.push(action('generate-report', `Generate ${profile?.reportPresetId || 'market-scan'} report`, 'Turn the latest dataset into schema-valid analyst output.', 'reports', 'analyze-dataset', {
      datasetId: dataset.id,
      kind: 'report',
      reportPresetId: profile?.reportPresetId || 'market-scan',
    }, 84));
  }
  if (dataset && !datasetEmpty && !hasSucceededAnalysis(state, dataset.id, 'tag')) {
    plan.push(action('tag-dataset', 'Tag dataset', 'Classify rows so themes, entities, and evidence are easier to reuse.', 'reports', 'analyze-dataset', {
      datasetId: dataset.id,
      kind: 'tag',
    }, 70));
  }
  if (dataset && !datasetEmpty && !list(state.cards).some((card) => card.datasetId === dataset.id)) {
    plan.push(action('create-card', 'Create production card', 'Move the next follow-up into the Kanban pipeline.', 'kanban', 'create-card', {
      datasetId: dataset.id,
      title: `${dataset.name || 'Dataset'} follow-up`,
    }, 62));
  }
  if (readiness?.percent === 100 && !plan.length) {
    plan.push(action('run-fresh-loop', 'Run a fresh loop', 'Refresh data, generate intelligence, and keep the pipeline warm.', 'automation', 'navigate', {}, 50));
  }

  return plan
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6);
}

function buildOperatorBrief(state = {}, datasetProfiles = [], readiness = buildReadinessSummary(buildSetupSteps(state))) {
  const profile = selectedProfile(datasetProfiles, state.selectedDatasetId);
  if (readiness.percent < 100) {
    const setupBrief = `${readiness.label}: ${readiness.detail}`;
    return profile ? `${setupBrief} Latest dataset ${profile.name}: ${profile.summary}` : setupBrief;
  }
  if (profile) return `${profile.name}: ${profile.summary} Health is ${profile.health.label.toLowerCase()} at ${profile.health.score}%.`;
  return 'Workspace is ready. Run a recipe to start the next intelligence loop.';
}

function command(id, label, value, detail) {
  return { id, label, command: value, detail };
}

function suggestCommands(state = {}, datasetProfiles = list(state.intelligence?.datasetProfiles)) {
  const recipes = list(state.recipes);
  const datasets = list(state.datasets);
  const profile = selectedProfile(datasetProfiles, state.selectedDatasetId);

  if (!state.keys?.APIFY_API_TOKEN || !recipes.length) {
    return [
      command('scrape-market', 'Scrape market chatter', 'scrape reddit posts about my market', 'Shows missing setup until token and recipe exist.'),
      command('lead-sheet', 'Lead sheet', 'create a lead sheet from the latest dataset', 'Works after the first dataset lands.'),
    ];
  }

  if (!datasets.length) {
    return [
      command('run-latest-recipe', 'Run latest recipe', 'run the latest recipe', `Uses ${recipes[0].name || recipes[0].id}.`),
      command('scrape-fresh-leads', 'Fresh lead scan', 'scrape fresh leads and make a report', 'Starts with the saved recipe.'),
    ];
  }

  const first = profile?.reportPresetId === 'competitive-report'
    ? command('competitive-report', 'Competitive report', 'make me a competitor positioning report', 'Uses the current dataset profile.')
    : command('lead-sheet', 'Lead sheet', 'make me a lead sheet from the latest data', 'Report plus CSV export.');

  return [
    first,
    command('tag-thread', 'Tags and threads', 'tag and thread this dataset', 'Adds structured AI analysis.'),
    command('export-card', 'Export and card', 'export csv and create a kanban card', 'Moves the finding into production.'),
  ];
}

function pickDataset(state) {
  const datasets = list(state.datasets);
  return datasets.find((dataset) => dataset.id === state.selectedDatasetId) || datasets[0] || null;
}

function pickRecipe(state) {
  return list(state.recipes)[0] || null;
}

function profileForDataset(state, datasetId) {
  return list(state.intelligence?.datasetProfiles).find((profile) => profile.datasetId === datasetId) || null;
}

function reportPresetFor(text, profile) {
  if (hasAny(text, ['lead', 'prospect', 'sales sheet', 'lead sheet', 'hiring', 'recruit'])) return 'lead-list';
  if (hasAny(text, ['competitor', 'competitive', 'positioning'])) return 'competitive-report';
  if (hasAny(text, ['account', 'company', 'outreach'])) return 'account-intelligence';
  if (hasAny(text, ['reddit', 'subreddit', 'community'])) return 'subreddit-pulse';
  return profile?.reportPresetId || 'market-scan';
}

function addStep(steps, step) {
  const key = `${step.action}:${JSON.stringify(step.args || {})}`;
  if (!steps.some((item) => `${item.action}:${JSON.stringify(item.args || {})}` === key)) steps.push(step);
}

function planIntent(command, state = {}) {
  const text = lower(command);
  const dataset = pickDataset(state);
  const recipe = pickRecipe(state);
  const profile = dataset ? profileForDataset(state, dataset.id) : null;
  const steps = [];
  const missing = [];

  const wantsScrape = hasAny(text, ['scrape', 'crawl', 'collect', 'fetch', 'run recipe', 'run the recipe', 'listen']);
  const wantsLeadSheet = hasAny(text, ['lead sheet', 'lead list', 'prospect list', 'csv of leads']);
  const wantsExport = wantsLeadSheet || hasAny(text, ['export', 'csv', 'jsonl', 'spreadsheet', 'sheet']);
  const wantsTag = hasAny(text, ['tag', 'classify', 'label']);
  const wantsThread = hasAny(text, ['thread', 'conversation', 'discussion']);
  const wantsReport = wantsLeadSheet || hasAny(text, ['report', 'analyze', 'analysis', 'summary', 'summarize', 'brief', 'intel', 'intelligence']);
  const wantsCard = hasAny(text, ['card', 'kanban', 'task', 'follow up', 'follow-up']);

  if (wantsScrape) {
    if (!state.keys?.APIFY_API_TOKEN) missing.push('Save APIFY_API_TOKEN in Settings.');
    if (!recipe) missing.push('Create or save a recipe before asking the app to scrape.');
    if (recipe) {
      addStep(steps, {
        id: 'run-recipe',
        action: 'run-recipe',
        label: `Run ${recipe.name || recipe.id}`,
        args: { recipeId: recipe.id },
        why: 'The command asks for fresh scraped data.',
      });
    }
  }

  if (wantsTag || wantsThread || wantsReport || wantsExport || wantsCard) {
    if (!dataset) {
      missing.push('Run or select a dataset before asking for dataset work.');
    } else if (datasetItemCount(dataset, profile) === 0) {
      missing.push('Run the recipe again before asking AI to analyze an empty dataset.');
    } else {
      if (wantsTag) {
        addStep(steps, {
          id: 'tag-dataset',
          action: 'analyze-dataset',
          label: 'Tag dataset',
          args: { datasetId: dataset.id, kind: 'tag' },
          why: 'The command asks for item-level classification.',
        });
      }
      if (wantsThread) {
        addStep(steps, {
          id: 'thread-dataset',
          action: 'analyze-dataset',
          label: 'Find threads',
          args: { datasetId: dataset.id, kind: 'thread' },
          why: 'The command asks for conversation structure.',
        });
      }
      if (wantsReport) {
        const reportPresetId = reportPresetFor(text, profile);
        addStep(steps, {
          id: 'report-dataset',
          action: 'analyze-dataset',
          label: reportPresetId === 'lead-list' ? 'Build lead report' : 'Build report',
          args: { datasetId: dataset.id, kind: 'report', reportPresetId },
          why: 'The command asks for synthesized intelligence.',
        });
      }
      if (wantsExport) {
        addStep(steps, {
          id: 'export-dataset',
          action: 'export-dataset',
          label: wantsLeadSheet ? 'Export lead CSV' : 'Export dataset',
          args: { datasetId: dataset.id, format: text.includes('jsonl') ? 'jsonl' : 'csv' },
          why: 'The command asks for a portable file.',
        });
      }
      if (wantsCard) {
        addStep(steps, {
          id: 'create-card',
          action: 'create-card',
          label: 'Create follow-up card',
          args: {
            datasetId: dataset.id,
            title: `${dataset.name || 'Dataset'} follow-up`,
          },
          why: 'The command asks to move work into production.',
        });
      }
    }
  }

  if (!steps.length && !missing.length) {
    const workPlan = list(state.intelligence?.workPlan);
    const runnableWork = workPlan.filter((item) => item.action && item.action !== 'navigate');
    if (runnableWork.length) {
      for (const item of runnableWork.slice(0, 2)) {
        addStep(steps, {
          id: item.id,
          action: item.action,
          label: item.label,
          args: item.args || {},
          why: item.detail || 'Best next action for the current workspace.',
        });
      }
    } else if (dataset && profile?.recommendedActions?.length) {
      for (const action of profile.recommendedActions.slice(0, 2)) {
        addStep(steps, { ...action, why: action.why || 'Best next action for the current dataset.' });
      }
    } else if (recipe) {
      addStep(steps, {
        id: 'run-recipe',
        action: 'run-recipe',
        label: `Run ${recipe.name || recipe.id}`,
        args: { recipeId: recipe.id },
        why: 'No dataset exists yet, so fresh data is the next useful step.',
      });
    } else {
      missing.push('Create a recipe or run a dataset first.');
    }
  }

  return {
    command: cleanText(command),
    intent: wantsScrape ? 'scrape' : wantsLeadSheet ? 'lead-sheet' : wantsReport ? 'analysis' : wantsExport ? 'export' : wantsCard ? 'production-card' : 'next-best-action',
    confidence: steps.length ? Number(clamp(0.55 + steps.length * 0.12, 0.55, 0.92).toFixed(2)) : 0.35,
    targetDatasetId: dataset?.id || '',
    targetRecipeId: recipe?.id || '',
    profile,
    steps,
    missing: [...new Set(missing)],
    canRun: steps.length > 0 && missing.length === 0,
    summary: steps.length ? steps.map((step) => step.label).join(' -> ') : 'Needs setup before it can run.',
  };
}

module.exports = {
  buildReadinessSummary,
  buildSetupSteps,
  buildStudioIntelligence,
  buildWorkPlan,
  planIntent,
  profileDataset,
  suggestCommands,
};
