import { describe, it, expect } from 'vitest';
import { buildCandidates, candidatesFor, planModules, finalizeModules, canonicalUrl } from './editionSelect.mjs';
import { parseEditionConfig } from './editionConfig.mjs';
import { sampleEditionConfig } from './fixtures/editionFixtures.mjs';

const NOW = new Date('2026-11-24T12:30:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

function page(sources, briefing = []) {
  return { pageId: 'mainstream', sources, briefing };
}

describe('buildCandidates', () => {
  const pages = [page({
    bbc: { label: 'BBC News', row: 0, col: 1, items: [
      { id: 'b1', title: 'Fresh story about the senate vote', link: 'https://bbc.co.uk/a?at_medium=RSS', timestamp: hoursAgo(1), desc: 'blurb' },
      { id: 'b2', title: 'An old story from last week', link: 'https://bbc.co.uk/old', timestamp: hoursAgo(40) },
      { id: 'b3', title: 'No date here', link: 'https://bbc.co.uk/x' },
    ] },
    cnn: { label: 'CNN', row: 0, col: 0, items: [
      { id: 'c1', title: 'Senate vote fresh story about the', link: 'https://www.bbc.co.uk/a/', timestamp: hoursAgo(2) },
      { id: 'c2', title: 'Yesterday printed this already', link: 'https://cnn.com/printed', timestamp: hoursAgo(3) },
      { id: 'c3', title: 'Newest of all', link: 'https://cnn.com/new', timestamp: hoursAgo(0.5) },
    ] },
  }, [{ id: 'cl1', coverage: [{ id: 'b1', sourceId: 'bbc' }, { id: 'c3', sourceId: 'cnn' }] }])];

  it('filters by age, drops undated, dedupes by URL and against earlier editions, newest first', () => {
    const { candidates, counts } = buildCandidates({
      pages, now: NOW, maxAgeHours: 18,
      previousStories: [{ urls: ['https://cnn.com/printed'], titles: [] }],
    });
    expect(candidates.map((c) => c.title)).toEqual(['Newest of all', 'Fresh story about the senate vote']);
    expect(candidates.map((c) => c.id)).toEqual(['h1', 'h2']);
    expect(counts).toMatchObject({ headlines: 6, tooOld: 1, undated: 1, seenBefore: 1, repeated: 1 });
    expect(candidates[0]).toMatchObject({ sourceId: 'cnn', sourceLabel: 'CNN', col: 0, clusterId: 'cl1' });
  });

  it('dedupes against an earlier edition by normalized title too', () => {
    const { candidates } = buildCandidates({ pages, now: NOW, maxAgeHours: 18, previousStories: [{ titles: ['NEWEST of all!'] }] });
    expect(candidates.map((c) => c.title)).not.toContain('Newest of all');
  });

  it('caps the list', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, title: `Story number ${i} unique words ${i}`, link: `https://x.com/${i}`, timestamp: hoursAgo(i / 10) }));
    const { candidates } = buildCandidates({ pages: [page({ x: { label: 'X', items } })], now: NOW, maxAgeHours: 18, cap: 10 });
    expect(candidates).toHaveLength(10);
  });

  it('strips tracking params when canonicalizing', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=3#frag')).toBe('example.com/a?id=3');
  });
});

describe('candidatesFor', () => {
  it('holds a category to its sources and exclusions', () => {
    const cands = [{ id: 'h1', sourceId: 'bbc' }, { id: 'h2', sourceId: 'cnn' }, { id: 'h3', sourceId: 'ksl' }];
    expect(candidatesFor(cands, { sources: ['bbc', 'ksl'] }).map((c) => c.id)).toEqual(['h1', 'h3']);
    expect(candidatesFor(cands, { exclude: ['cnn'] }).map((c) => c.id)).toEqual(['h1', 'h3']);
  });
});

describe('planModules', () => {
  const cfg = parseEditionConfig(sampleEditionConfig());

  it('shows always-modules and weekday-modules on a weekday, draws one rotating slot', () => {
    const plan = planModules({ day: cfg.day, date: '2026-11-24', seed: 'office-paper' });
    expect(plan.modules).toEqual(expect.arrayContaining(['weather', 'calendar', 'todoist', 'school']));
    expect(plan.drawn).toHaveLength(1);
    expect(['yesterday', 'reflective']).toContain(plan.drawn[0]);
  });

  it('drops weekday modules on a weekend', () => {
    const plan = planModules({ day: cfg.day, date: '2026-11-28', seed: 'office-paper' });
    expect(plan.modules).not.toContain('school');
  });

  it('draws the same for the same date (recompose), and varies across dates', () => {
    const a = planModules({ day: cfg.day, date: '2026-11-24', seed: 'p' });
    const b = planModules({ day: cfg.day, date: '2026-11-24', seed: 'p' });
    expect(a.drawn).toEqual(b.drawn);
    const draws = new Set(Array.from({ length: 30 }, (_, i) => planModules({ day: cfg.day, date: `2026-12-${String(i + 1).padStart(2, '0')}`, seed: 'p' }).drawn[0]));
    expect(draws).toEqual(new Set(['yesterday', 'reflective']));
  });

  it('never repeats the module the previous edition carried', () => {
    for (let i = 1; i <= 20; i += 1) {
      const date = `2026-12-${String(i).padStart(2, '0')}`;
      expect(planModules({ day: cfg.day, date, previousModules: ['yesterday'], seed: 'p' }).drawn).toEqual(['reflective']);
    }
    expect(planModules({ day: cfg.day, date: '2026-12-01', previousModules: ['yesterday', 'reflective'], seed: 'p' }).drawn).toEqual([]);
  });

  it('weights the draw', () => {
    const day = { ...cfg.day, yesterday: { ...cfg.day.yesterday, weight: 50 } };
    const draws = Array.from({ length: 40 }, (_, i) => planModules({ day, date: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, seed: `s${i}` }).drawn[0]);
    expect(draws.filter((d) => d === 'yesterday').length).toBeGreaterThan(30);
  });
});

describe('finalizeModules', () => {
  it('keeps a when_notable module only when its facts are flagged', () => {
    const day = { weather: { show: 'when_notable' }, todoist: { show: 'when_notable' }, calendar: { show: 'always' } };
    const modules = ['weather', 'todoist', 'calendar'];
    const out = finalizeModules({ day, modules, facts: { weather: { notable: true }, todoist: { notable: false }, calendar: { items: [] } } });
    expect(out).toEqual(['weather', 'calendar']);
  });

  it('drops modules that gathered nothing', () => {
    expect(finalizeModules({ day: { weather: { show: 'always' } }, modules: ['weather'], facts: {} })).toEqual([]);
  });
});
