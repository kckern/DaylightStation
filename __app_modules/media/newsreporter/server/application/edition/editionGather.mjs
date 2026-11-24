/**
 * Gather and read (3_applications): every outside read an edition makes.
 *
 * Headlines come from the feed's HeadlineService; "your day" modules from the
 * feed's personal source adapters (`fetchItems(query, user)`, found by
 * `sourceType`), the user's current calendar, and the school digest's
 * read-only summary. Each module read has its own timeout; one that throws,
 * times out or returns nothing is left out and named in `missing`.
 *
 * Module facts are small plain objects the layout and the writer share.
 */
import { addDays, shortWeekday, seededRandom } from './editionTime.mjs';

export const MODULE_TIMEOUT_MS = 15000;
export const READ_TIMEOUT_MS = 8000;
export const READ_CONCURRENCY = 6;
export const READ_CHARS = 6000;

/** Feed source types behind each module part. */
const SOURCE_TYPE = { weather: 'weather', todoist: 'tasks', strava: 'strava', health: 'health', immich: 'immich', journal: 'journal', gratitude: 'gratitude' };

/**
 * Bound `promise` by `ms` through the injected IApplicationScheduler (the
 * application layer owns no timers). Without one the promise is unbounded.
 */
export function withTimeout(promise, ms, label, timing = null) {
  if (!timing?.withDeadline) return Promise.resolve(promise);
  return timing.withDeadline(promise, { milliseconds: ms, errorFactory: () => new Error(`${label} timed out after ${ms} ms`) });
}

/** Run `fn` over `items` with at most `limit` in flight. Order is kept. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class EditionGatherer {
  #headlineService;
  #feedSources;
  #loadCalendar;
  #summarizeSchool;
  #webContent;
  #logger;
  #moduleTimeoutMs;
  #timing;

  /**
   * @param {object} deps
   * @param {{ getAllHeadlines: Function, getPageList: Function }} deps.headlineService
   * @param {Array<{ sourceType: string, fetchItems: Function }>} [deps.feedSources]
   * @param {(username: string) => Array|null} [deps.loadCalendar]
   * @param {(args: { studyDay: string }) => Promise<object>} [deps.summarizeSchool]
   * @param {{ extractReadableContent: Function }} [deps.webContent]
   * @param {import('#apps/common/ports/IApplicationScheduler.mjs').IApplicationScheduler} [deps.timing] - timeouts
   */
  constructor({ headlineService, feedSources = [], loadCalendar = null, summarizeSchool = null, webContent = null, logger = console, moduleTimeoutMs = MODULE_TIMEOUT_MS, timing = null } = {}) {
    this.#headlineService = headlineService || null;
    this.#feedSources = new Map((feedSources || []).filter(Boolean).map((a) => [a.sourceType, a]));
    this.#loadCalendar = loadCalendar;
    this.#summarizeSchool = summarizeSchool;
    this.#webContent = webContent;
    this.#logger = logger;
    this.#moduleTimeoutMs = moduleTimeoutMs;
    this.#timing = timing;
  }

  /** The timing capability, shared with the pick step. */
  get timing() { return this.#timing; }

  get available() {
    return { headlines: !!this.#headlineService, read: !!this.#webContent?.extractReadableContent };
  }

  /**
   * Every headline page the config names (default: all of the user's pages).
   * Throws when the headline service is missing or every page fails: no
   * headlines, no paper.
   * @returns {Promise<{ pages: Array<{ pageId, sources, briefing }>, pageIds: string[], sourceIds: string[] }>}
   */
  async headlines(news) {
    if (!this.#headlineService) throw new Error('headline service unavailable');
    const pageIds = (this.#headlineService.getPageList(news.user) || []).map((p) => p.id);
    const wanted = news.pages || pageIds;
    const pages = [];
    const sourceIds = new Set();
    for (const pageId of wanted.filter((p) => pageIds.includes(p))) {
      // eslint-disable-next-line no-await-in-loop
      const result = await withTimeout(this.#headlineService.getAllHeadlines(news.user, pageId), this.#moduleTimeoutMs, `headlines ${pageId}`, this.#timing);
      if (!result) continue;
      Object.keys(result.sources || {}).forEach((id) => sourceIds.add(id));
      pages.push({ pageId, sources: result.sources || {}, briefing: result.briefing || [] });
    }
    // Every page's sources count for validation, not just the pages read.
    for (const pageId of pageIds.filter((p) => !wanted.includes(p))) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.#headlineService.getAllHeadlines(news.user, pageId);
        Object.keys(result?.sources || {}).forEach((id) => sourceIds.add(id));
      } catch { /* validation only */ }
    }
    if (!pages.length && wanted.some((p) => pageIds.includes(p))) throw new Error('no headline page could be read');
    return { pages, pageIds, sourceIds: [...sourceIds] };
  }

  /**
   * @param {object} args
   * @param {string[]} args.modules - module names to gather
   * @param {object} args.day - parsed day config
   * @param {string} args.user
   * @param {string} args.date - edition date (household-local)
   * @param {string} [args.seed]
   * @returns {Promise<{ facts: object, missing: string[] }>}
   */
  async modules({ modules, day, user, date, seed = '' }) {
    const facts = {};
    const missing = [];
    await Promise.all(modules.map(async (name) => {
      try {
        const result = await withTimeout(this.#module(name, { cfg: day[name] || {}, user, date, seed }), this.#moduleTimeoutMs, name, this.#timing);
        if (result) facts[name] = result;
        else missing.push(name);
      } catch (error) {
        missing.push(name);
        this.#logger.warn?.('newsreporter.edition.gather.module_failed', { module: name, date, error: error?.message || String(error) });
      }
    }));
    return { facts, missing: missing.sort() };
  }

  async #fetch(part, query, user) {
    const adapter = this.#feedSources.get(SOURCE_TYPE[part]);
    if (!adapter) throw new Error(`no feed source for ${part}`);
    return (await adapter.fetchItems(query, user)) || [];
  }

  async #module(name, ctx) {
    switch (name) {
      case 'weather': return this.#weather(ctx);
      case 'calendar': return this.#calendar(ctx);
      case 'todoist': return this.#todoist(ctx);
      case 'yesterday': return this.#yesterday(ctx);
      case 'school': return this.#school(ctx);
      case 'reflective': return this.#reflective(ctx);
      default: return null;
    }
  }

  async #weather({ user }) {
    const [item] = await this.#fetch('weather', {}, user);
    if (!item) return null;
    const meta = item.meta || {};
    const f = meta.forecast || {};
    const highF = f.highF ?? meta.tempF ?? null;
    const lowF = f.lowF ?? meta.tempF ?? null;
    const precipPct = f.precipPct ?? null;
    const reasons = [];
    if (lowF != null && lowF <= 32) reasons.push('freeze');
    if (highF != null && highF >= 95) reasons.push('heat');
    if (f.windKph != null && f.windKph >= 40) reasons.push('wind');
    if (precipPct != null && precipPct >= 60) reasons.push('precip');
    return {
      condition: f.condition || item.title || null,
      highF, lowF, precipPct, nowF: meta.tempF ?? null,
      notable: reasons.length > 0, notableReasons: reasons,
    };
  }

  async #calendar({ cfg, user, date }) {
    if (!this.#loadCalendar) throw new Error('calendar unavailable');
    const events = Array.isArray(this.#loadCalendar(user)) ? this.#loadCalendar(user) : [];
    const max = cfg.max ?? 5;
    const on = (d) => events
      .filter((e) => (e.date || e.startDate) === d)
      .sort((a, b) => (a.allday ? 0 : 1) - (b.allday ? 0 : 1) || String(a.startDateTime).localeCompare(String(b.startDateTime)));
    const items = on(date).map((e) => ({ time: e.allday ? null : e.time || null, text: e.summary || 'Event' }));
    // Today is thin: show the next two days too, tagged with the weekday.
    if (items.length < 2) {
      for (const d of [addDays(date, 1), addDays(date, 2)]) {
        for (const e of on(d)) items.push({ time: `${shortWeekday(d)}${e.allday ? '' : ` ${e.time || ''}`}`.trim(), text: e.summary || 'Event', later: true });
      }
    }
    return { items: items.slice(0, max), today: on(date).length };
  }

  async #todoist({ cfg, user }) {
    const items = await this.#fetch('todoist', { params: { filter: 'overdue_or_due_today' } }, user);
    const tasks = items.map((i) => ({ text: i.title, overdue: !!i.meta?.isOverdue }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue));
    return { items: tasks.slice(0, cfg.max ?? 4), total: tasks.length, notable: tasks.some((t) => t.overdue) };
  }

  async #yesterday({ cfg, user, date }) {
    const yesterday = addDays(date, -1);
    const lines = [];
    for (const part of cfg.parts || ['strava', 'health']) {
      try {
        if (part === 'strava') {
          // eslint-disable-next-line no-await-in-loop
          const acts = (await this.#fetch('strava', { params: { daysBack: 2 } }, user))
            .filter((a) => String(a.timestamp || '').slice(0, 10) === yesterday);
          for (const a of acts) lines.push({ part, text: `${a.title}: ${a.body}`.trim() });
        } else if (part === 'health') {
          // eslint-disable-next-line no-await-in-loop
          const [h] = await this.#fetch('health', {}, user);
          if (h?.body && h.body !== 'No data') lines.push({ part, text: h.body });
        }
      } catch (error) {
        this.#logger.warn?.('newsreporter.edition.gather.module_failed', { module: `yesterday.${part}`, date, error: error?.message || String(error) });
      }
    }
    return lines.length ? { date: yesterday, lines } : null;
  }

  async #school({ date }) {
    if (!this.#summarizeSchool) throw new Error('school digest unavailable');
    // The previous study day: the latest earlier day that asked for work.
    for (let back = 1; back <= 5; back += 1) {
      const studyDay = addDays(date, -back);
      // eslint-disable-next-line no-await-in-loop
      const summary = await this.#summarizeSchool({ studyDay });
      const learners = (summary?.learners || []).filter((l) => l.asked > 0);
      if (learners.length) {
        return {
          studyDay,
          learners: learners.map((l) => ({
            child: l.child || l.learnerId, served: l.served, asked: l.asked,
            silver: l.silverEarned ?? null, failure: l.failure ?? null,
          })),
        };
      }
    }
    return null;
  }

  async #reflective({ cfg, user, date, seed }) {
    const parts = [...(cfg.parts || ['immich', 'journal', 'gratitude'])];
    const random = seededRandom(`${seed}|${date}|reflective`);
    // Seeded order: try the drawn part first, then the others.
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    for (const part of parts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const [item] = await this.#fetch(part, { limit: 1 }, user);
        if (!item) continue;
        if (part === 'immich') return { part, label: 'From the photos', text: [item.title, item.subtitle].filter(Boolean).join(' · ') };
        if (part === 'journal') return { part, label: 'From the journal', text: `${item.title}: ${item.body}` };
        if (part === 'gratitude') return { part, label: 'Gratitude', text: item.body };
      } catch (error) {
        this.#logger.warn?.('newsreporter.edition.gather.module_failed', { module: `reflective.${part}`, date, error: error?.message || String(error) });
      }
    }
    return null;
  }

  /**
   * Read the first two articles of every picked group.
   * @param {Array<{ key: string, items: Array<{ url, source }> }>} groups
   * @returns {Promise<Map<string, Array<{ source, text }>>>}
   */
  async read(groups, { date } = {}) {
    const jobs = groups.flatMap((g) => g.items.filter((i) => i.url).slice(0, 2).map((i) => ({ key: g.key, url: i.url, source: i.source })));
    const texts = new Map(groups.map((g) => [g.key, []]));
    if (!this.#webContent?.extractReadableContent) return texts;
    await mapLimit(jobs, READ_CONCURRENCY, async (job) => {
      try {
        const article = await withTimeout(this.#webContent.extractReadableContent(job.url), READ_TIMEOUT_MS, 'read', this.#timing);
        const text = String(article?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 200) texts.get(job.key).push({ source: job.source, text: text.slice(0, READ_CHARS) });
        else throw new Error('no readable text');
      } catch (error) {
        this.#logger.info?.('newsreporter.edition.read.failed', { date, url: job.url, error: error?.message || String(error) });
      }
    });
    return texts;
  }
}
