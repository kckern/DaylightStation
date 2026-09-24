/**
 * ArtworkRemediation — the artwork repair queue (design 2026-09-23 §5).
 *
 * The household rule: a food whose icon or photo cannot be shown is never
 * abandoned. Every failure becomes a queue item (2_domains/nutrition/services/
 * artworkQueue.mjs) that is worked until it is fixed, with exponential backoff
 * and no attempt cap. No new art is ever generated; a food gets the NEAREST
 * existing icon:
 *
 *   1. the catalog entry's pin, then its learned icon (when it renders);
 *   2. the reviewed food-name → icon map in the manifest;
 *   3. guessIconForName — the longest run of the name's words that is a slug;
 *   4. a pick of the nearest slug, confined to the manifest vocabulary: the
 *      typed decision model first, the LLM when its confidence is low
 *      (NearestIconChooser).
 *
 * Exception: a name in EXACT_ONLY_NAMES (or one the reviewed map explicitly
 * says has no suitable art) never gets a near neighbour. It takes its exact
 * slug, else the barcode product photo when the row or catalog has one, else
 * the item stays OPEN — visible in Health > Settings — and keeps retrying.
 *
 * A broken product photo is re-fetched through the UPC gateway when the row
 * came from a barcode; otherwise the row gets a real icon by the ladder above
 * and the dead photoRef is cleared.
 *
 * Row fixes go through NutritionRepairService.apply (mode 'artwork', actor
 * 'artwork-remediation', with a reason and evidence), so they appear in the
 * cleanup history with Undo. The icon is also written onto the catalog entry
 * when the entry has none (never over a pin).
 */

import { sha256Text } from '#system/utils/sha256.mjs';
import { artworkQueueKey, isArtworkKind, isDue, mergeArtworkReport, recordArtworkFailure, resolveArtworkItem,
  queueView } from '#domains/nutrition/services/artworkQueue.mjs';
import { guessIconForName, iconVocabulary, isExactOnlyName, normalizeIconFoodName, NEUTRAL_ICON } from '#domains/nutrition/services/icons.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const isReal = slug => typeof slug === 'string' && slug !== '' && slug !== NEUTRAL_ICON;
const rowKey = row => row.uuid || row.id;
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

/** An attempt that could not fix the item. Carries the reason shown in Settings. */
class ArtworkUnresolved extends Error {}

export class ArtworkRemediation {
  #queue; #items; #repairs; #catalog; #icons; #aiGateway; #iconChooser; #upcGateway; #photos; #clock; #logger;

  /**
   * @param {Object} deps
   * @param {import('./ports/IArtworkQueueStore.mjs').IArtworkQueueStore} deps.queue
   * @param {Object} deps.items - nutrilist store (findByUuid, findByDateRange)
   * @param {Object} deps.repairs - NutritionRepairService
   * @param {Object} [deps.catalog] - food catalog store (getById, findByNormalizedName, save)
   * @param {Object} deps.icons - IconManifestStore (list, foodNames, has, resolve)
   * @param {Object} [deps.aiGateway] - `chat(messages, opts) => string`, the LLM nearest-icon pick
   * @param {Object} [deps.iconChooser] - NearestIconChooser; asked first, with the LLM pick as its fallback
   * @param {Object} [deps.upcGateway] - `lookup(upc)`, `fetchImage(url)`
   * @param {Object} [deps.photos] - PhotoStore (`save(userId, buffer)`, `resolvePath(userId, ref)`)
   */
  constructor({ queue, items, repairs, catalog = null, icons, aiGateway = null, iconChooser = null, upcGateway = null, photos = null, clock, logger = console }) {
    if (!queue || !items || !repairs || !icons || !clock?.now) throw new Error('ArtworkRemediation requires queue, items, repairs, icons and clock');
    this.#queue = queue; this.#items = items; this.#repairs = repairs; this.#catalog = catalog; this.#icons = icons;
    this.#aiGateway = aiGateway; this.#iconChooser = iconChooser; this.#upcGateway = upcGateway; this.#photos = photos; this.#clock = clock; this.#logger = logger;
  }

  // ── Intake ────────────────────────────────────────────────────────────────

  /**
   * Put a failure on the queue (or add rows to the item already there).
   * @param {string} userId
   * @param {{kind, foodId?, name?, icon?, photoRef?, rowIds?, error?}} report
   * @returns {Object|null} the queue item, or null when there is nothing to key it on
   */
  enqueue(userId, report) {
    return this.enqueueMany(userId, [report])[0] ?? null;
  }

  /** Several reports in ONE queue write (a sweep can find hundreds). */
  enqueueMany(userId, reports) {
    for (const report of reports) {
      if (!isArtworkKind(report?.kind)) throw Object.assign(new Error(`Unknown artwork failure kind: ${report?.kind}`), { status: 400 });
    }
    const keyed = reports.map(report => ({ ...report, key: artworkQueueKey(report) })).filter(report => report.key);
    if (!keyed.length) return reports.map(() => null);
    const nowIso = new Date(this.#clock.now()).toISOString();
    const outcomes = this.#queue.update(userId, state => keyed.map(report => {
      const merged = mergeArtworkReport(state.items[report.key], report, nowIso);
      state.items[report.key] = merged.item;
      return merged;
    }));
    for (const outcome of outcomes) {
      if (!outcome.created && !outcome.reopened) continue;
      this.#logger.info?.('artwork.queue.enqueued', { userId, key: outcome.item.key, kind: outcome.item.kind, reopened: outcome.reopened,
        rows: outcome.item.rowIds.length, attempts: outcome.item.attempts });
    }
    // Later reports for the same key merge into the same item: answer with the final one.
    const final = new Map(outcomes.map(outcome => [outcome.item.key, outcome.item]));
    return reports.map(report => final.get(artworkQueueKey(report)) ?? null);
  }

  /**
   * A browser report (`POST /nutrition/artwork-failures`): the row it names, if
   * any, supplies the food identity. `key` is what failed to render — the slug
   * for an icon, the photoRef for a photo.
   */
  async report(userId, { kind, key, uuid = null, name = null, icon = null }) {
    if (!isArtworkKind(kind)) throw Object.assign(new Error(`Unknown artwork failure kind: ${kind}`), { status: 400 });
    if (typeof key !== 'string' || !key || key.length > 200) throw Object.assign(new Error('key is required'), { status: 400 });
    // The row is almost always on a recently viewed day: look there before
    // paying for a whole-history search.
    const recent = uuid ? await this.#items.findByDateRange(userId, isoDate(this.#clock.now() - 35 * DAY_MS), isoDate(this.#clock.now() + DAY_MS)).catch(() => []) : [];
    const row = !uuid ? null : recent.find(r => r.uuid === uuid || r.id === uuid)
      || await this.#items.findByUuid(userId, uuid).catch(() => null);
    const photoRef = kind === 'photo-failed' ? key : null;
    return this.enqueue(userId, {
      kind, photoRef,
      foodId: row?.foodId ?? null,
      name: row?.name || name || null,
      icon: kind === 'photo-failed' ? (row?.icon ?? icon ?? null) : (icon || key),
      rowIds: row ? [rowKey(row)] : [], dates: row?.date ? [row.date] : [],
      error: kind === 'photo-failed' ? 'photo failed to load in the browser' : 'icon failed to load in the browser',
    });
  }

  /**
   * Find rows in the window whose artwork cannot be shown — no working photo
   * and an icon that is missing, `default`, or not a slug the manifest serves —
   * and queue them. A person's own icon choice is left alone.
   * @returns {Promise<{ scanned, broken, enqueued, candidates }>}
   */
  async sweep(userId, { sinceDays = 7, dryRun = false } = {}) {
    const now = this.#clock.now();
    const rows = await this.#items.findByDateRange(userId, isoDate(now - sinceDays * DAY_MS), isoDate(now + DAY_MS));
    const art = this.#artChecks(userId);
    const candidates = [];
    for (const row of rows) {
      if (row.kind === 'group') continue;
      if (row.photoRef && art.photoWorks(row.photoRef)) continue;
      if (row.photoRef) {
        candidates.push({ kind: 'photo-failed', photoRef: row.photoRef, foodId: row.foodId ?? null, name: row.name, icon: row.icon ?? null,
          rowIds: [rowKey(row)], dates: [row.date], error: 'photo file is missing' });
        continue;
      }
      if (art.iconWorks(row.icon) || row.manualFields?.includes('icon')) continue;
      candidates.push({ kind: isReal(row.icon) ? 'icon-failed' : 'icon-missing', foodId: row.foodId ?? null, name: row.name,
        icon: row.icon ?? null, rowIds: [rowKey(row)], dates: [row.date],
        error: isReal(row.icon) ? `icon ${row.icon} is not served by the manifest` : 'no icon' });
    }
    let enqueued = 0;
    if (!dryRun && candidates.length) {
      const before = new Set(Object.keys(this.#queue.load(userId).items));
      this.enqueueMany(userId, candidates);
      enqueued = Object.keys(this.#queue.load(userId).items).filter(key => !before.has(key)).length;
    }
    const summary = { scanned: rows.length, broken: candidates.length, enqueued, sinceDays, dryRun };
    this.#logger.info?.('artwork.queue.sweep', { userId, ...summary });
    return { ...summary, candidates };
  }

  // ── Work ──────────────────────────────────────────────────────────────────

  /** Work every due item, soonest first. Failures reschedule; nothing is dropped. */
  async tick(userId, { limit = 20 } = {}) {
    const now = this.#clock.now();
    const due = Object.values(this.#queue.load(userId).items).filter(item => isDue(item, now))
      .sort((a, b) => String(a.nextAttemptAt).localeCompare(String(b.nextAttemptAt))).slice(0, limit);
    const outcome = { worked: 0, resolved: 0, retry: 0 };
    const pass = this.pass(userId);
    for (const item of due) {
      outcome.worked++;
      try {
        const resolution = await this.#work(userId, item, pass);
        this.#settle(userId, item, current => resolveArtworkItem(current, resolution, this.#clock.now()));
        outcome.resolved++;
        this.#logger.info?.('artwork.queue.resolved', { userId, key: item.key, kind: item.kind, attempts: (item.attempts || 0) + 1, ...resolution });
      } catch (error) {
        const next = this.#settle(userId, item, current => recordArtworkFailure(current, error.message, this.#clock.now()));
        outcome.retry++;
        this.#logger.warn?.('artwork.queue.retry', { userId, key: item.key, kind: item.kind, attempts: next?.attempts,
          nextAttemptAt: next?.nextAttemptAt, error: error.message });
      }
    }
    return outcome;
  }

  /**
   * What the ladder would give this food WITHOUT calling the AI or writing
   * anything (the dry-run CLI). `{ via, icon|photoRef }`; `via: 'ai'` with a
   * null icon means only the AI pick is left; `{ open: reason }` means the item
   * would stay open.
   */
  async previewArt(userId, report, pass = this.pass(userId)) {
    const rows = report.rows || await pass.rows(report);
    const entry = await pass.entry(report, rows);
    try {
      return await this.#pickArt({ userId, name: report.name || entry?.name, entry, rows, art: pass.art,
        allowPhoto: report.kind !== 'photo-failed', allowAi: false });
    } catch (error) {
      if (error instanceof ArtworkUnresolved) return { open: error.message };
      throw error;
    }
  }

  /** `{ open, recentlyResolved }` for Health > Settings. */
  view(userId, { resolvedLimit = 10 } = {}) {
    return queueView(this.#queue.load(userId).items, { resolvedLimit });
  }

  /**
   * Write an attempt's outcome onto the CURRENT item. Rows reported while the
   * attempt ran are kept, and if the attempt never saw them the item stays open
   * (due now) instead of being marked fixed.
   */
  #settle(userId, worked, apply) {
    return this.#queue.update(userId, state => {
      const current = state.items[worked.key];
      if (!current) return null;
      let next = apply(current);
      const unseen = (current.rowIds || []).filter(id => !(worked.rowIds || []).includes(id));
      if (next.resolvedAt && unseen.length) {
        next = { ...next, resolvedAt: null, nextAttemptAt: new Date(this.#clock.now()).toISOString(), lastError: 'new rows reported during repair' };
      }
      state.items[worked.key] = next;
      return next;
    });
  }

  async #work(userId, item, pass) {
    const { art } = pass;
    if (item.key.startsWith('icon:')) return this.#workBareSlug(userId, item, art);
    const rows = await pass.rows(item);
    const entry = await pass.entry(item, rows);
    const name = item.name || rows[0]?.name || entry?.name || null;
    if (item.kind === 'photo-failed') return this.#workPhoto(userId, item, { rows, entry, name, art });

    const targets = rows.filter(row => row.kind !== 'group' && !row.manualFields?.includes('icon')
      && !(row.photoRef && art.photoWorks(row.photoRef)) && !art.iconWorks(row.icon));
    // Every row it named now shows real art (fixed elsewhere, edited, deleted).
    if (!targets.length && (rows.length || item.rowIds?.length)) return { via: 'nothing-to-fix', rows: 0 };
    const choice = await this.#pickArt({ userId, name, entry, rows, art });
    const changed = await this.#applyRows(userId, item, targets, row => (choice.icon ? { icon: choice.icon } : { photoRef: choice.photoRef }), choice);
    await this.#fillCatalog(userId, entry, choice);
    return { via: choice.via, ...(choice.icon ? { icon: choice.icon } : { photoRef: choice.photoRef }), rows: changed };
  }

  /** A slug the browser could not render, with no row behind the report. */
  async #workBareSlug(userId, item, art) {
    if (art.iconWorks(item.icon)) return { via: 'asset-ok', icon: item.icon, rows: 0 };
    const now = this.#clock.now();
    const rows = (await this.#items.findByDateRange(userId, isoDate(now - 30 * DAY_MS), isoDate(now + DAY_MS)))
      .filter(row => row.icon === item.icon && row.kind !== 'group');
    this.enqueueMany(userId, rows.map(row => ({ kind: 'icon-failed', foodId: row.foodId ?? null, name: row.name, icon: row.icon,
      rowIds: [rowKey(row)], dates: [row.date], error: `icon ${item.icon} does not render` })));
    return { via: 'expanded', icon: item.icon, rows: rows.length };
  }

  async #workPhoto(userId, item, { rows, entry, name, art }) {
    const targets = rows.filter(row => row.kind !== 'group' && row.photoRef === item.photoRef);
    if (!targets.length && item.rowIds?.length) return { via: 'nothing-to-fix', rows: 0 };
    const upc = targets.map(row => row.captureEvidence?.upc).find(Boolean) || entry?.barcodeUpc || null;
    if (upc && this.#upcGateway?.lookup && this.#upcGateway.fetchImage && this.#photos?.save) {
      // A lookup error is a retry (the network), not a verdict about the product.
      const product = await this.#upcGateway.lookup(upc);
      const buffer = product?.imageUrl ? await this.#upcGateway.fetchImage(product.imageUrl) : null;
      if (buffer) {
        const photoRef = await this.#photos.save(userId, buffer);
        const choice = { via: 'upc-photo', photoRef };
        const changed = await this.#applyRows(userId, item, targets, () => ({ photoRef }), choice);
        if (entry && (!entry.photoRef || entry.photoRef === item.photoRef)) { entry.photoRef = photoRef; await this.#catalog.save(entry, userId); }
        return { via: 'upc-photo', photoRef, rows: changed };
      }
    }
    // No barcode photo to be had: the row gets a real icon and loses the dead ref.
    const choice = await this.#pickArt({ userId, name, entry, rows: [], art, allowPhoto: false });
    const changed = await this.#applyRows(userId, item, targets, row => (row.manualFields?.includes('icon')
      ? { photoRef: null } : { icon: choice.icon, photoRef: null }), choice);
    const deadPhoto = !!entry && entry.photoRef === item.photoRef;
    if (deadPhoto) entry.photoRef = null;
    await this.#fillCatalog(userId, entry, choice, { force: deadPhoto });
    return { via: choice.via, icon: choice.icon, rows: changed };
  }

  /**
   * The icon ladder. Returns `{ via, icon }`, or `{ via: 'photo', photoRef }`
   * for an exact-only food with a product photo; throws ArtworkUnresolved when
   * nothing acceptable exists yet (the item stays open and retries).
   */
  async #pickArt({ userId, name, entry, rows, art, allowPhoto = true, allowAi = true }) {
    for (const [via, slug] of [['pin', entry?.iconOverride], ['catalog', entry?.icon]]) {
      if (art.iconWorks(slug)) return { via, icon: slug };
    }
    if (!name) throw new ArtworkUnresolved('no food name to match an icon against');
    const vocabulary = art.vocabulary();
    if (!vocabulary.size) throw new ArtworkUnresolved('the icon manifest is empty');
    const normalized = normalizeIconFoodName(name);
    const reviewed = vocabulary.foodNames?.has(normalized) ? vocabulary.foodNames.get(normalized) : undefined;
    if (reviewed && art.iconWorks(reviewed)) return { via: 'reviewed', icon: reviewed };
    // Exact-only names, and names the reviewed map says have NO suitable art,
    // never get a near neighbour: their own slug, else the product photo.
    const exactOnly = isExactOnlyName(name) || reviewed === null;
    const guess = guessIconForName(name, vocabulary);
    if (art.iconWorks(guess)) return { via: exactOnly ? 'exact' : 'name', icon: guess };
    if (exactOnly) {
      const photoRef = allowPhoto ? [...rows.map(row => row.photoRef), entry?.photoRef].find(ref => ref && art.photoWorks(ref)) : null;
      if (photoRef) return { via: 'photo', photoRef };
      throw new ArtworkUnresolved(`"${name}" takes only its exact icon, which does not exist, and has no product photo`);
    }
    if (!allowAi) return { via: 'ai', icon: null };
    const llm = this.#aiGateway?.chat ? () => this.#nearestIcon(name, vocabulary) : null;
    if (!llm && !this.#iconChooser?.hasDecisionModel) {
      throw new ArtworkUnresolved('no icon matches the name and no AI gateway is configured');
    }
    const picked = this.#iconChooser
      ? await this.#iconChooser.choose({ name, vocabulary: [...vocabulary].filter(isReal), fallback: llm, source: 'artwork' })
      : { icon: await llm(), via: 'fallback' };
    const via = picked.via === 'jev' ? 'jev' : 'ai';
    if (!art.iconWorks(picked.icon)) throw new ArtworkUnresolved(`${via === 'jev' ? 'Jev' : 'AI'} pick ${picked.icon ? `"${picked.icon}" ` : ''}is not a served icon`);
    return { via, icon: picked.icon };
  }

  /** The LogFoodFromUPC #selectIconFromList prompt shape, asking for the NEAREST slug. */
  async #nearestIcon(name, vocabulary) {
    const list = [...vocabulary].filter(isReal).join(' ');
    const prompt = [
      { role: 'system', content: `Pick the best matching icon filename for the food from this list:
${list}

There may be no exact match: choose the NEAREST picture of the same kind of food or drink.
Respond ONLY as JSON: { "icon": "<filename>" }` },
      { role: 'user', content: `Food: ${name}` },
    ];
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 40 });
    const match = String(response || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const icon = JSON.parse(match[0])?.icon;
      return vocabulary.has(icon) && isReal(icon) ? icon : null;
    } catch { return null; }
  }

  /** One audited artwork repair across the item's rows. Returns how many rows changed. */
  async #applyRows(userId, item, rows, changesFor, choice) {
    const updates = rows.map(row => ({ id: rowKey(row), expectedVersion: row.version ?? 1, changes: changesFor(row) }))
      .filter(update => Object.keys(update.changes).length);
    if (!updates.length) return 0;
    const fingerprint = sha256Text(JSON.stringify({ key: item.key, attempts: item.attempts || 0, updates })).slice(0, 24);
    const result = await this.#repairs.apply({ userId, operationId: `artwork_${fingerprint}`, actor: 'artwork-remediation',
      proposal: { mode: 'artwork', reason: `Artwork could not be shown (${item.kind}); ${describe(choice)}`, updates },
      evidence: [{ id: `artwork_${fingerprint}`, kind: 'artwork', source: item.kind, key: item.key, via: choice.via,
        ...(choice.icon ? { icon: choice.icon } : {}), ...(choice.photoRef ? { photoRef: choice.photoRef } : {}) }] });
    return result?.affectedIds?.length ?? updates.length;
  }

  /** The food keeps the icon it was given, when it has none (a pin is never touched). */
  async #fillCatalog(userId, entry, choice, { force = false } = {}) {
    if (!entry || !this.#catalog) return;
    let dirty = force;
    if (choice.icon && !entry.icon && !entry.iconOverride) { entry.icon = choice.icon; dirty = true; }
    if (dirty) await this.#catalog.save(entry, userId);
  }

  /**
   * One pass over the queue (a tick, a preview run): the ledger is read ONCE
   * from the oldest day any item needs, and the catalog once, instead of a
   * whole-history scan per row. `findByUuid` reads every archive month.
   */
  pass(userId) {
    const art = this.#artChecks(userId);
    const rowIndex = new Map();
    let loadedFrom = null;
    let catalog = null;
    const load = async since => {
      if (loadedFrom && loadedFrom <= since) return;
      const rows = await this.#items.findByDateRange(userId, since, isoDate(this.#clock.now() + DAY_MS));
      for (const row of rows) { rowIndex.set(rowKey(row), row); if (row.id) rowIndex.set(row.id, row); }
      loadedFrom = since;
    };
    const catalogIndex = async () => {
      if (catalog || !this.#catalog?.getAll) return catalog;
      const entries = await this.#catalog.getAll(userId);
      catalog = { byId: new Map(entries.map(entry => [entry.id, entry])), byName: new Map(entries.map(entry => [entry.normalizedName, entry])) };
      return catalog;
    };
    return {
      art,
      rows: async item => {
        const ids = item.rowIds || [];
        if (!ids.length) return [];
        await load(item.earliestDate || isoDate(this.#clock.now() - 7 * DAY_MS));
        // A row moved to an older day than the item knew about: one full read.
        if (ids.some(id => !rowIndex.has(id))) await load('0001-01-01');
        return ids.map(id => rowIndex.get(id)).filter(Boolean);
      },
      entry: async (item, rows) => {
        if (!this.#catalog) return null;
        const foodId = item.foodId || rows.find(row => row.foodId)?.foodId;
        const name = item.name || rows[0]?.name;
        try {
          const index = await catalogIndex();
          if (index) return (foodId && index.byId.get(foodId)) || (name && index.byName.get(name.toLowerCase().trim().replace(/\s+/g, ' '))) || null;
          return (foodId && await this.#catalog.getById(foodId, userId)) || (name && await this.#catalog.findByNormalizedName(name, userId)) || null;
        } catch (error) {
          this.#logger.warn?.('artwork.queue.catalog_unavailable', { userId, key: item.key, error: error.message });
          return null;
        }
      },
    };
  }

  /** Memoized "does this render" checks for one pass. */
  #artChecks(userId) {
    const icons = new Map();
    const photos = new Map();
    let vocabulary = null;
    return {
      iconWorks: slug => {
        if (!isReal(slug)) return false;
        if (!icons.has(slug)) icons.set(slug, !!this.#icons.has(slug) && (!this.#icons.resolve || !!this.#icons.resolve(slug)));
        return icons.get(slug);
      },
      photoWorks: ref => {
        if (!ref) return false;
        if (!this.#photos?.resolvePath) return true;
        if (!photos.has(ref)) photos.set(ref, !!this.#photos.resolvePath(userId, ref));
        return photos.get(ref);
      },
      vocabulary: () => {
        vocabulary ??= iconVocabulary((this.#icons.list?.() || []).join(' '), this.#icons.foodNames?.() || {});
        return vocabulary;
      },
    };
  }
}

function describe(choice) {
  if (choice.photoRef) return choice.via === 'upc-photo' ? 'the product photo was fetched again from its barcode' : 'the product photo stands in for an exact-only food';
  return { pin: 'the food\'s pinned icon', catalog: 'the food\'s catalog icon', reviewed: 'the reviewed icon for this name',
    exact: 'the exact icon for this name', name: 'the closest icon by name', ai: 'the nearest existing icon (AI pick)',
    jev: 'the nearest existing icon (Jev pick)' }[choice.via]
    + ` (${choice.icon})`;
}
