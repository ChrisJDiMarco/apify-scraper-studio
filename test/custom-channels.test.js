import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
// The main-process modules share one registry through Node's require cache, as they do in the app; loading them all
// with require keeps the test on that same instance.
const require = createRequire(import.meta.url);
const custom = require('../src/shared/custom-channels.js');
const content = require('../src/shared/content-studio.js');
const kit = require('../src/shared/asset-kit.js');
const roles = require('../src/main/roles.js');
const channelView = require('../src/main/channel-view.js');
import KIT, { setCustomChannels, customChannelIdOf } from '../src/shared/channel-table.js';
import { channelOf, channelName, libraryChannels } from '../src/shared/library-tree.js';

const source = { id: 'brief', title: 'AI search is changing discovery', text: 'A supplied practitioner source says marketers see more traffic from AI answers. No measured results were supplied.', evidence: [] };

describe('channels an admin adds (custom-channels.js)', () => {
  afterEach(() => { custom.setCustomChannels([]); custom.setWorkspaceResolver(() => ''); setCustomChannels([]); });

  it('lists the current workspace’s added channel after the built-in ones, with a deliverable per format', () => {
    custom.setWorkspaceResolver(() => 'w1');
    custom.setCustomChannels([
      { id: 'c-podcast', workspaceId: 'w1', name: 'Podcast', short: 'Pod', formats: ['social', 'newsletter'] },
      { id: 'c-elsewhere', workspaceId: 'w2', name: 'Another workspace’s', formats: ['pr'] },
    ]);
    const folders = kit.kitFolders('general');
    expect(folders.at(-1)).toMatchObject({ id: 'c-podcast', name: 'Podcast', short: 'Pod', deliverableIds: ['c-podcast--social', 'c-podcast--newsletter'] });
    expect(folders.some((folder) => folder.id === 'c-elsewhere')).toBe(false);
    expect(kit.kitFolderFor('c-podcast--social', 'general').id).toBe('c-podcast');
    expect(kit.kitDeliverableIds('general')).toContain('c-podcast--newsletter');
    expect(roles.isChannelId('c-podcast')).toBe(true);
    expect(channelView.channelOf('c-podcast--social', 'general')).toBe('c-podcast');
  });

  it('writes an added channel’s format with the built-in format’s sections and instructions, filed under the channel', () => {
    custom.setCustomChannels([{ id: 'c-podcast', workspaceId: '', name: 'Podcast', formats: ['social'] }]);
    const plan = content.buildContentPlan({ source, deliverableIds: ['c-podcast--social'] });
    const builtIn = content.buildContentPlan({ source, deliverableIds: ['social'] });
    expect(plan.deliverables[0]).toMatchObject({ id: 'c-podcast--social', channel: 'Podcast', kind: 'text' });
    expect(plan.deliverables[0].sections).toEqual(builtIn.deliverables[0].sections);
    expect(plan.deliverables[0].prompt).toContain(builtIn.deliverables[0].prompt.split('DELIVERABLE:')[1].split('\n')[1]);
  });

  it('keeps a removed channel’s files readable but takes it out of every list', () => {
    custom.setCustomChannels([{ id: 'c-podcast', workspaceId: '', name: 'Podcast', formats: ['social'], archived: true }]);
    expect(kit.kitFolders('general').some((folder) => folder.id === 'c-podcast')).toBe(false);
    expect(roles.isChannelId('c-podcast')).toBe(false);
    expect(content.CONTENT_DELIVERABLES.some((entry) => entry.id === 'c-podcast--social')).toBe(true);
  });

  it('makes ids from names that never collide', () => {
    expect(custom.newChannelId('Podcast & Video!', [])).toBe('c-podcast-video');
    expect(custom.newChannelId('Podcast', ['c-podcast'])).toBe('c-podcast-2');
    expect(custom.baseDeliverableId('c-podcast--social')).toBe('social');
    expect(custom.baseDeliverableId('social')).toBe('social');
  });

  it('gives the renderer the same channel, filed the same way', () => {
    setCustomChannels([{ id: 'c-podcast', name: 'Podcast', short: 'Pod', formats: ['social'] }]);
    expect(KIT.folders.at(-1)).toMatchObject({ id: 'c-podcast', general: 'Podcast', deliverables: ['c-podcast--social'] });
    expect(customChannelIdOf('c-podcast--social')).toBe('c-podcast');
    expect(channelOf('c-podcast--social')).toBe('c-podcast');
    expect(channelName('c-podcast')).toBe('Podcast');
    expect(libraryChannels('general').map((row) => row.id)).toContain('c-podcast');
  });
});
