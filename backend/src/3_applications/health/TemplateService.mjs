/**
 * TemplateService — named meal templates with core/variant components.
 *
 * A template is a remembered *shape* of a meal: the components that are always
 * there (`core`) and the ones that rotate (`variant`). Instantiating one drops
 * a dish GROUP into a bucket with its core children, plus whichever variants
 * the person picked.
 *
 * Two things about the rows it writes are load-bearing:
 *
 *  1. **The group row carries ZERO nutrition.** Rollups are computed on read
 *     (decision 2.4); a header that also carried the meal's calories would make
 *     every bucket count the meal twice. Every fold in the app — server and
 *     client — sums the flat row list through one shared predicate, so the
 *     header must contribute nothing to it.
 *  2. **`settled` is written verbatim.** An ABSENT `settled` means "legacy row,
 *     treat as settled" (decision 2.6). Picking a template is a deliberate
 *     human choice, so its rows are born `settled: true` — never `?? true`,
 *     which would change what every pre-existing row means.
 */

import { formatLocalTimestamp } from '#system/utils/time.mjs';
import { defaultBucketForDate } from '#shared/contracts/health/isoDate.mjs';
import { hasMicroData, pickMicros } from '#domains/nutrition/services/micros.mjs';

/** Local (not UTC) YYYY-MM-DD. The UTC form reads as tomorrow every evening here. */
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The clock's opinion when the caller supplies no bucket. */
const bucketForHour = (h) => (h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night');

const ROLES = ['core', 'variant'];

/**
 * How many templates the zero-keystroke suggestion list may show. The combobox
 * asks for eight rows; more than three templates would make the shortlist a
 * template browser rather than "the regulars for this meal".
 */
export const TEMPLATE_SUGGEST_CAP = 3;

const coded = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * One stored component. A SNAPSHOT, exactly as saved meals are: a later catalog
 * edit never reaches back into a template.
 *
 * MICROS TRAVEL WITH IT, under Phase 6's rules. Without this a meal logged from
 * a template is strictly LESS rich than logging the same foods one at a time —
 * a catalog quick-add carries `fiber/sugar/sodium/cholesterol` plus
 * `microsSource: 'catalog'`, and a template that dropped them would report
 * every one of its rows as uncovered, dragging down the very coverage caption
 * Theme 4 exists to earn. The rules are unchanged:
 *
 *  - **Per key.** `pickMicros` carries only the keys the source actually holds;
 *    a key it does not carry is not written as a structural `0` claiming to be
 *    a reading (the persistence boundary applies the storage default).
 *  - **Only from a provenanced source.** No `microsSource` on the component
 *    means its zeros are structure, not measurement, and nothing is carried.
 *  - **Provenance without numbers is not provenance** — a source claiming
 *    `'catalog'` while holding no micro number lands `microsSource: null`,
 *    the same rule the AI mapper follows (decision 2.11).
 */
const snapshotComponent = (c) => {
  const claimed = typeof c?.microsSource === 'string' && c.microsSource ? c.microsSource : null;
  const micros = claimed ? pickMicros(c) : {};
  return ({
  ...micros,
  microsSource: hasMicroData(micros) ? claimed : null,
  name: String(c?.name ?? '').trim(),
  // An unroled component is CORE. A template written by hand, or migrated from
  // a saved meal, is an all-core template — the safe reading, because a
  // mis-defaulted `variant` would silently drop food out of the logged meal.
  role: ROLES.includes(c?.role) ? c.role : 'core',
  calories: Number(c?.calories) || 0,
  protein: Number(c?.protein) || 0,
  carbs: Number(c?.carbs) || 0,
  fat: Number(c?.fat) || 0,
  color: c?.color || 'yellow',
  icon: c?.icon ?? null,
  grams: Number(c?.grams) || 0,
  unit: c?.unit || 'serving',
  amount: Number.isFinite(Number(c?.amount)) && c?.amount !== null && c?.amount !== undefined
    ? Number(c.amount)
    : 1,
  });
};

export class TemplateService {
  #templateStore; #nutriListStore; #clock; #createId; #logger;

  constructor({ templateStore, nutriListStore, clock, createId, logger }) {
    if (!templateStore || !nutriListStore || !clock?.now || typeof createId !== 'function') {
      throw new Error('TemplateService requires templateStore, nutriListStore, clock, createId');
    }
    this.#templateStore = templateStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#createId = createId;
    this.#logger = logger || console;
  }

  /**
   * @param {string} userId
   * @param {Object} [options]
   * @param {boolean} [options.includeProposed=false] - include mined proposals
   *   awaiting approval. They are hidden by default because a proposal is not
   *   yet a template: nothing is auto-created without approval (PRD F6.2).
   */
  async list(userId, { includeProposed = false } = {}) {
    const all = await this.#templateStore.list(userId);
    const visible = includeProposed ? all : all.filter((t) => t.status !== 'proposed');
    return visible.slice().sort((a, b) => {
      // Proposals first — they are the thing asking for a decision.
      if ((a.status === 'proposed') !== (b.status === 'proposed')) return a.status === 'proposed' ? -1 : 1;
      return String(b.lastUsed || '').localeCompare(String(a.lastUsed || ''))
        || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /**
   * The add-combobox list, with templates in it (PRD F6.2 / F8.2).
   *
   * Order is PRD F6.4: **favorites → templates → the rest**. The favourites-first
   * contract shipped in Task 9.1 holds — templates slot in behind it, never in
   * front of it — and the catalog list arrives already ranked, so this only
   * splices; it never re-sorts what the ranking module decided.
   *
   * Every entry is stamped with a `type`, foods included: a list where only
   * some rows say what they are is a list the client has to guess about.
   *
   * @param {Object[]} foods - the ranked catalog suggestions
   * @param {Object} opts
   * @param {string} [opts.query] - '' for the zero-keystroke list
   * @param {string} opts.userId
   * @param {number} [opts.limit=12]
   */
  async mergeIntoSuggestions(foods, { query = '', userId, limit = 12 } = {}) {
    const list = (Array.isArray(foods) ? foods : []).map((f) => ({ ...f, type: 'food' }));
    const q = String(query || '').toLowerCase().trim();

    const active = (await this.list(userId)).filter((t) => t.status !== 'proposed');
    const matched = q ? active.filter((t) => String(t.name).toLowerCase().includes(q)) : active;

    // The zero-keystroke list is a SHORTLIST (the combobox asks for 8), so an
    // unbounded template block would push a person's actual regulars off it.
    // A typed query is steered, so every match is offered.
    const offered = (q ? matched : matched.slice(0, TEMPLATE_SUGGEST_CAP)).map((t) => {
      const core = (t.components || []).filter((c) => c.role === 'core');
      return {
        id: t.id,
        type: 'template',
        name: t.name,
        icon: t.icon ?? null,
        itemCount: core.length,
        variantCount: (t.components || []).length - core.length,
        // The same shape a food carries, so one row renderer draws both.
        nutrients: { calories: core.reduce((n, c) => n + (Number(c.calories) || 0), 0) },
      };
    });
    if (offered.length === 0) return list.slice(0, limit);

    const favorites = list.filter((f) => f.favorite === true);
    const rest = list.filter((f) => f.favorite !== true);
    return [...favorites, ...offered, ...rest].slice(0, limit);
  }

  async listDismissedKeys(userId) { return this.#templateStore.listDismissedKeys(userId); }

  /**
   * Add a key to the dismissal ledger WITHOUT there being a template row to
   * remove.
   *
   * The ledger is the household's one "never propose this to me again" list,
   * and `dismiss` above can only reach it by way of a stored template. The
   * catalog drift audit computes its proposals fresh from history on every run
   * and stores none, so it needs the ledger and not the template store — hence
   * this door. Keys are namespaced by their proposer (`catalog-density:...`),
   * so nothing here can collide with a meal-template proposal key.
   */
  async dismissKey(key, userId) {
    const clean = String(key ?? '').trim();
    if (!clean) throw coded('dismissKey requires a key', 'TEMPLATE_KEY_REQUIRED');
    await this.#templateStore.addDismissedKey(clean, userId);
    this.#logger.info?.('health.templates.key_dismissed', { key: clean });
    return { ok: true, key: clean };
  }

  async getById(id, userId) { return this.#templateStore.getById(id, userId); }

  async create({ name, icon = null, components, source = 'manual', proposalKey = null }, userId) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw coded('Template requires a name', 'TEMPLATE_INVALID');
    if (!Array.isArray(components) || components.length === 0) {
      throw coded('Template requires components', 'TEMPLATE_INVALID');
    }
    const snapshot = components.map(snapshotComponent).filter((c) => c.name);
    if (snapshot.length === 0) throw coded('Template requires components with names', 'TEMPLATE_INVALID');

    const template = {
      id: this.#createId(),
      name: trimmed,
      icon,
      components: snapshot,
      createdAt: new Date(this.#clock.now()).toISOString(),
      useCount: 0,
      lastUsed: null,
      source,
      status: 'active',
      proposalKey,
    };
    await this.#templateStore.save(template, userId);
    this.#logger.info?.('health.templates.created', { name: trimmed, components: snapshot.length, source });
    return template;
  }

  async remove(id, userId) {
    await this.#templateStore.remove(id, userId);
    this.#logger.info?.('health.templates.removed', { id });
  }

  /**
   * Write the template into a day as a dish group.
   *
   * @returns {Promise<{ groupUuid: string, items: Object[] }>}
   */
  async instantiate(id, userId, { date, mealTime, variantNames = [] } = {}) {
    const template = await this.#templateStore.getById(id, userId);
    if (!template) throw coded(`Template not found: ${id}`, 'TEMPLATE_NOT_FOUND');
    if (template.status === 'proposed') {
      throw coded(`Template ${id} is a proposal and has not been approved`, 'TEMPLATE_NOT_ACTIVE');
    }

    const now = new Date(this.#clock.now());
    const targetDate = date || localDateISO(now);
    // Decision 2.24: on a day that is not today the wall clock's hour describes
    // no meal on that day, so the day is filled from its first one instead.
    const targetMealTime = mealTime || defaultBucketForDate(targetDate, now, bucketForHour);
    const settledAt = formatLocalTimestamp(now);
    const wanted = new Set((Array.isArray(variantNames) ? variantNames : []).map((n) => String(n)));

    // Core is never optional. A variant ships only when it was asked for — an
    // unknown name in `variantNames` selects nothing rather than inventing a
    // component, so a stale client cannot log food the template does not hold.
    const chosen = (template.components || [])
      .map(snapshotComponent)
      .filter((c) => c.role === 'core' || wanted.has(c.name));

    // An all-variant template with nothing toggled would otherwise write a lone
    // header: a zero-calorie row with no children, which every fold counts as
    // nothing and every reader has to explain. No UI create path can build such
    // a template today, but the service is the place that must refuse it.
    if (chosen.length === 0) {
      throw coded(`Template ${id} would log nothing — choose at least one component`, 'TEMPLATE_NO_COMPONENTS');
    }

    const groupUuid = this.#createId();
    const groupRow = {
      uuid: groupUuid,
      userId,
      item: template.name,
      name: template.name,
      // ZERO nutrition, spelled out rather than omitted. See the class comment.
      calories: 0, protein: 0, carbs: 0, fat: 0,
      grams: 0, unit: 'serving', amount: 0,
      color: 'yellow',
      icon: template.icon ?? null,
      date: targetDate,
      mealTime: targetMealTime,
      kind: 'group',
      parentId: null,
      settled: true,
      settledBy: 'user',
      settledAt,
      log_uuid: 'TEMPLATE',
    };

    const childRows = chosen.map((c) => ({
      uuid: this.#createId(),
      userId,
      item: c.name,
      name: c.name,
      calories: c.calories,
      protein: c.protein,
      carbs: c.carbs,
      fat: c.fat,
      // Per key, and only where the snapshot actually carries one.
      ...pickMicros(c),
      microsSource: c.microsSource ?? null,
      grams: c.grams,
      unit: c.unit,
      amount: c.amount,
      color: c.color,
      icon: c.icon,
      date: targetDate,
      mealTime: targetMealTime,
      kind: 'item',
      parentId: groupUuid,
      settled: true,
      settledBy: 'user',
      settledAt,
      log_uuid: 'TEMPLATE',
    }));

    const rows = [groupRow, ...childRows];
    await this.#nutriListStore.saveMany(rows);

    template.useCount = (template.useCount || 0) + 1;
    template.lastUsed = targetDate;
    await this.#templateStore.save(template, userId);

    this.#logger.info?.('health.templates.instantiated', {
      id, date: targetDate, mealTime: targetMealTime, children: childRows.length,
    });
    return { groupUuid, items: rows };
  }

  /**
   * Persist mined proposals.
   *
   * IDEMPOTENT BY KEY, in both directions that matter: a key already stored
   * (as a proposal or as the origin of an approved template) creates nothing,
   * and a key the person dismissed creates nothing ever again. Running the
   * curation job twice over the same history is therefore a no-op — the
   * property `backfill` famously does not have (decision 2.29).
   */
  async saveProposals(proposals, userId) {
    const list = Array.isArray(proposals) ? proposals : [];
    const existing = await this.#templateStore.list(userId);
    const knownKeys = new Set(existing.map((t) => t.proposalKey).filter(Boolean));
    const dismissed = new Set(await this.#templateStore.listDismissedKeys(userId));

    let created = 0, skipped = 0;
    for (const proposal of list) {
      const key = proposal?.key;
      if (!key || knownKeys.has(key) || dismissed.has(key)) { skipped += 1; continue; }
      const snapshot = (proposal.components || []).map(snapshotComponent).filter((c) => c.name);
      if (snapshot.length === 0) { skipped += 1; continue; }
      const template = {
        id: this.#createId(),
        name: String(proposal.suggestedName || 'Suggested meal'),
        icon: proposal.icon ?? null,
        components: snapshot,
        createdAt: new Date(this.#clock.now()).toISOString(),
        useCount: 0,
        lastUsed: null,
        source: 'curated',
        status: 'proposed',
        proposalKey: key,
        occurrences: Number(proposal.occurrences) || 0,
      };
      await this.#templateStore.save(template, userId);
      knownKeys.add(key);
      created += 1;
    }
    this.#logger.info?.('health.templates.proposals', { created, skipped });
    return { created, skipped };
  }

  async approve(id, userId, { name } = {}) {
    const template = await this.#templateStore.getById(id, userId);
    if (!template) throw coded(`Template not found: ${id}`, 'TEMPLATE_NOT_FOUND');
    const chosen = String(name ?? '').trim();
    template.name = chosen || template.name;
    template.status = 'active';
    template.source = 'curated';
    await this.#templateStore.save(template, userId);
    this.#logger.info?.('health.templates.approved', { id, name: template.name });
    return template;
  }

  /**
   * Refuse a proposal, permanently. The template row goes; the KEY stays, and
   * the miner is handed it back on every later run.
   */
  async dismiss(id, userId) {
    const template = await this.#templateStore.getById(id, userId);
    if (!template) throw coded(`Template not found: ${id}`, 'TEMPLATE_NOT_FOUND');
    if (template.proposalKey) await this.#templateStore.addDismissedKey(template.proposalKey, userId);
    await this.#templateStore.remove(id, userId);
    this.#logger.info?.('health.templates.dismissed', { id, key: template.proposalKey ?? null });
    return { ok: true, key: template.proposalKey ?? null };
  }
}
export default TemplateService;
