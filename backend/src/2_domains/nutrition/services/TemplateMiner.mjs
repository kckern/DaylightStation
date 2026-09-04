/**
 * TemplateMiner — finds the meal combos a person actually repeats.
 *
 * Pure: rows in, proposals out, `today` supplied by the caller. Nothing here
 * reads a clock, and nothing here writes: the job above it decides what to do
 * with what this returns, and the person decides whether it becomes a template
 * (PRD F6.2 — nothing is auto-created without approval).
 *
 * @module domains/nutrition/services/TemplateMiner
 */

import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';
import { hasMicroData, pickMicros } from './micros.mjs';

/** The rolling window mined, in days (PRD F6.2). */
export const MINER_WINDOW_DAYS = 90;
/** How many times a combo must have happened before it is worth proposing. */
export const MIN_OCCURRENCES = 6;
/** Present in at least this share of the combo's occurrences → `core`. */
export const CORE_PRESENCE = 0.7;
/** Present in at least this share (but under CORE_PRESENCE) → `variant`. Below it, dropped. */
export const VARIANT_MIN_PRESENCE = 0.2;
/**
 * A proposal needs at least this many core components. A one-item "combo" is
 * just a food the person eats often — the quick-add list already offers that,
 * and proposing it as a template would be noise with an approval prompt on it.
 */
export const MIN_CORE_COMPONENTS = 2;

const BUCKET_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

/** Names match the way a person reads them, not the way YAML stores them. */
const normalizeName = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** `#normalizeItem`'s own sentinel for a row whose name nobody recorded. */
const UNKNOWN = 'unknown';

/**
 * The identity of a combo: its sorted, normalized CORE names.
 *
 * Core only, deliberately — a smoothie whose variant rotates between mango and
 * blueberries is ONE combo, and keying on every observed component would let
 * the same stack be proposed again the week the rotation changes. That also
 * makes a dismissal stick: the key the person refused is the key that comes
 * back next run.
 */
export function coreKey(names) {
  return [...new Set((names || []).map(normalizeName).filter(Boolean))].sort().join('|');
}

/** YYYY-MM-DD, `days` before `iso`. Takes the date in; derives nothing from a clock. */
function shiftDays(iso, days) {
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * One occurrence = one eating event: the rows sharing a group, or failing that
 * the rows in the same bucket on the same day (PRD F6.2's co-occurrence rule).
 */
function occurrenceKey(row) {
  return row.parentId ? `g:${row.parentId}` : `d:${row.date}|${row.mealTime ?? '-'}`;
}

/**
 * Mine repeated combos out of a window of day-log rows.
 *
 * @param {Object} input
 * @param {Object[]} input.rows - nutrilist rows (any window; filtered here)
 * @param {string} input.today - YYYY-MM-DD, the window's last day
 * @param {number} [input.windowDays=MINER_WINDOW_DAYS]
 * @param {string[]} [input.existingTemplateNames] - names already in the picker
 * @param {string[]} [input.existingKeys] - keys of templates and live proposals
 * @param {string[]} [input.dismissedKeys] - keys the person refused, forever
 * @returns {Array<{ key, suggestedName, mealTime, occurrences, components }>}
 */
export function mineTemplates({
  rows = [],
  today,
  windowDays = MINER_WINDOW_DAYS,
  existingTemplateNames = [],
  existingKeys = [],
  dismissedKeys = [],
} = {}) {
  if (!today) return [];
  const cutoff = shiftDays(today, -windowDays);
  if (!cutoff) return [];

  // --- 1. The rows that can contribute at all ------------------------------
  // Group rows are headers carrying zero nutrition (decision 2.4); counting one
  // as a component would propose a template of dish names.
  const usable = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || row.kind === 'group') return false;
    if (!isCountedRow(row)) return false;
    const name = normalizeName(row.name || row.item || row.label);
    if (!name || name === UNKNOWN) return false;
    const date = row.date;
    return typeof date === 'string' && date >= cutoff && date <= today;
  });

  // --- 2. Occurrences ------------------------------------------------------
  const occurrences = new Map();
  for (const row of usable) {
    const key = occurrenceKey(row);
    if (!occurrences.has(key)) {
      occurrences.set(key, { bucket: row.mealTime ?? null, date: row.date, byName: new Map() });
    }
    const occ = occurrences.get(key);
    const name = normalizeName(row.name || row.item || row.label);
    // Same food twice in one meal is one PRESENCE, and the later row wins as
    // the portion to remember.
    const prior = occ.byName.get(name);
    if (!prior || String(row.date) >= String(prior.date)) occ.byName.set(name, row);
  }
  // A single-item meal cannot evidence a combo.
  const events = [...occurrences.values()].filter((occ) => occ.byName.size >= 2);

  // --- 3. Anchors ----------------------------------------------------------
  // Every sufficiently frequent food anchors a candidate: the occurrences
  // containing it ARE "the combo's occurrences", which is what the ≥70 % /
  // 20–70 % presence rates are measured against. Two anchors inside one stack
  // land on the same core set and therefore the same key, so the candidate
  // dedups itself without a clustering pass.
  const anchorOccurrences = new Map();
  for (const occ of events) {
    for (const name of occ.byName.keys()) {
      if (!anchorOccurrences.has(name)) anchorOccurrences.set(name, []);
      anchorOccurrences.get(name).push(occ);
    }
  }

  const takenNames = new Set(existingTemplateNames.map(normalizeName));
  const blockedKeys = new Set([...existingKeys, ...dismissedKeys].filter(Boolean));
  const seen = new Set();
  const proposals = [];

  const anchors = [...anchorOccurrences.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [, group] of anchors) {
    if (group.length < MIN_OCCURRENCES) continue;

    const presence = new Map();
    const latestRow = new Map();
    for (const occ of group) {
      for (const [name, row] of occ.byName) {
        presence.set(name, (presence.get(name) || 0) + 1);
        const prior = latestRow.get(name);
        if (!prior || String(row.date) >= String(prior.date)) latestRow.set(name, row);
      }
    }

    const core = [];
    const variants = [];
    for (const [name, count] of presence) {
      const share = count / group.length;
      if (share >= CORE_PRESENCE) core.push({ name, share, count });
      else if (share >= VARIANT_MIN_PRESENCE) variants.push({ name, share, count });
      // Below VARIANT_MIN_PRESENCE: omitted entirely (PRD F6.2).
    }
    if (core.length < MIN_CORE_COMPONENTS) continue;

    const key = coreKey(core.map((c) => c.name));
    if (!key || seen.has(key) || blockedKeys.has(key)) continue;

    const buckets = new Map();
    for (const occ of group) {
      if (!occ.bucket) continue;
      buckets.set(occ.bucket, (buckets.get(occ.bucket) || 0) + 1);
    }
    const mealTime = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

    // Headline order: how reliably it is present, then how substantial it is.
    // Presence alone ties constantly — every core item of a stack eaten
    // together is present 100 % of the time — and an alphabetical tie-break
    // would name the smoothie after its cheapest ingredient.
    const ordered = [...core].sort((a, b) => (
      b.share - a.share
      || (Number(latestRow.get(b.name)?.calories) || 0) - (Number(latestRow.get(a.name)?.calories) || 0)
      || b.count - a.count
      || a.name.localeCompare(b.name)
    ));
    const headline = latestRow.get(ordered[0].name);
    const headlineName = headline?.name || headline?.item || ordered[0].name;
    const suggestedName = `${BUCKET_LABELS[mealTime] || 'Regular'} ${String(headlineName).toLowerCase()}`;
    // A name the picker already shows would arrive as an indistinguishable
    // second row. The combo is not lost — it is simply not proposed under a
    // name that is taken (PRD F6.2's dedup against existing templates).
    if (takenNames.has(normalizeName(suggestedName))) continue;

    const component = (entry, role) => {
      // The portion the person MOST RECENTLY logged, never an average: an
      // invented number is a number they never ate.
      const row = latestRow.get(entry.name) || {};
      // A mined component inherits the observed row's micros, per key and only
      // where that row carried provenance — the same rule everything else in
      // this app follows. Dropping them would make a template built from a
      // scanned food report as uncovered.
      const claimed = typeof row.microsSource === 'string' && row.microsSource ? row.microsSource : null;
      const micros = claimed ? pickMicros(row) : {};
      return {
        ...micros,
        microsSource: hasMicroData(micros) ? claimed : null,
        name: row.name || row.item || entry.name,
        role,
        calories: Number(row.calories) || 0,
        protein: Number(row.protein) || 0,
        carbs: Number(row.carbs) || 0,
        fat: Number(row.fat) || 0,
        color: row.color || row.noom_color || 'yellow',
        icon: row.icon ?? null,
        grams: Number(row.grams) || 0,
        unit: row.unit || 'serving',
        amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : 1,
        presence: entry.share,
      };
    };

    seen.add(key);
    proposals.push({
      key,
      suggestedName,
      mealTime,
      occurrences: group.length,
      components: [
        ...ordered.map((entry) => component(entry, 'core')),
        ...variants
          .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))
          .map((entry) => component(entry, 'variant')),
      ],
    });
  }

  return proposals.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

export default mineTemplates;
