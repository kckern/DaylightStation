import { describe, it, expect, vi } from 'vitest';
import { pickSchema, writeSchema, checkPick, checkWrite } from './editionContracts.mjs';
import { structuredCall } from './structuredCall.mjs';

const CANDIDATES = [
  { id: 'h1', sourceId: 'bbc' }, { id: 'h2', sourceId: 'cnn' }, { id: 'h3', sourceId: 'ars' },
  { id: 'h4', sourceId: 'bbc' }, { id: 'h5', sourceId: 'cnn' },
];
const CATEGORIES = [
  { id: 'us', label: 'Nation', stories: 2 },
  { id: 'tech', label: 'Tech', sources: ['ars'], stories: 1 },
];

describe('checkPick', () => {
  it('drops unknown ids, ids outside a category\'s sources, and empty groups', () => {
    const pick = pickSchema.parse({
      lead: { ids: ['h1', 'h99'] },
      categories: [
        { id: 'us', stories: [{ ids: ['h2'], rank: 2 }, { ids: ['h77'], rank: 1 }, { ids: ['h4', 'h5'], rank: 3 }] },
        { id: 'tech', stories: [{ ids: ['h2'], rank: 1 }, { ids: ['h3'], rank: 2 }] },
        { id: 'sports', stories: [{ ids: ['h5'] }] },
      ],
    });
    const out = checkPick(pick, { candidates: CANDIDATES, categories: CATEGORIES });
    expect(out.lead).toEqual(['h1']);
    expect(out.categories).toEqual([
      { id: 'us', stories: [{ ids: ['h2'], rank: 1 }, { ids: ['h4', 'h5'], rank: 2 }] },
      { id: 'tech', stories: [{ ids: ['h3'], rank: 1 }] },
    ]);
    expect(out.unknownIds).toEqual(expect.arrayContaining(['h99', 'h77', 'category:sports']));
  });

  it('omits a category with nothing left', () => {
    const out = checkPick({ lead: { ids: ['h1'] }, categories: [{ id: 'us', stories: [{ ids: ['h2'] }] }, { id: 'tech', stories: [{ ids: ['h1'] }] }] },
      { candidates: CANDIDATES, categories: CATEGORIES });
    expect(out.categories.map((c) => c.id)).toEqual(['us']);
  });

  it('fails the run when every category is empty', () => {
    expect(() => checkPick({ lead: { ids: ['h1'] }, categories: [{ id: 'us', stories: [{ ids: ['nope'] }] }] }, { candidates: CANDIDATES, categories: CATEGORIES }))
      .toThrow(/every category empty/);
  });

  it('promotes a lead when the model gave none', () => {
    const out = checkPick({ categories: [{ id: 'us', stories: [{ ids: ['h2'], rank: 1 }, { ids: ['h4'], rank: 2 }] }] }, { candidates: CANDIDATES, categories: CATEGORIES });
    expect(out.lead).toEqual(['h2']);
    expect(out.categories[0].stories.map((s) => s.ids)).toEqual([['h4']]);
  });
});

describe('checkWrite', () => {
  it('keeps only stories tied to picked candidates and notes for modules on the page', () => {
    const pick = { lead: ['h1'], categories: [{ id: 'us', stories: [{ ids: ['h2'], rank: 1 }] }] };
    const written = writeSchema.parse({
      lead: { headline: 'L', body: 'b', sources: ['BBC'], ids: ['h1'] },
      sections: [
        { category: 'us', stories: [{ headline: 'A', body: 'a', ids: ['h2'] }, { headline: 'Invented', body: 'x', ids: ['h42'] }] },
        { category: 'sports', stories: [{ headline: 'S', body: 's', ids: ['h5'] }] },
      ],
      briefs: [{ text: 't', source: 'CNN', ids: ['h5'] }, { text: 'no ids', ids: [] }],
      day: { notes: [{ module: 'school', text: 'fine' }, { module: 'horoscope', text: 'no' }] },
    });
    const out = checkWrite(written, { pick, candidates: CANDIDATES, modules: ['school'] });
    expect(out.lead.headline).toBe('L');
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].stories.map((s) => s.headline)).toEqual(['A']);
    expect(out.dropped).toEqual(['Invented']);
    expect(out.briefs.map((b) => b.text)).toEqual(['t']);
    expect(out.day.notes.map((n) => n.module)).toEqual(['school']);
  });
});

describe('structuredCall', () => {
  const logger = { warn: vi.fn() };

  it('retries once with a correction note, then succeeds', async () => {
    const gateway = { chatStructured: vi.fn().mockResolvedValueOnce({ wrong: 1 }).mockResolvedValueOnce({ categories: [] }) };
    const out = await structuredCall({ gateway, messages: [{ role: 'user', content: 'x' }], schema: pickSchema.strict(), step: 'pick', logger });
    expect(out).toEqual({ categories: [] });
    expect(gateway.chatStructured).toHaveBeenCalledTimes(2);
    const second = gateway.chatStructured.mock.calls[1][0];
    expect(second.at(-1).content).toMatch(/did not match the required JSON shape/);
  });

  it('fails after the one retry', async () => {
    const gateway = { chatStructured: vi.fn().mockRejectedValue(new Error('bad json')) };
    await expect(structuredCall({ gateway, messages: [], schema: pickSchema, step: 'write', logger })).rejects.toThrow(/edition write: model output failed validation after one retry/);
    expect(gateway.chatStructured).toHaveBeenCalledTimes(2);
  });

  it('passes the configured model', async () => {
    const gateway = { chatStructured: vi.fn().mockResolvedValue({ categories: [] }) };
    await structuredCall({ gateway, messages: [], schema: pickSchema, step: 'pick', model: 'gpt-x', logger });
    expect(gateway.chatStructured.mock.calls[0][1]).toEqual({ model: 'gpt-x' });
  });
});
