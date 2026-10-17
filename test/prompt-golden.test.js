import { describe, expect, it } from 'vitest';
import { compareGoldens, goldenCases } from '../scripts/prompt-goldens.mjs';
const template = require('../src/shared/prompt-template');

// With no saved prompt versions, every builder must produce exactly the prompt it produced before the Prompt Library
// (SPEC-2 §A). scripts/prompt-goldens.mjs renders them from test/fixtures/prompts/inputs.json; this runs its --check.
describe('prompt goldens', () => {
  it('renders every prompt byte-identical to the saved goldens', () => {
    expect(compareGoldens()).toEqual([]);
  });

  it('covers every editable prompt in the library', () => {
    const ids = goldenCases().map((entry) => entry.id);
    // Channel asset instructions, picture variations and Create content pictures render inside the content-plan goldens.
    const coveredBy = (promptId) => (promptId.startsWith('assets.') || ['pictures.variations', 'pictures.content-image'].includes(promptId) ? 'assets.content-plan.' : promptId === 'data.dataset-report' ? 'data.report-preset.' : `${promptId}.`);
    const missing = template.REGISTRY.prompts.filter((entry) => entry.blocks.some((block) => block.editable)).map((entry) => entry.id).filter((promptId) => !ids.some((id) => id === promptId || id.startsWith(coveredBy(promptId))));
    expect(missing).toEqual([]);
  });

  it('renders no unfilled placeholder or preview marker in any golden', () => {
    for (const { id, render } of goldenCases()) {
      const text = render();
      expect(text, id).not.toMatch(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/);
      expect(text, id).not.toMatch(/[\uE000-\uE002]/);
    }
  });
});
