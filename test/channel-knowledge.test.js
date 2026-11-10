import { describe, expect, it } from 'vitest';
import content from '../src/shared/content-studio.js';
import FIELDS from '../src/shared/channel-knowledge.json';

describe('channel knowledge in the asset prompts', () => {
  const source = { kind: 'text', title: 'Clicks are leaving', text: 'AI answers take clicks from search results, and teams want to know what to do about it.' };
  it('adds the channel team’s notes to that channel’s deliverables only, on the plan every AI route runs', () => {
    const plan = content.buildContentPlan({ editionId: 'semrush', source, deliverableIds: ['blogshort', 'social'], channelKnowledge: { blogshort: 'Voice and tone: Plain and friendly.' } });
    const blog = plan.deliverables.find((row) => row.id === 'blogshort'); const social = plan.deliverables.find((row) => row.id === 'social');
    expect(blog.prompt).toContain('CHANNEL KNOWLEDGE FROM THE CHANNEL’S TEAM');
    expect(blog.prompt).toContain('Voice and tone: Plain and friendly.');
    expect(blog.prompt.indexOf('CHANNEL KNOWLEDGE')).toBeLessThan(blog.prompt.indexOf('UNTRUSTED_SOURCE_AND_BRAND_DATA'));
    expect(social.prompt).not.toContain('CHANNEL KNOWLEDGE');
  });
  it('leaves the prompt exactly as it was without any', () => {
    const before = content.buildContentPlan({ editionId: 'semrush', source, deliverableIds: ['blogshort'] }).deliverables[0].prompt;
    expect(content.buildContentPlan({ editionId: 'semrush', source, deliverableIds: ['blogshort'], channelKnowledge: {} }).deliverables[0].prompt).toBe(before);
  });
  it('defines each field once, with a limit', () => {
    expect(new Set(FIELDS.fields.map((field) => field.id)).size).toBe(FIELDS.fields.length);
    for (const field of FIELDS.fields) expect(field.limit).toBeGreaterThan(0);
  });
});
