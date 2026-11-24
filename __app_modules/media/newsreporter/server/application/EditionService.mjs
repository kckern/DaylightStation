/**
 * EditionService (3_applications) — compose, hold and deliver an edition
 * reporter's daily paper (spec ops:docs/superpowers/specs/2026-11-23-office-paper-design.md).
 *
 *   compose: gather → select → pick (LLM) → read → write (LLM) → layout → fit → store
 *   deliver: print the stored PNG once, on the configured printer, unrouted
 *            unless `deliver.fallback` is true.
 *
 * Every deliver outcome is a status, never a throw, so the Home Assistant
 * caller never sees an error: printed | already_delivered | expired |
 * composed_then_printed | print_failed (and compose_failed when a deliver
 * had to compose and could not).
 *
 * All I/O is injected: config projection, edition store, gatherer (feed,
 * calendar, school, web reads), AI gateway, renderer, printer registry, and
 * an optional usage-ledger reader for the edition's cost.
 */
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { readPrintOutcome } from '#domains/core/utils/printOutcome.mjs';
import { parseEditionConfig, checkEditionSources, isEditionReporter } from './edition/editionConfig.mjs';
import { buildCandidates, planModules, finalizeModules } from './edition/editionSelect.mjs';
import { pickSchema, writeSchema, checkPick, checkWrite } from './edition/editionContracts.mjs';
import { buildPickMessages, buildWriteMessages } from './edition/editionPrompts.mjs';
import { structuredCall } from './edition/structuredCall.mjs';
import { decisionPick } from './edition/decisionPick.mjs';
import { screenWritten } from './edition/familySafe.mjs';
import { buildLayout, fitLayout } from './edition/editionLayout.mjs';
import { localDate, localTime, localClockLabel } from './edition/editionTime.mjs';

export const DELIVER_STATUSES = Object.freeze(['printed', 'already_delivered', 'expired', 'composed_then_printed', 'print_failed', 'compose_failed']);
const COST_FEATURE = 'office-paper';

const errorText = (error) => error?.message || String(error);

export class EditionService {
  #config;
  #store;
  #gatherer;
  #gateway;
  #decisionGateway;
  #renderer;
  #printers;
  #costReader;
  #logger;
  #clock;
  #costSettleMs;
  #locks = new Map();

  /**
   * @param {object} deps
   * @param {{ reporter: Function, timezone: Function, all?: Function }} deps.configProjection
   * @param {import('./ports/IEditionStore.mjs').IEditionStore} deps.store
   * @param {import('./edition/editionGather.mjs').EditionGatherer} deps.gatherer
   * @param {{ chatStructured: Function }|null} deps.aiGateway - scoped { app: 'newsreporter', feature: 'office-paper' }
   * @param {{ evaluate: Function, isConfigured: Function }|null} [deps.decisionGateway] - typed decisions for the pick, scoped the same
   * @param {{ render: Function, measure: Function, renderText: Function }} deps.renderer
   * @param {{ get: Function, resolve: Function, list?: Function }} deps.printerRegistry
   * @param {{ listCosts: Function }|null} [deps.costReader] - the AI usage ledger
   */
  constructor({ configProjection, store, gatherer, aiGateway = null, decisionGateway = null, renderer, printerRegistry = null, costReader = null, logger = console, clock = null, costSettleMs = 250 } = {}) {
    if (!configProjection?.reporter) throw new Error('EditionService requires a configProjection');
    if (!store) throw new Error('EditionService requires an edition store');
    if (!gatherer) throw new Error('EditionService requires a gatherer');
    if (!renderer) throw new Error('EditionService requires a renderer');
    this.#config = configProjection;
    this.#store = store;
    this.#gatherer = gatherer;
    this.#gateway = aiGateway;
    this.#decisionGateway = decisionGateway;
    this.#renderer = renderer;
    this.#printers = printerRegistry;
    this.#costReader = costReader;
    this.#logger = logger || console;
    this.#clock = clock || { now: () => new Date() };
    this.#costSettleMs = costSettleMs;
  }

  /** True when `id` names an enabled edition reporter. */
  handles(reporterId) {
    const raw = this.#config.reporter(reporterId);
    return !!raw && raw.enabled !== false && isEditionReporter(raw);
  }

  #reporter(reporterId) {
    const raw = this.#config.reporter(reporterId);
    if (!raw || raw.enabled === false || !isEditionReporter(raw)) throw new EntityNotFoundError('newsreporter edition', reporterId);
    return parseEditionConfig(raw, reporterId);
  }

  #timezone() { return this.#config.timezone?.() || 'UTC'; }

  /** Today in the household's timezone. */
  today() { return localDate(this.#clock.now(), this.#timezone()); }

  // ── reads ────────────────────────────────────────────────────────────

  /** @returns {Promise<object[]>} summaries, newest first */
  async listEditions(reporterId, { limit = 30 } = {}) {
    if (!this.handles(reporterId)) throw new EntityNotFoundError('newsreporter edition', reporterId);
    const records = await this.#store.list(reporterId, { limit });
    return records.map(summaryOf);
  }

  /** @returns {Promise<object|null>} the full edition */
  async getEdition(reporterId, date) {
    if (!this.handles(reporterId)) throw new EntityNotFoundError('newsreporter edition', reporterId);
    return this.#store.get(reporterId, date);
  }

  /** @returns {Promise<Buffer|null>} */
  async getImage(reporterId, date) {
    if (!this.handles(reporterId)) throw new EntityNotFoundError('newsreporter edition', reporterId);
    return this.#store.readPng(reporterId, date);
  }

  /** @returns {string[]} printer names */
  printers() {
    return (this.#printers?.list?.() || []).map((p) => p.name);
  }

  // ── compose ──────────────────────────────────────────────────────────

  /**
   * Compose the day's edition. Replaces that day's edition (keeping its
   * deliveries) unless `dryRun`, which stores nothing and returns the PNG.
   * @param {string} reporterId
   * @param {{ date?: string, dryRun?: boolean, trigger?: string }} [opts]
   * @returns {Promise<{ status: 'composed'|'failed', edition?: object, png?: string, error?: string }>}
   */
  async compose(reporterId, { date = null, dryRun = false, trigger = 'api' } = {}) {
    const raw = this.#config.reporter(reporterId);
    if (!raw || raw.enabled === false || !isEditionReporter(raw)) throw new EntityNotFoundError('newsreporter edition', reporterId);
    const startedAt = this.#clock.now();
    const timezone = this.#timezone();
    const day = date || localDate(startedAt, timezone);
    const ctx = { reporterId, date: day, dryRun: !!dryRun, trigger };
    this.#logger.info?.('newsreporter.edition.compose.start', ctx);

    let existing = null;
    try {
      existing = await this.#store.get(reporterId, day);
      const cfg = parseEditionConfig(raw, reporterId);
      const result = await this.#compose(cfg, { reporterId, date: day, startedAt, timezone, ctx });
      const number = existing?.number ?? result.nextNumber;
      const edition = {
        date: day,
        number,
        status: 'composed',
        composedAt: startedAt.toISOString(),
        layout: { ...result.layout, masthead: { ...result.layout.masthead, number } },
        inputs: result.inputs,
        stories: result.stories,
        deliveries: existing?.deliveries || [],
        image: result.image,
        fit: result.fit,
        costUsd: result.costUsd,
        model: result.model,
        error: null,
      };
      // The number lands in the masthead, so render once more if it moved.
      let { png } = result;
      if (number !== result.nextNumber) png = await this.#png(edition.layout);
      if (dryRun) {
        this.#logger.info?.('newsreporter.edition.compose.complete', { ...ctx, stories: edition.stories.length, heightCm: edition.image.heightCm });
        return { status: 'composed', dryRun: true, edition, png: png.toString('base64') };
      }
      await this.#store.savePng(reporterId, day, png);
      await this.#store.save(reporterId, day, edition);
      this.#logger.info?.('newsreporter.edition.compose.complete', {
        ...ctx, number, stories: edition.stories.length, heightCm: edition.image.heightCm,
        missing: edition.inputs.missing, costUsd: edition.costUsd, durationMs: this.#clock.now() - startedAt,
      });
      return { status: 'composed', edition };
    } catch (error) {
      const message = errorText(error);
      this.#logger.error?.('newsreporter.edition.compose.error', { ...ctx, error: message, code: error?.code ?? null, stack: error?.stack?.split('\n').slice(0, 3).join(' | ') });
      // A failed recompose never clobbers a good edition.
      if (!dryRun && existing?.status !== 'composed' && existing?.status !== 'delivered') {
        try {
          await this.#store.save(reporterId, day, {
            date: day, number: existing?.number ?? null, status: 'failed', composedAt: startedAt.toISOString(),
            layout: null, inputs: existing?.inputs ?? null, stories: [], deliveries: existing?.deliveries || [],
            costUsd: null, model: raw.model ?? null, error: message,
          });
        } catch (saveError) {
          this.#logger.warn?.('newsreporter.edition.store.failed', { ...ctx, error: errorText(saveError) });
        }
      }
      return { status: 'failed', error: message };
    }
  }

  async #compose(cfg, { reporterId, date, startedAt, timezone, ctx }) {
    if (!this.#gateway?.chatStructured) throw new Error('no AI gateway configured (the write step needs one)');
    const previous = await this.#store.list(reporterId, { before: date, limit: Math.max(1, cfg.news.dedupe_editions) });
    const plan = planModules({ day: cfg.day, date, previousModules: previous[0]?.inputs?.modules || [], seed: reporterId });

    // 1. Gather: headlines (required) and the day's modules, in parallel.
    const [heads, gathered] = await Promise.all([
      this.#gatherer.headlines(cfg.news),
      this.#gatherer.modules({ modules: plan.modules, day: cfg.day, user: cfg.news.user, date, seed: reporterId }),
    ]);
    checkEditionSources(cfg, { pages: heads.pageIds, sourceIds: heads.sourceIds }, reporterId);

    // 2. Select.
    const { candidates, counts } = buildCandidates({
      pages: heads.pages,
      now: startedAt,
      maxAgeHours: cfg.news.max_age_hours,
      previousStories: previous.slice(0, cfg.news.dedupe_editions).flatMap((e) => e.stories || []),
    });
    if (!candidates.length) throw new Error('no fresh headlines to write from');
    const modules = finalizeModules({ day: cfg.day, modules: plan.modules, facts: gathered.facts });
    const byId = new Map(candidates.map((c) => [c.id, c]));

    // 3. Pick: typed decisions per story (Jev); the chat pick is the fallback.
    let pick = await decisionPick({
      gateway: this.#decisionGateway, candidates, categories: cfg.news.categories,
      leadEnabled: cfg.news.lead.enabled, familySafe: cfg.family_safe,
      logger: this.#logger, logContext: ctx, timing: this.#gatherer.timing,
    });
    let pickInfo;
    if (pick) {
      pickInfo = { method: 'decision', units: pick.units, failed: pick.failed, merged: pick.merged ?? 0 };
    } else {
      const pickRaw = await structuredCall({
        gateway: this.#gateway, step: 'pick', schema: pickSchema, model: cfg.model, logger: this.#logger, logContext: ctx,
        messages: buildPickMessages({ cfg, candidates, date }),
      });
      pick = checkPick(pickRaw, { candidates, categories: cfg.news.categories, leadEnabled: cfg.news.lead.enabled });
      pick.interest = new Map();
      pickInfo = { method: 'chat', units: candidates.length, failed: 0 };
      if (pick.unknownIds.length || pick.disallowed.length) {
        this.#logger.warn?.('newsreporter.edition.pick.unknown_ids', { ...ctx, unknown: pick.unknownIds, disallowed: pick.disallowed });
      }
    }
    this.#logger.info?.('newsreporter.edition.pick.complete', { ...ctx, ...pickInfo, categories: pick.categories.map((c) => `${c.id}:${c.stories.length}`), lead: !!pick.lead });
    for (const category of cfg.news.categories.filter((c) => c.balance === 'lean')) {
      const picked = pick.categories.find((c) => c.id === category.id);
      const cols = new Set((picked?.stories || []).flatMap((s) => s.ids.map((id) => byId.get(id)?.col)).filter((c) => c != null));
      this.#logger.info?.('newsreporter.edition.pick.balance', { ...ctx, category: category.id, columns: [...cols].sort() });
    }

    // 4. Read.
    const groups = [];
    if (pick.lead) groups.push({ key: 'lead', lead: true, category: null, rank: 1, ids: pick.lead });
    for (const c of pick.categories) for (const s of c.stories) groups.push({ key: `${c.id}:${s.rank}`, lead: false, category: c.id, rank: s.rank, ids: s.ids });
    for (const g of groups) {
      g.items = g.ids.map((id) => byId.get(id)).map((c) => ({ id: c.id, source: c.sourceLabel, title: c.title, blurb: c.desc, url: c.url }));
    }
    const texts = await this.#gatherer.read(groups, { date });
    for (const g of groups) {
      g.texts = texts.get(g.key) || [];
      g.thin = g.texts.length === 0;
    }

    // 5. Write.
    const dayFacts = {};
    for (const name of modules) {
      if (['yesterday', 'school', 'reflective', 'weather'].includes(name)) dayFacts[name] = gathered.facts[name];
    }
    const writtenRaw = await structuredCall({
      gateway: this.#gateway, step: 'write', schema: writeSchema, model: cfg.model, logger: this.#logger, logContext: ctx,
      messages: buildWriteMessages({ cfg, date, groups, dayFacts }), maxTokens: 6000,
    });
    const checked = checkWrite(writtenRaw, { pick, candidates, modules });
    if (checked.dropped.length) this.#logger.warn?.('newsreporter.edition.write.dropped', { ...ctx, headlines: checked.dropped });

    // 5b. Family-safe screen of what was actually written (the writer read the
    // full articles, so details can appear that no headline showed).
    let written = checked;
    const familySafe = { enabled: cfg.family_safe.enabled, method: null, pickRemoved: pick.mature || [], writeRemoved: [] };
    if (cfg.family_safe.enabled) {
      const screened = await screenWritten({
        written: checked, gateway: this.#decisionGateway, threshold: cfg.family_safe.threshold,
        timing: this.#gatherer.timing, logger: this.#logger, logContext: ctx,
      });
      written = screened.written;
      familySafe.writeRemoved = screened.removed;
      familySafe.method = screened.checked ? 'decision' : 'prompt-only';
      if (!screened.checked) this.#logger.warn?.('newsreporter.edition.family_safe.unscreened', { ...ctx, reason: 'no decision gateway' });
    }
    if (!written.lead && !written.sections.length) throw new Error('the written edition has no stories');

    // 6. Layout, 7. fit.
    const nextNumber = (previous.find((e) => Number.isInteger(e.number))?.number ?? 0) + 1;
    const layout = buildLayout({
      cfg, date, number: nextNumber, modules, facts: gathered.facts, written,
      composedLabel: localClockLabel(startedAt, timezone), headlineCount: candidates.length,
    });
    const fit = await fitLayout(layout, (l) => this.#renderer.measure(l), cfg.length.max_cm, {
      onDrop: (step) => this.#logger.info?.('newsreporter.edition.fit.dropped', { ...ctx, ...step }),
    });
    if (fit.overflow) this.#logger.warn?.('newsreporter.edition.fit.overflow', { ...ctx, heightCm: fit.heightCm, maxCm: cfg.length.max_cm });
    const rendered = await this.#renderer.render(fit.layout);
    const png = rendered.canvas.toBuffer('image/png');

    // 8. What went in, for the record.
    const stories = storiesOf(fit.layout, byId, pick.interest);
    const costUsd = await this.#cost(startedAt);
    return {
      nextNumber,
      layout: fit.layout,
      png,
      image: { width: rendered.width, height: rendered.height, heightCm: round(rendered.heightCm, 1) },
      fit: { dropped: fit.dropped, overflow: fit.overflow },
      stories,
      inputs: {
        headlines: candidates.length,
        pages: heads.pages.map((p) => p.pageId),
        counts,
        modules,
        drawn: plan.drawn,
        missing: [...new Set([...gathered.missing, ...plan.modules.filter((m) => !modules.includes(m) && cfg.day[m]?.show !== 'when_notable' && !gathered.missing.includes(m))])].sort(),
        thin: groups.filter((g) => g.thin).length,
        pick: pickInfo,
        familySafe,
      },
      costUsd,
      model: cfg.model ?? null,
    };
  }

  async #png(layout) {
    const rendered = await this.#renderer.render(layout);
    return rendered.canvas.toBuffer('image/png');
  }

  /** Sum the ledger's costs for this compose; null when unknown. */
  async #cost(startedAt) {
    if (!this.#costReader?.listCosts) return null;
    try {
      // Ledger appends are fire-and-forget; give the last one a moment to land.
      if (this.#costSettleMs && this.#gatherer.timing?.wait) await this.#gatherer.timing.wait(this.#costSettleMs);
      const rows = await this.#costReader.listCosts({
        app: 'newsreporter', feature: COST_FEATURE,
        from: startedAt.toISOString(), to: new Date(this.#clock.now().getTime() + 1000).toISOString(),
      });
      if (!rows?.length) return null;
      return round(rows.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0), 4);
    } catch (error) {
      this.#logger.warn?.('newsreporter.edition.cost.unavailable', { error: errorText(error) });
      return null;
    }
  }

  // ── deliver ──────────────────────────────────────────────────────────

  /**
   * Print the day's edition. Serialized per reporter, so two triggers in the
   * same second cannot both print.
   * @param {string} reporterId
   * @param {{ date?: string, printer?: string, force?: boolean, trigger?: string }} [opts]
   * @returns {Promise<{ status: string, edition?: object, printer?: string, error?: string }>}
   */
  async deliver(reporterId, opts = {}) {
    const cfg = this.#reporter(reporterId);
    const prior = this.#locks.get(reporterId) || Promise.resolve();
    const run = prior.catch(() => {}).then(() => this.#deliver(reporterId, cfg, opts));
    this.#locks.set(reporterId, run.catch(() => {}));
    return run;
  }

  async #deliver(reporterId, cfg, { date = null, printer = null, force = false, trigger = 'api' } = {}) {
    const timezone = this.#timezone();
    const now = this.#clock.now();
    const today = localDate(now, timezone);
    const day = date || today;
    const printerName = printer || cfg.deliver.printer;
    const ctx = { reporterId, date: day, printer: printerName, trigger, force: !!force };

    let edition = await this.#store.get(reporterId, day);
    if (!force && cfg.deliver.once_per_day && edition?.deliveries?.length) {
      this.#logger.info?.('newsreporter.edition.deliver.skipped', { ...ctx, reason: 'already_delivered' });
      return { status: 'already_delivered', edition: summaryOf(edition) };
    }
    const expired = day < today || (day === today && localTime(now, timezone) >= cfg.deliver.expires_after);
    if (!force && expired) {
      this.#logger.info?.('newsreporter.edition.deliver.skipped', { ...ctx, reason: 'expired', expiresAfter: cfg.deliver.expires_after });
      return { status: 'expired', edition: edition ? summaryOf(edition) : null };
    }

    let composedNow = false;
    // A printable edition is a composed one, delivered or not; a reprint must
    // never recompose (the paper on the desk and the newsstand stay the same).
    const printable = edition?.status === 'composed' || edition?.status === 'delivered';
    let imagePath = printable ? await this.#store.pngPath(reporterId, day) : null;
    if (!imagePath) {
      const composed = await this.compose(reporterId, { date: day, trigger: `deliver:${trigger}` });
      if (composed.status !== 'composed') {
        this.#logger.warn?.('newsreporter.edition.deliver.failed', { ...ctx, reason: 'compose_failed', error: composed.error });
        return { status: 'compose_failed', error: composed.error, edition: null };
      }
      composedNow = true;
      edition = composed.edition;
      imagePath = await this.#store.pngPath(reporterId, day);
    }

    const fail = (error) => {
      this.#logger.warn?.('newsreporter.edition.deliver.failed', { ...ctx, error });
      return { status: 'print_failed', error, printer: printerName, edition: summaryOf(edition) };
    };
    if (!imagePath) return fail('no stored image');
    if (!this.#printers) return fail('no printer registry');

    let outcome;
    try {
      // fallback: false → the named printer, unrouted, so the paper never
      // prints on another floor.
      const adapter = cfg.deliver.fallback ? this.#printers.resolve(printerName) : this.#printers.get(printerName);
      outcome = await adapter.print({
        items: [{ type: 'image', path: imagePath, width: edition.image?.width || 576, height: edition.image?.height, align: 'left', threshold: 128 }],
        footer: { paddingLines: 3, autoCut: true },
        transcript: edition.layout ? this.#renderer.renderText(edition.layout) : '',
      });
    } catch (error) {
      return fail(errorText(error));
    }
    const { printed, confirmed } = readPrintOutcome(outcome);
    if (!printed) return fail(outcome?.faults?.length ? `printer fault: ${outcome.faults.join(', ')}` : 'printer did not take the job');

    const delivery = { at: this.#clock.now().toISOString(), printer: printerName, trigger, confirmed };
    edition = { ...edition, status: 'delivered', deliveries: [...(edition.deliveries || []), delivery] };
    try {
      await this.#store.save(reporterId, day, edition);
    } catch (error) {
      this.#logger.warn?.('newsreporter.edition.store.failed', { ...ctx, error: errorText(error) });
    }
    const status = composedNow ? 'composed_then_printed' : 'printed';
    this.#logger.info?.('newsreporter.edition.deliver.printed', { ...ctx, status, confirmed });
    return { status, printer: printerName, edition: summaryOf(edition) };
  }
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Stored stories: `{ category, headline, ids, urls, titles, sources, interest }`. */
function storiesOf(layout, byId, interestById = new Map()) {
  const out = [];
  const add = (category, s) => {
    const items = (s.ids || []).map((id) => byId.get(id)).filter(Boolean);
    const scores = (s.ids || []).map((id) => interestById.get(id)).filter((v) => Number.isFinite(v));
    out.push({
      category, headline: s.headline, ids: s.ids || [],
      urls: items.map((c) => c.url), titles: items.map((c) => c.title), sources: items.map((c) => c.sourceLabel),
      interest: scores.length ? round(Math.max(...scores), 2) : null,
    });
  };
  for (const b of layout.blocks) {
    if (b.type === 'lead') add('lead', b);
    if (b.type === 'section') b.stories.forEach((s) => add(b.category, s));
  }
  return out;
}

/** The newsstand's summary row. */
export function summaryOf(edition) {
  if (!edition) return null;
  const last = (edition.deliveries || []).at(-1) || null;
  return {
    date: edition.date,
    number: edition.number ?? null,
    status: edition.status ?? null,
    composedAt: edition.composedAt ?? null,
    deliveredAt: last?.at ?? null,
    printer: last?.printer ?? null,
    costUsd: edition.costUsd ?? null,
    leadHeadline: edition.layout?.blocks?.find((b) => b.type === 'lead')?.headline
      ?? edition.layout?.blocks?.find((b) => b.type === 'section')?.stories?.[0]?.headline ?? null,
    missing: edition.inputs?.missing ?? [],
  };
}

export default EditionService;
