/**
 * NFC resolver: turns a (location, tagUid) pair into a resolved trigger
 * intent. Universal tag lookup + reader-default merging + per-reader override
 * + content-shorthand expansion.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless cross-entity
 * logic per domain-layer-guidelines.md. No I/O, no YAML knowledge — receives
 * already-parsed shapes from the adapter.
 *
 * Precedence (later wins):
 *   reader.defaults  <  tag.global  <  tag.overrides[location]
 *
 * Reserved fields (action, target, content) follow the same chain. Other
 * fields (shader, volume, etc.) flow into intent.params.
 *
 * Returns null if the location or tag is not registered (caller treats
 * missing as TRIGGER_NOT_REGISTERED).
 *
 * Throws ValidationError for malformed entries (e.g., ambiguous shorthand).
 *
 * @module domains/trigger/services/NfcResolver
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
  'end', 'end_location', 'endpoint',
  // A learner card names a PERSON. It is actionable, but its action comes
  // from the reader location (`learner_action`), never from the tag — the
  // same card must be able to mean "print my agenda" in the study and
  // "start my reading session" in the living room.
  'school_learner',
]);

// Tag bookkeeping written by YamlTriggerConfigRepository on first scan.
// Never actionable, never a shorthand candidate, and — critically — never
// forwarded in intent.params: params become the device-URL query string,
// where a leaked scanned_at was mis-parsed as a content id (2026-07-07 bug).
const METADATA_KEYS = new Set(['scanned_at', 'note']);

/**
 * A learner id becomes a URL segment downstream. `String(raw)` would happily
 * mint "learner-a,learner-b" from a YAML list and "[object Object]" from a map,
 * and the 404 that follows names neither the tag nor the line that caused it —
 * so refuse here, where the tag uid is still in hand. A number is allowed
 * because an unquoted numeric id is an ordinary YAML slip, not a mistake.
 */
function coerceLearnerId(raw, uid) {
  const bad = (why) => new ValidationError(
    `tag ${uid}: school_learner ${why}`,
    { code: 'INVALID_SCHOOL_LEARNER', field: 'school_learner' }
  );
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw bad('must be a finite number or a non-empty string');
    return String(raw);
  }
  if (typeof raw !== 'string') throw bad(`must be a string, got ${Array.isArray(raw) ? 'a list' : typeof raw}`);
  const trimmed = raw.trim();
  if (!trimmed) throw bad('must not be empty');
  return trimmed;
}

function expandShorthand(merged, contentIdResolver) {
  const candidates = Object.entries(merged).filter(([k]) => !RESERVED_KEYS.has(k) && !METADATA_KEYS.has(k));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const resolvable = candidates.filter(([k, v]) => contentIdResolver?.resolve(`${k}:${v}`));
    if (resolvable.length > 1) {
      throw new ValidationError(
        `ambiguous shorthand: multiple keys (${resolvable.map(([k]) => k).join(', ')}) resolve as content`,
        { code: 'AMBIGUOUS_SHORTHAND' }
      );
    }
    if (resolvable.length === 1) return { compound: `${resolvable[0][0]}:${resolvable[0][1]}`, key: resolvable[0][0] };
    return null;
  }
  const [[prefix, value]] = candidates;
  const compound = `${prefix}:${value}`;
  if (!contentIdResolver?.resolve(compound)) return null;
  return { compound, key: prefix };
}

/**
 * Stateless domain service. Use static method.
 *
 * @class NfcResolver
 * @stateless
 */
export class NfcResolver {
  /**
   * Resolve an (location, tagUid) pair against the NFC registry slice.
   *
   * @param {Object} args
   * @param {string} args.location  reader location ID (e.g. 'livingroom')
   * @param {string} args.value     raw tag UID (case-insensitive)
   * @param {Object} args.registry  the `nfc` slice of the trigger registry: { locations, tags }
   * @param {Object} args.contentIdResolver  has `.resolve(compound)` -> truthy if valid
   * @returns {Object|null} resolved intent { action, target, content, params, ... } or null if not registered
   * @throws {ValidationError} if shorthand expansion is ambiguous
   */
  static resolve({ location, value, registry, contentIdResolver }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;

    // Canonical, not merely lowercased. A reader reporting `04669C0FCB2A81` and
    // config spelling the same card `04_66_9c_0f_cb_2a_81` must resolve to ONE
    // tag; lowercasing alone left the packed form permanently unknown.
    const uid = canonicalizeNfcUid(value);
    const tag = registry?.tags?.[uid];
    if (!tag) return null;

    // Merge: readerDefaults < tagGlobal < tagOverridesForLocation
    const merged = {
      ...(locationConfig.defaults || {}),
      ...(tag.global || {}),
      ...(tag.overrides?.[location] || {}),
    };

    // Action and target follow the same chain. Reserved keys can appear in any
    // layer (reader-defaults can NOT today set action/target since those are
    // first-class on the location, but tag-global/tag-overrides can).
    const action = merged.action ?? locationConfig.action;
    const target = merged.target ?? locationConfig.target;
    const end = merged.end ?? locationConfig.end;
    const endLocation = merged.end_location ?? locationConfig.end_location;

    // WHO the card belongs to is a TAG fact, so it is read from the tag layers
    // alone — deliberately NOT from `merged`. The adapter drops any unknown key
    // on a source entry into `defaults`, so a stray `school_learner:` on a
    // READER would otherwise turn every tag at that reader into a learner card
    // and throw its content away: a book sticker would stop playing its book.
    //
    // WHAT happens to that person, in contrast, belongs to the reader — print
    // an agenda in the study, open a reading session in the living room. No
    // learner_action here means the card is not actionable at this reader, and
    // the null intent routes it into the ordinary unknown-tag capture, which
    // lets a mis-tapped card be noticed.
    //
    // This runs BEFORE content resolution and must stay there: a learner card
    // carries no content, and shorthand expansion over a reader's own defaults
    // can throw AMBIGUOUS_SHORTHAND before we ever reach the learner check.
    // The test 'resolves a learner card at a reader whose defaults carry two
    // content-resolvable keys' pins that ordering.
    //
    // INTERIM (Task 6): mapIntentToResponse knows six actions and none of them
    // is a learner action, so it throws UnknownActionError on what we return —
    // which ALSO skips the unknown-tag placeholder write and the notify_unknown
    // push the old null path gave us. Do NOT add learner_action to a live
    // reader in sources.yml before Task 6 lands; the data tree is shared with
    // prod, so that one-line YAML edit arms it with no deploy. (The config edit
    // belongs to Plan 01 Task 7.)
    const schoolLearner = tag.overrides?.[location]?.school_learner ?? tag.global?.school_learner;
    if (schoolLearner !== undefined && schoolLearner !== null) {
      // Validate before consulting the reader: a malformed value is a bug in
      // the tag, true at every reader, and worth surfacing wherever it is
      // tapped rather than only where a learner_action happens to be declared.
      const learnerId = coerceLearnerId(schoolLearner, uid);
      const learnerAction = locationConfig.learner_action;
      if (!learnerAction) return null;
      return { action: learnerAction, target, learnerId, params: {} };
    }

    // Resolve content. Explicit `content` wins; otherwise expand single-prefix shorthand.
    let content = merged.content;
    let consumedKey = null;
    if (!content) {
      const shorthand = expandShorthand(merged, contentIdResolver);
      if (shorthand) {
        content = shorthand.compound;
        consumedKey = shorthand.key;
      }
    }

    // Build params from leftover non-reserved keys.
    const params = {};
    for (const [k, v] of Object.entries(merged)) {
      if (RESERVED_KEYS.has(k)) continue;
      if (METADATA_KEYS.has(k)) continue;
      if (k === consumedKey) continue;
      params[k] = v;
    }

    const intent = { action, target, params };
    if (content !== undefined) intent.content = content;
    if (merged.scene !== undefined) intent.scene = merged.scene;
    if (merged.service !== undefined) intent.service = merged.service;
    if (merged.entity !== undefined) intent.entity = merged.entity;
    if (merged.data !== undefined) intent.data = merged.data;
    if (merged.endpoint !== undefined) intent.endpoint = merged.endpoint;
    // 'nothing' explicitly disables the configured behavior; treat as absent.
    if (end && end !== 'nothing') {
      intent.end = end;
      if (endLocation) intent.endLocation = endLocation;
    }

    // A tag is dispatchable only if it has at least one actionable field.
    // Tags with only metadata (scanned_at, note, etc.) resolve to no intent
    // so the dispatcher routes them to the unknown-tag capture flow.
    const hasDispatchable = intent.content !== undefined
      || intent.scene !== undefined
      || intent.service !== undefined
      || intent.entity !== undefined
      || intent.endpoint !== undefined;
    if (!hasDispatchable) return null;

    return intent;
  }
}

export default NfcResolver;
