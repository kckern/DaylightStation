import { describe, it, expect } from 'vitest';
import { fitLayout, buildLayout, NEVER_DROP } from './editionLayout.mjs';
import { parseEditionConfig } from './editionConfig.mjs';
import { sampleEditionConfig } from './fixtures/editionFixtures.mjs';

/** Height = a fixed cost per block and per story, so drops are predictable. */
const measureBy = (layout) => {
  let cm = 0;
  for (const b of layout.blocks) {
    if (b.type === 'section') cm += 2 + b.stories.length * 5;
    else if (b.type === 'briefs') cm += b.items.length * 1;
    else if (b.type === 'lead') cm += 8;
    else cm += 3;
  }
  return Promise.resolve({ heightCm: cm });
};

const story = (headline, rank) => ({ headline, body: 'b', sources: [], ids: [headline], rank });

function layout() {
  return {
    masthead: { title: 'T', dateLabel: 'D', number: 1 },
    blocks: [
      { type: 'weather', condition: 'Clear', high: 50, low: 30 },
      { type: 'agenda', label: 'Today', items: [] },
      { type: 'tasks', label: 'To do', items: [] },
      { type: 'lead', headline: 'Lead', body: 'b', sources: [] },
      { type: 'section', label: 'Nation', category: 'us', stories: [story('us1', 1), story('us2', 2), story('us3', 3)] },
      { type: 'section', label: 'World', category: 'world', stories: [story('w1', 1), story('w2', 2)] },
      { type: 'section', label: 'Utah', category: 'local', optional: true, stories: [story('l1', 1)] },
      { type: 'briefs', label: 'In brief', items: [{ text: 'a' }, { text: 'b' }] },
      { type: 'note', label: 'School', text: 'x' },
      { type: 'footer', text: 'f' },
    ],
  };
}

describe('fitLayout', () => {
  it('leaves a page that fits alone', async () => {
    const out = await fitLayout(layout(), measureBy, 100);
    expect(out.dropped).toEqual([]);
    expect(out.overflow).toBe(false);
  });

  it('drops briefs first, then the lowest-ranked story of the longest section, then optional sections', async () => {
    // Full page: 9 (weather/agenda/tasks) + 8 lead + 17 + 12 + 7 + 2 + 3 + 3 = 61.
    const out = await fitLayout(layout(), measureBy, 40);
    expect(out.dropped.map((d) => d.what === 'story' ? `story:${d.headline}` : d.what === 'section' ? `section:${d.section}` : d.what))
      .toEqual(['brief', 'briefs', 'story:us3', 'story:us2', 'story:w2', 'section:Utah']);
    expect(out.heightCm).toBeLessThanOrEqual(40);
  });

  it('never drops the masthead, weather, agenda or lead, and reports overflow', async () => {
    const out = await fitLayout(layout(), measureBy, 5);
    const types = out.layout.blocks.map((b) => b.type);
    for (const kept of NEVER_DROP) expect(types).toContain(kept);
    expect(out.layout.masthead.title).toBe('T');
    expect(out.overflow).toBe(true);
    expect(types.filter((t) => t === 'section')).toHaveLength(1);
  });

  it('does not change the input layout', async () => {
    const input = layout();
    await fitLayout(input, measureBy, 10);
    expect(input.blocks).toHaveLength(10);
  });
});

describe('buildLayout', () => {
  const cfg = parseEditionConfig(sampleEditionConfig());

  it('puts code-owned blocks first, sections in config order, notes before the footer', () => {
    const out = buildLayout({
      cfg, date: '2026-11-24', number: 7,
      modules: ['weather', 'calendar', 'todoist', 'school'],
      facts: {
        weather: { condition: 'Snow', highF: 41, lowF: 22, precipPct: 70 },
        calendar: { items: [{ time: '9:00 AM', text: 'Sync' }], today: 1 },
        todoist: { items: [{ text: 'Pay', overdue: true }] },
        school: { learners: [{ child: 'Sam', served: 5, asked: 6, silver: 3 }] },
      },
      written: {
        lead: { headline: 'L', body: 'b', sources: ['BBC'], ids: ['h1'] },
        sections: [
          { category: 'world', stories: [{ headline: 'W', body: 'w', sources: [], ids: ['h3'], rank: 1 }] },
          { category: 'us', stories: [{ headline: 'U2', body: 'u', sources: [], ids: ['h4'], rank: 2 }, { headline: 'U1', body: 'u', sources: [], ids: ['h2'], rank: 1 }] },
        ],
        briefs: [],
        day: { weather_note: 'Slick roads.', notes: [] },
      },
      composedLabel: '5:31 AM',
      headlineCount: 200,
    });
    expect(out.masthead).toMatchObject({ title: 'The Daylight Ledger', dateLabel: 'Tuesday, November 24, 2026', number: 7, weatherLabel: '41°/22°' });
    expect(out.blocks.map((b) => b.type)).toEqual(['weather', 'agenda', 'tasks', 'lead', 'section', 'section', 'note', 'footer']);
    expect(out.blocks[4].label).toBe('Nation');
    expect(out.blocks[4].stories.map((s) => s.headline)).toEqual(['U1', 'U2']);
    expect(out.blocks[0].note).toBe('Slick roads.');
    expect(out.blocks[6]).toMatchObject({ label: 'School', text: 'Sam 5 of 6 done, 3 silver' });
    expect(out.blocks[7].text).toBe('Composed 5:31 AM from 200 headlines · 4 stories');
  });
});
