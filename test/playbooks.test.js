import { describe, expect, it } from 'vitest';
import core from '../src/shared/workflow-core.js';
import research from '../src/shared/research-program.js';
import kit from '../src/shared/asset-kit.js';
import catalog from '../src/shared/playbooks.json';

const source = { id: 'program-src', name: 'SEO weekly', sourceGroups: [{ sourceId: 'x', platform: 'x', targets: ['semrush'], enabled: true }, { sourceId: 'reddit', platform: 'reddit', targets: ['seo'], enabled: true }], schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false, maxThemes: 6, budgets: { collectionUsd: 5, aiUsd: 10 } };
const answers = { topic: 'SEO', competitors: 'Acme, Globex', accounts: '@acme r/acme https://www.linkedin.com/company/acme', product: 'Semrush One', launchDate: '2026-10-25' };
const now = new Date('2026-10-17T12:00:00Z');
const DECLARED_EXTRA = ['brand'];

describe('the playbook catalog', () => {
  for (const editionId of ['general', 'semrush']) {
    for (const playbook of catalog.playbooks) {
      it(`${playbook.id} sets up a valid program and workflow (${editionId})`, () => {
        const kitFolderIds = kit.kitFolders(editionId).map((folder) => folder.id);
        const made = core.instantiatePlaybook(playbook, answers, { editionId, brand: 'Semrush', programs: [source], timeZone: 'America/New_York', sourceProgramId: source.id, kitFolderIds });
        expect(made.missing).toEqual([]);
        const programs = [source];
        if (made.program) {
          const program = research.validateResearchProgram(made.program);
          expect(program.schedule.enabled).toBe(false);
          expect(program.autoApproveThemes).toBe(false);
          expect(program.sourceGroups.length).toBeGreaterThan(0);
          // The AI cap covers discovering trends with the default models, so a start is never refused.
          const estimate = research.estimateResearchCost(program);
          expect(program.budgets.aiUsd).toBeGreaterThanOrEqual((estimate.stages.discovery + estimate.stages.synthesis + estimate.stages.matching) * 0.5);
          programs.push(program);
        }
        const { workflow } = core.validateWorkflow(made.workflow, { programs, kitFolderIds, now });
        for (const step of workflow.steps) for (const channel of [...(step.channels || [])]) expect(kitFolderIds).toContain(channel);
        if (workflow.trigger.kind === 'schedule' && workflow.trigger.schedule.frequency === 'hourly') expect(workflow.steps[0].kind).toBe('quick-scan');
      });
    }
  }
  it('declares every template variable it uses', () => {
    for (const playbook of catalog.playbooks) {
      const declared = [...playbook.inputs.map((input) => input.id), ...DECLARED_EXTRA];
      for (const name of core.templateNames(playbook)) expect(declared, `${playbook.id} uses {{${name}}}`).toContain(name);
    }
  });
  it('fills names, notes and edition channels', () => {
    const newsletter = catalog.playbooks.find((row) => row.id === 'newsletter-prep');
    const semrush = core.instantiatePlaybook(newsletter, answers, { editionId: 'semrush', programs: [source], sourceProgramId: source.id });
    expect(semrush.workflow.steps.find((step) => step.kind === 'assets').channels).toEqual(['newsletter', 'explodingtopics']);
    const general = core.instantiatePlaybook(newsletter, answers, { editionId: 'general', programs: [source], sourceProgramId: source.id });
    expect(general.workflow.steps.find((step) => step.kind === 'assets').channels).toEqual(['newsletter']);
    const competitors = core.instantiatePlaybook(catalog.playbooks.find((row) => row.id === 'competitor-launch-watch'), answers, { brand: 'Semrush', programs: [] });
    expect(competitors.program).toMatchObject({ name: 'Competitor launches: Acme, Globex', query: 'Launches, pricing changes and new features from Acme, Globex', notes: { reports: 'Lead with what changed and how it compares to Semrush; no roadmap speculation.' } });
    const pulse = core.instantiatePlaybook(catalog.playbooks.find((row) => row.id === 'product-launch-pulse'), answers, { programs: [source], sourceProgramId: source.id, timeZone: 'UTC' });
    expect(pulse.program).toBeNull();
    expect(pulse.workflow.trigger.schedule).toMatchObject({ frequency: 'hourly', everyHours: 6, until: '2026-10-28', timeZone: 'UTC' });
  });
  it('says what is missing instead of guessing', () => {
    const competitors = core.instantiatePlaybook(catalog.playbooks.find((row) => row.id === 'competitor-launch-watch'), {}, { programs: [] });
    expect(competitors.missing.map((row) => row.field)).toEqual(['inputs.competitors', 'inputs.accounts', 'inputs.accounts']);
    const weekly = core.instantiatePlaybook(catalog.playbooks.find((row) => row.id === 'weekly-seo-trend-watch'), { topic: 'SEO' }, { programs: [] });
    expect(weekly.missing).toEqual([{ field: 'inputs.program', message: 'Choose a program to copy accounts from, or enter accounts.' }]);
    const existing = core.instantiatePlaybook(catalog.playbooks.find((row) => row.id === 'weekly-seo-trend-watch'), { topic: 'SEO' }, { programs: [source], sourceProgramId: source.id, programMode: 'existing' });
    expect(existing).toMatchObject({ program: null, programMode: 'existing', programId: source.id });
  });
});
