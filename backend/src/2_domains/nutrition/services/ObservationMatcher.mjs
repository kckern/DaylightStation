/**
 * Pure matching rules: which scale OBSERVATIONS belong to which food-log ENTRY.
 *
 * This replaces an in-memory, per-scale composition buffer,
 * an in-memory `Map<scaleId, {composition, touchedAt}>`, with a durable, re-pairable
 * pipeline: raw scale signals persist as `Observation` rows
 * (`1_adapters/persistence/yaml/YamlObservationStore.mjs`) and THIS module recomputes,
 * on every call, which of them belong together and which of them belong to an existing
 * food-log entry. There is no state here — every call is a fresh judgment over whatever
 * `observations` / `entries` / `nowTs` it is handed, which is what makes "re-pairable"
 * possible at all: the exact same inputs (observations replayed after a restart, a
 * manual re-pair from the day view) always produce the exact same verdict.
 *
 * ## Two separate jobs, one call
 *
 * `pairings` answers "does this OPEN observation belong to an ALREADY-EXISTING food-log
 * entry" — the retroactive-enrichment case: someone types/speaks/photographs a meal, then
 * weighs it, and the weight should attach to that entry rather than spawn a second one.
 * More than one observation can point at the SAME `entryUuid` — a weight, a density scan
 * and a container scan can all independently resolve to the one entry they belong to,
 * which is exactly the shape the old composition (weight + density + container -> one
 * entry) needs when expressed as flat pairing rows instead of a single merged struct.
 * One observation never pairs to more than one entry — each is matched once, to its
 * single nearest eligible candidate.
 *
 * `composition` answers the other half: what does an observation do when NO entry exists
 * yet for it to enrich? That is the in-progress composition per scale (grams / density /
 * container slots, "is it complete"). Every OPEN weight/density/container observation
 * that did NOT resolve to an existing entry, and is still within the window of `nowTs`,
 * is merged into a composition snapshot the caller (the scale observation service
 * `ObservationService`) can use to decide whether a NEW entry should be created now. A
 * `upc` observation is never part of a composition — it names a product, not a scale
 * slot — so it can only ever appear in `pairings` or be left alone.
 *
 * ## Confidence is a structural ambiguity signal, not a probability
 *
 * Every pairing's `confidence` is either `1` (this observation had exactly ONE eligible
 * candidate entry — the match is unambiguous) or `0.5` (two or more entries were both
 * in-window, same-date and unsettled, and nearest-in-time had to arbitrate between them).
 * It is not a statistical estimate of correctness — there is no training data or scoring
 * model behind it — it is a direct readout of whether the matcher's own tie-break rule
 * did any work. A constant `1` everywhere would make the field decoration: the reason it
 * carries real information is that a caller (the day view, Task 5.4) can treat a `0.5`
 * pairing differently — e.g. surface it for a human glance instead of silently trusting a
 * choice the matcher itself knows was contested — without having to re-derive "how many
 * other entries could this have been" itself.
 *
 * ## Why this is not just a stateless port of the old buffer
 *
 * The old buffer never looked at food-log entries at all — every weight it saw became
 * (via `LogFoodFromScale`) a BRAND NEW entry. This module's `pairings` half is genuinely
 * new behavior: a durable observation can now attach itself to an entry that already
 * exists, which is the whole point of storing it durably instead of holding it only in
 * memory until the next composition wipes it.
 *
 * @module nutrition/services/ObservationMatcher
 */

/** The shipped 900 s composition window. */
export const MATCH_WINDOW_MS = 900_000;

/** Sanity bound on weight-implied calorie density. No real food is 20 kcal/gram; pure fat is ~9. */
export const MIN_PLAUSIBLE_KCAL_PER_G = 0.1;
export const MAX_PLAUSIBLE_KCAL_PER_G = 9;

const LOCAL_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the codebase's standard local timestamp (`YYYY-MM-DD HH:mm:ss`, see
 * `#domains/core/utils/time.mjs`'s `formatLocalTimestamp`) into a comparable integer
 * number of seconds. `Date.UTC` is a pure function of its numeric arguments — it reads no
 * ambient clock and produces the same value for the same digits every time — it is used
 * here purely as an arithmetic combinator, never to represent an actual UTC instant. This
 * deliberately avoids `new Date("YYYY-MM-DD HH:mm:ss")`, whose interpretation of a
 * space-separated, non-ISO string is implementation-defined and not something a pure
 * domain module should depend on.
 *
 * @param {unknown} ts
 * @returns {number|null} Comparable seconds, or `null` if `ts` is not the expected shape.
 */
function parseLocalTimestamp(ts) {
  if (typeof ts !== 'string') return null;
  const m = LOCAL_TIMESTAMP_RE.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 1000;
}

/**
 * An entry's own local timestamp, preferring `at` (the field name observations use) and
 * falling back to `createdAt` (the field name `NutriLog` records use) so this module works
 * against either shape without the caller having to normalize first.
 *
 * @param {object} entry
 * @returns {string|undefined}
 */
function entryTimestampField(entry) {
  return entry?.at ?? entry?.createdAt;
}

/**
 * An entry's calendar date. Prefers an explicit `date` field; falls back to the first 10
 * characters of its timestamp — the same derivation `YamlObservationStore.append` uses for
 * observations, and the same one `settlement.mjs`'s `dayOf` uses for entries — so a caller
 * that only ever set `createdAt` still gets a correct date without having to duplicate it.
 *
 * @param {object} entry
 * @returns {string|null} `YYYY-MM-DD`, or `null` if neither field yields one.
 */
function entryDate(entry) {
  if (typeof entry?.date === 'string' && DATE_RE.test(entry.date)) return entry.date;
  const ts = entryTimestampField(entry);
  if (typeof ts === 'string' && ts.length >= 10) {
    const prefix = ts.slice(0, 10);
    if (DATE_RE.test(prefix)) return prefix;
  }
  return null;
}

/**
 * "Unsettled" per the program's storage contract: `settled` is ABSENCE-SENSITIVE.
 * Absent or `true` means "treat as settled" (a legacy row, or a row a human has already
 * reviewed) — NOT a candidate for automatic re-pairing. Only an EXPLICIT `settled: false`
 * opens an entry up to being matched. This is deliberately the raw field, not
 * `settlement.mjs`'s `effectiveSettled` (which additionally auto-settles a `false` row
 * once it is more than `AUTO_SETTLE_DAYS` old): that auto-settle-by-age rule is a
 * PRESENTATION concern (how old, unresolved entries render), and every candidate this
 * module ever considers is already constrained to the observation's own calendar date, so
 * the age branch could never fire differently here than a bare `=== false` check would —
 * pulling in the extra module would add coupling with no behavioral difference.
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isUnsettled(entry) {
  return entry?.settled === false;
}

/**
 * Whether an entry is even structurally usable as a pairing candidate. Mirrors
 * `YamlObservationStore`'s own posture toward bad rows (`isStructurallyValid` /
 * `#readAllValid`): a malformed candidate is skipped, not a reason to throw and abort
 * matching for every OTHER, well-formed entry and observation in the same call.
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isUsableEntry(entry) {
  return (
    entry !== null && typeof entry === 'object' &&
    typeof entry.uuid === 'string' && entry.uuid.length > 0 &&
    parseLocalTimestamp(entryTimestampField(entry)) !== null &&
    entryDate(entry) !== null
  );
}

/**
 * The weight-plausibility gate (PRD F3.7): a weight observation paired to an entry
 * implies a kcal-per-gram ratio for whatever was weighed. Outside
 * `[MIN_PLAUSIBLE_KCAL_PER_G, MAX_PLAUSIBLE_KCAL_PER_G]` the pairing is refused outright —
 * not retried against the next-nearest candidate, just refused, so the observation stays
 * `open` and waits rather than being FORCED onto the nearest entry regardless of whether
 * it makes physical sense. This mirrors `ScanNutritionService`'s posture: a wrong-looking
 * number is a reason to stop, not a reason to keep going with best effort.
 *
 * Only `kind: 'weight'` observations are gated this way — `density`/`container`/`upc`
 * observations carry no gram figure to sanity-check against calories.
 *
 * @param {object} observation
 * @param {object} entry
 * @returns {boolean}
 */
function isPlausibleWeightPairing(observation, entry) {
  if (observation.kind !== 'weight') return true;
  const grams = observation.value;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) return false;
  // A weight observation not measured in grams is exactly the case the commit path's
  // commit path refuses outright ("A non-gram unit refuses to commit outright" —
  // docs/reference/nutrition/README.md). The unit is not a `null` narrower than 'g' by
  // default per `YamlObservationStore.append`, but a caller could still hand this module
  // an `'oz'`/`'ml'` weight; treat it the same way the commit path does — not a candidate for
  // an entry whose calories were computed against net GRAMS.
  if (observation.unit != null && observation.unit !== 'g') return false;
  const calories = entry?.calories;
  if (typeof calories !== 'number' || !Number.isFinite(calories)) return false;
  const kcalPerG = calories / grams;
  return kcalPerG >= MIN_PLAUSIBLE_KCAL_PER_G && kcalPerG <= MAX_PLAUSIBLE_KCAL_PER_G;
}

/**
 * Find the best pairing target for one observation among a set of entries.
 *
 * Candidate rule: unsettled, same calendar date as the observation, within
 * `MATCH_WINDOW_MS` of it. **Same-date wins over the window when the two disagree** — see
 * the module-level "Midnight" note below. Tie-break: nearest in time; an EXACT tie (two
 * candidates equidistant from the observation) breaks on `entry.uuid` ascending, so the
 * winner never depends on array order — the same inputs must always produce the same
 * pairing, or a re-pair replay after a restart could silently pick a different entry than
 * the one it picked the first time.
 *
 * ## Midnight: same-date wins over the 900s window
 *
 * An observation at 23:59:30 and an entry at 00:01:00 the next day are 90 seconds apart —
 * comfortably inside the window — but on different calendar dates. This module resolves
 * that conflict in favor of the DATE: a cross-midnight pair is never made, even when the
 * clocks are close. Entries are a per-calendar-day ledger (each day has its own budget
 * total), and mis-filing a weight onto the WRONG day's entry corrupts that day's budget
 * silently — a worse outcome than leaving the observation open for someone to pair by
 * hand from the day view. This is also consistent with why the window itself is allowed
 * to straddle midnight elsewhere in this program: `YamlObservationStore.openForScale` /
 * `findByPairedEntry` are deliberately NOT date-scoped, because grouping several
 * OBSERVATIONS together (weight + density + container into one still-unentered
 * composition) is a different question from attaching an observation to an
 * ALREADY-DATED entry. The former has no calendar commitment yet to violate; the latter
 * does.
 *
 * @param {object} observation Already known to be `status: 'open'`.
 * @param {number} obsTs Parsed timestamp (seconds) of the observation.
 * @param {object[]} entries
 * @returns {{entry: object, distanceMs: number, contested: boolean}|null}
 */
function findBestCandidate(observation, obsTs, entries) {
  const obsDate = observation.date;
  let candidates = [];

  for (const entry of entries) {
    if (!isUsableEntry(entry)) continue;
    if (!isUnsettled(entry)) continue;
    if (entryDate(entry) !== obsDate) continue; // date wins over window — see docstring
    const entryTs = parseLocalTimestamp(entryTimestampField(entry));
    const distanceMs = Math.abs(entryTs - obsTs) * 1000;
    if (distanceMs > MATCH_WINDOW_MS) continue;
    candidates.push({ entry, distanceMs });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.distanceMs - b.distanceMs || (a.entry.uuid < b.entry.uuid ? -1 : a.entry.uuid > b.entry.uuid ? 1 : 0));

  const [best] = candidates;
  const contested = candidates.length > 1;

  if (!isPlausibleWeightPairing(observation, best.entry)) return null;

  return { entry: best.entry, distanceMs: best.distanceMs, contested };
}

/**
 * Merge the OPEN weight/density/container observations that found no entry to pair to
 * into a composition snapshot — the in-progress state a caller can use to
 * decide whether to quiet-commit a brand-new entry, the same question `read()`
 * used to report for its in-memory Map. `upc` observations never contribute — they name a
 * product, not one of the three composition slots.
 *
 * Only the most recently active scale's observations are reported (there is one physical
 * bridge in the field today; if unclaimed activity exists for more than one `scaleId`
 * this is an unexercised corner — the choice of "most recent wins" is documented here
 * rather than tested, and callers with a genuine multi-scale need should call this module
 * once per `scaleId` instead of relying on this fallback).
 *
 * @param {object[]} unclaimed Open weight/density/container observations with no pairing.
 * @param {number} nowTs Reference "now", ms since epoch.
 * @returns {{scaleId: string, grams: number|null, unit: string|null, density: number|string|null,
 *   container: string|null, complete: boolean, observationIds: string[]}|null}
 */
function buildComposition(unclaimed, nowTs) {
  const live = unclaimed.filter((obs) => {
    if (obs.kind === 'upc') return false;
    const ts = parseLocalTimestamp(obs.at);
    if (ts === null) return false;
    return Math.abs(nowTs - ts * 1000) <= MATCH_WINDOW_MS;
  });
  if (live.length === 0) return null;

  const byScale = new Map();
  for (const obs of live) {
    if (!byScale.has(obs.scaleId)) byScale.set(obs.scaleId, []);
    byScale.get(obs.scaleId).push(obs);
  }

  let chosenScaleId = null;
  let latestTs = -Infinity;
  for (const [scaleId, group] of byScale) {
    const groupLatest = Math.max(...group.map((o) => parseLocalTimestamp(o.at)));
    if (groupLatest > latestTs || (groupLatest === latestTs && (chosenScaleId === null || scaleId < chosenScaleId))) {
      latestTs = groupLatest;
      chosenScaleId = scaleId;
    }
  }

  const group = byScale.get(chosenScaleId).slice().sort((a, b) => parseLocalTimestamp(a.at) - parseLocalTimestamp(b.at));

  let grams = null;
  let unit = null;
  let density = null;
  let container = null;
  const observationIds = [];
  for (const obs of group) {
    observationIds.push(obs.id);
    if (obs.kind === 'weight') { grams = obs.value; unit = obs.unit ?? null; }
    else if (obs.kind === 'density') { density = obs.value; }
    else if (obs.kind === 'container') { container = obs.value; }
  }

  return {
    scaleId: chosenScaleId,
    grams,
    unit,
    density,
    container,
    complete: grams !== null && density !== null,
    observationIds,
  };
}

/**
 * Decide which OPEN observations belong to which unsettled food-log entries, and what is
 * still in progress with nowhere (yet) to go.
 *
 * Pure: no clock, no I/O, no randomness, no id generation. `nowTs` is the only notion of
 * "now" this module has, and it is used solely to decide whether unclaimed observations
 * are still within the composition window — it plays no role in `pairings`, which is
 * governed entirely by the observation's OWN timestamp against each entry's.
 *
 * @param {object} args
 * @param {object[]} args.observations Observations to consider. Anything other than
 *   `status: 'open'` is ignored — a `consumed`/`dismissed` row is already resolved and is
 *   not re-litigated here.
 * @param {object[]} args.entries Candidate food-log entries. Each needs a `uuid`, a local
 *   timestamp (`at` or `createdAt`), and either `date` or a timestamp to derive one from.
 *   A structurally unusable entry is skipped, not fatal.
 * @param {number} args.nowTs Reference "now" in ms since epoch, for the composition half
 *   only (see above).
 * @returns {{pairings: Array<{observationId: string, entryUuid: string, confidence: number}>,
 *   composition: object|null}}
 */
export function matchObservations({ observations, entries, nowTs }) {
  const openObservations = (observations ?? []).filter((o) => o?.status === 'open');
  const usableEntries = entries ?? [];

  const pairings = [];
  const claimedIds = new Set();

  for (const observation of openObservations) {
    const obsTs = parseLocalTimestamp(observation.at);
    if (obsTs === null) continue; // malformed observation: not fatal, just unmatchable

    const best = findBestCandidate(observation, obsTs, usableEntries);
    if (!best) continue;

    pairings.push({
      observationId: observation.id,
      entryUuid: best.entry.uuid,
      // See the module docstring's "Confidence" note: 1 when this was the observation's
      // ONLY eligible candidate, 0.5 when other candidates existed and nearest-in-time
      // had to arbitrate between them.
      confidence: best.contested ? 0.5 : 1,
    });
    claimedIds.add(observation.id);
  }

  const unclaimed = openObservations.filter((o) => !claimedIds.has(o.id));
  const composition = buildComposition(unclaimed, nowTs);

  return { pairings, composition };
}

export default matchObservations;
