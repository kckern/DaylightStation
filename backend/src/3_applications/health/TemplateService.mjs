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

const coded = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * One stored component. A SNAPSHOT, exactly as saved meals are: a later catalog
 * edit never reaches back into a template.
 */
const snapshotComponent = (c) => ({
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

  async listDismissedKeys(userId) { return this.#templateStore.listDismissedKeys(userId); }

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
    const targetMealTime = mealTime || bucketForHour(now.getHours());
    const settledAt = formatLocalTimestamp(now);
    const wanted = new Set((Array.isArray(variantNames) ? variantNames : []).map((n) => String(n)));

    // Core is never optional. A variant ships only when it was asked for — an
    // unknown name in `variantNames` selects nothing rather than inventing a
    // component, so a stale client cannot log food the template does not hold.
    const chosen = (template.components || [])
      .map(snapshotComponent)
      .filter((c) => c.role === 'core' || wanted.has(c.name));

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
