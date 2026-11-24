/**
 * Test harness for EditionService: fakes for every injected port, wired to
 * the real gatherer, renderer and pure pipeline.
 */
import { vi } from 'vitest';
import { EditionService } from '../../EditionService.mjs';
import { EditionGatherer } from '../editionGather.mjs';
import { NewspaperRenderer } from '../../../rendering/NewspaperRenderer.mjs';
import { sampleEditionConfig } from './editionFixtures.mjs';

export const TZ = 'America/Denver';
/** 06:30 in Denver on Tuesday 2026-11-24. */
export const MORNING = new Date('2026-11-24T13:30:00Z');

export function quietLogger() {
  const logger = { events: [] };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = vi.fn((event, data) => logger.events.push({ level, event, data }));
  }
  logger.child = () => logger;
  return logger;
}

export class MemoryEditionStore {
  constructor() { this.records = new Map(); this.pngs = new Map(); }
  async get(id, date) { const r = this.records.get(`${id}/${date}`); return r ? structuredClone({ ...r, date }) : null; }
  async save(id, date, record) { this.records.set(`${id}/${date}`, structuredClone({ ...record, date })); }
  async list(id, { limit = 30, before = null } = {}) {
    return [...this.records.entries()]
      .filter(([k]) => k.startsWith(`${id}/`)).map(([k, r]) => ({ ...r, date: k.split('/')[1] }))
      .filter((r) => !before || r.date < before)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map((r) => structuredClone(r));
  }
  async savePng(id, date, buffer) { this.pngs.set(`${id}/${date}`, buffer); }
  async readPng(id, date) { return this.pngs.get(`${id}/${date}`) || null; }
  async pngPath(id, date) { return this.pngs.has(`${id}/${date}`) ? `/media/newsreporter/${id}/${date}.png` : null; }
}

const ago = (h) => new Date(MORNING.getTime() - h * 3600e3).toISOString();

export function headlineServiceFake({ fail = false } = {}) {
  const sources = {
    bbc: { label: 'BBC News', row: 0, col: 1, items: [
      { id: 'b1', title: 'Senate passes the stopgap budget bill', desc: 'Funding runs to January.', link: 'https://bbc.example/budget', timestamp: ago(2) },
      { id: 'b2', title: 'Geneva summit opens with ceasefire talks', desc: 'Delegates meet.', link: 'https://bbc.example/geneva', timestamp: ago(3) },
    ] },
    cnn: { label: 'CNN', row: 0, col: 0, items: [
      { id: 'c1', title: 'Budget stopgap clears the Senate', desc: 'Vote was 70-30.', link: 'https://cnn.example/budget', timestamp: ago(1) },
      { id: 'c2', title: 'Holiday travel record expected', desc: 'Airlines busy.', link: 'https://cnn.example/travel', timestamp: ago(4) },
    ] },
    arstechnica: { label: 'Ars Technica', row: 1, col: 2, items: [
      { id: 'a1', title: 'A new browser engine ships an alpha', desc: 'Slow but real.', link: 'https://ars.example/engine', timestamp: ago(5) },
    ] },
    ksl: { label: 'KSL', row: 1, col: 0, items: [] },
  };
  return {
    getPageList: vi.fn(() => [{ id: 'mainstream', label: 'Mainstream' }]),
    getAllHeadlines: vi.fn(async () => {
      if (fail) throw new Error('headline cache unreadable');
      return { sources: structuredClone(sources), briefing: [{ id: 'cl-budget', coverage: [{ id: 'b1', sourceId: 'bbc' }, { id: 'c1', sourceId: 'cnn' }] }] };
    }),
  };
}

export function feedSourcesFake({ failing = [] } = {}) {
  const make = (sourceType, items) => ({
    sourceType,
    fetchItems: vi.fn(async () => {
      if (failing.includes(sourceType)) throw new Error(`${sourceType} down`);
      return items;
    }),
  });
  return [
    make('weather', [{ title: 'Light snow', meta: { tempF: 30, forecast: { condition: 'Light snow', highF: 41, lowF: 22, precipPct: 65 } } }]),
    make('tasks', [{ title: 'Renew registration', meta: { isOverdue: true } }, { title: 'Order the turkey', meta: { isOverdue: false } }]),
    make('strava', [{ title: 'Ride', body: '6.1 mi · 42 min', timestamp: '2026-11-23' }]),
    make('health', [{ body: '9840 steps' }]),
    make('immich', [{ title: 'Lake house', subtitle: 'Nov 2021' }]),
    make('journal', [{ title: 'Tue, Nov 3, 2020', body: 'A good day.' }]),
    make('gratitude', [{ body: 'Warm socks' }]),
  ];
}

const DECISIONS = {
  'Budget stopgap clears the Senate': { category: 'us', interest: 3 },
  'Senate passes the stopgap budget bill': { category: 'us', interest: 3 },
  'Geneva summit opens with ceasefire talks': { category: 'world', interest: 2.5 },
  'Holiday travel record expected': { category: 'us', interest: 1.5 },
  'A new browser engine ships an alpha': { category: 'tech', interest: 2 },
};

export function decisionGatewayFake({ configured = true, failAll = false } = {}) {
  return {
    isConfigured: () => configured,
    evaluate: vi.fn(async (state, questions) => {
      if (failAll) throw new Error('jev down');
      const d = DECISIONS[state.title] || { category: 'none', interest: 0 };
      const options = Object.keys(questions.category.options);
      const chosen = options.includes(d.category) ? d.category : 'none';
      const probabilities = Object.fromEntries(options.map((k) => [k, k === chosen ? 0.8 : 0.2 / options.length]));
      return { model: 'jev-fake', answers: { category: { type: 'choice', choice: chosen, confidence: 0.5, probabilities }, interest: { type: 'score', score: d.interest, confidence: 0.5, probabilities: [] } } };
    }),
  };
}

/** A chat gateway: answers the pick (fallback) and the write from the prompt it is given. */
export function aiGatewayFake() {
  return {
    chatStructured: vi.fn(async (messages) => {
      const system = messages[0].content;
      const input = JSON.parse(messages[1].content);
      if (system.includes('front-page editor')) {
        const ids = (sourceId) => input.candidates.filter((row) => row[1] === sourceId).map((row) => row[0]);
        return {
          lead: { ids: ids('bbc').slice(0, 1) },
          categories: [{ id: 'us', stories: [{ ids: ids('cnn'), rank: 1 }] }, { id: 'tech', stories: [{ ids: ids('arstechnica'), rank: 1 }] }],
        };
      }
      const story = (g) => ({
        headline: `Re: ${g.headlines[0].title}`,
        body: `${g.headlines.map((h) => h.blurb).join(' ')} ${g.articles.length ? 'Read in full.' : ''}`.trim(),
        sources: [...new Set(g.headlines.map((h) => h.source))],
        ids: g.headlines.map((h) => h.id),
        rank: g.rank,
      });
      return {
        lead: input.lead ? story(input.lead) : null,
        sections: input.sections.map((s) => ({ category: s.category, label: s.label, stories: s.stories.map(story) })),
        briefs: [],
        day: { weather_note: 'Slick before nine.', notes: Object.keys(input.day).filter((m) => m !== 'weather').map((m) => ({ module: m, text: `${m} line` })) },
      };
    }),
  };
}

export function printerRegistryFake(outcome = { dispatched: true, verified: true, verification: 'verified' }) {
  const printer = { print: vi.fn(async () => (typeof outcome === 'function' ? outcome() : outcome)) };
  return {
    printer,
    get: vi.fn((name) => { if (name !== 'office' && name !== 'upstairs') throw new Error(`Unknown printer location: "${name}"`); return printer; }),
    resolve: vi.fn(() => printer),
    list: vi.fn(() => [{ name: 'office' }, { name: 'upstairs' }]),
  };
}

export function harness({
  config = sampleEditionConfig({ news: { ...sampleEditionConfig().news, user: 'reader' } }),
  clock = MORNING,
  headlines = headlineServiceFake(),
  feedSources = feedSourcesFake(),
  decisionGateway = decisionGatewayFake(),
  aiGateway = aiGatewayFake(),
  printerRegistry = printerRegistryFake(),
  summarizeSchool = vi.fn(async ({ studyDay }) => ({ studyDay, learners: studyDay === '2026-11-23' ? [{ child: 'Sam', served: 5, asked: 6, silverEarned: 3 }] : [] })),
  costReader = null,
} = {}) {
  const now = { value: clock };
  const store = new MemoryEditionStore();
  const logger = quietLogger();
  const reporters = { 'office-paper': config, 'world-cup': { enabled: true, schedule: '0 7 * * *', sources: [] } };
  const configProjection = { reporter: (id) => reporters[id] || null, timezone: () => TZ, all: () => reporters };
  const gatherer = new EditionGatherer({
    headlineService: headlines,
    feedSources,
    loadCalendar: () => [
      { date: '2026-11-24', time: '9:00 AM', summary: 'Staff sync', allday: false, startDateTime: '2026-11-24T09:00:00-07:00' },
      { date: '2026-11-24', time: null, summary: 'Time off starts', allday: true, startDateTime: '2026-11-24' },
    ],
    summarizeSchool,
    webContent: { extractReadableContent: vi.fn(async (url) => ({ content: `Full text of ${url}. `.repeat(20) })) },
    logger,
  });
  const service = new EditionService({
    configProjection, store, gatherer, aiGateway, decisionGateway,
    renderer: new NewspaperRenderer(), printerRegistry, costReader, logger,
    clock: { now: () => now.value }, costSettleMs: 0,
  });
  return { service, store, logger, now, printerRegistry, aiGateway, decisionGateway, feedSources, headlines, reporters };
}
