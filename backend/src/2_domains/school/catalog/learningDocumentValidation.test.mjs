import { describe, expect, it } from 'vitest';
import { validateLearningDocument } from './learningDocumentValidation.mjs';

const document = {
  schema: 'school.learning-document/v1',
  documentId: 'physics/velocity-notes',
  title: 'Constant velocity',
  blocks: [
    { blockId: 'intro', type: 'prose', text: 'Velocity describes displacement over time.' },
    {
      blockId: 'formula', type: 'formula', text: 'v = d / t', latex: 'v=\\frac{d}{t}',
      variables: [{ symbol: 'v', meaning: 'velocity' }],
    },
    {
      blockId: 'example', type: 'worked_example', prompt: 'Travel 12 m in 3 s.',
      steps: ['Substitute d=12 and t=3.', 'Divide 12 by 3.'], result: 'v = 4 m/s',
    },
    {
      blockId: 'values', type: 'table', columns: ['Time', 'Position'],
      rows: [['0 s', '0 m'], ['1 s', '4 m']],
    },
    {
      blockId: 'graph', type: 'tool_invitation', capability: 'graph@1',
      label: 'Explore the graph', config: { equations: ['4X'] },
    },
    {
      blockId: 'worksheet', type: 'scan_action', actionId: 'worksheet:velocity',
      label: 'Open worksheet',
    },
  ],
};

describe('School learning-document contract', () => {
  it('accepts generic reader blocks and derives renderer/tool capabilities', () => {
    expect(validateLearningDocument(document)).toMatchObject({
      errors: [],
      capabilities: ['reader@1', 'math@1', 'table-layout@1', 'graph@1', 'scan-action@1'],
    });
  });

  it('requires a portable formula fallback and exact table width', () => {
    const invalid = structuredClone(document);
    delete invalid.blocks[1].text;
    invalid.blocks[3].rows[0].pop();
    const errors = validateLearningDocument(invalid).errors;
    expect(errors).toContain('blocks[1].text: is required as a portable fallback');
    expect(errors).toContain('blocks[3].rows[0]: must contain 2 non-empty string cells');
  });

  it('rejects duplicate stable block IDs and executable block inventions', () => {
    const invalid = structuredClone(document);
    invalid.blocks[1].blockId = 'intro';
    invalid.blocks.push({ blockId: 'code', type: 'assembly', source: 'C9' });
    const errors = validateLearningDocument(invalid).errors;
    expect(errors).toContain("blocks[1].blockId: duplicate block 'intro'");
    expect(errors.some((error) => error.includes('type: must be one of'))).toBe(true);
  });

  it('keeps opaque action tokens and QR modules out of authored content', () => {
    const invalid = structuredClone(document);
    invalid.blocks[5].token = 'sch:23456789ABCDEFGH';
    invalid.blocks[5].qrModules = [1, 2, 3];
    expect(validateLearningDocument(invalid).errors).toContain(
      'blocks[5].token: and QR modules are server-issued and must not be authored',
    );
  });
});
