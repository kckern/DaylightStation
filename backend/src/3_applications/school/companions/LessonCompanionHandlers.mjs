import { mergeRanges, coverageFraction, isSatisfied } from '#domains/school/companionCoverage.mjs';

/** Registry boundary for the different things a worksheet companion can do. */
export class LessonCompanionHandlers {
  #handlers;
  constructor(handlers = []) { this.#handlers = new Map(handlers.map((handler) => [handler.name, handler])); }
  async open({ offer }) {
    const handler = this.#handlers.get(offer?.companion?.handler);
    return handler?.open ? handler.open({ offer }) : { outcome: 'refused', sentence: 'That lesson companion is not available on this screen.' };
  }
  /**
   * A handler with no `recordProgress` answers `{ok: true, tracked: false}` and
   * NOTHING ELSE — no `satisfied`, no `code`. The absence is the honest answer:
   * a handler that cannot measure progress has no verdict to give, and adding a
   * `satisfied: false` here would let a caller read "we checked and it is not
   * done" off a companion nobody ever checked.
   */
  async recordProgress({ offer, payload }) {
    const handler = this.#handlers.get(offer?.companion?.handler);
    if (!handler?.recordProgress) return { ok: true, tracked: false };
    return handler.recordProgress({ offer, payload });
  }
}

/** No rate reported means normal speed — a client that never changed it has nothing to say. */
const usableRate = (value) => (Number.isFinite(value) && value > 0 ? value : 1);
const usableSeconds = (value) => Math.max(0, Number(value) || 0);

/**
 * The most disjoint segments one part will bank.
 *
 * The record is SHARED — every child on the lesson writes it, roughly every ten
 * seconds while they listen — so its size is not one learner's problem. Two
 * thousand sub-second seeks bank as two thousand segments and a 63KB rewrite on
 * every tick. Contiguous listening merges to one segment, so a child who is
 * actually listening never comes near this; a child scrubbing does.
 *
 * Over the cap the SHORTEST segments are DROPPED, never coalesced. Coalescing
 * would bridge the gaps between them and credit audio nobody heard, which turns
 * a size guard into a gate bypass. Dropping can only ever cost coverage, and
 * what it costs is the slivers, not the listening.
 */
const MAX_SEGMENTS = 200;

/**
 * Sorted, non-overlapping ranges inside `[0, duration]`, at most MAX_SEGMENTS.
 *
 * `mergeRanges` bounds starts at 0 but leaves ends unbounded, and
 * `coverageFraction` caps the RATIO rather than rejecting the input — so
 * `[[-100, 200]]` against a 100-second part is already harmless to the gate,
 * but banks as `[[0, 200]]` and stores `fraction: 1`. That is a lie in the file
 * a grown-up opens to find out why a gate will not move. Clamp it here, where
 * the duration is known, so the record says what actually happened.
 */
function bankable(ranges, duration) {
  const bounded = duration > 0
    ? mergeRanges(ranges).map(([start, end]) => [start, Math.min(end, duration)])
    : mergeRanges(ranges);
  // Re-merged: clamping can push two segments into contact.
  const merged = mergeRanges(bounded);
  if (merged.length <= MAX_SEGMENTS) return merged;
  return [...merged]
    .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
    .slice(0, MAX_SEGMENTS)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * The first handler: a text-and-audio sequence, with optional part telemetry.
 *
 * WHY THIS ANSWERS WITH A VERDICT. The caller cannot decide satisfaction for
 * itself: the letters live only in the code record (per household), the
 * coverage is banked there too, and `require_parts` is authored per lesson.
 * `{ok: true, tracked: true}` would leave the frontend to guess, and the only
 * signal it has to guess from is the one that lies — see below.
 *
 * WHY POSITION AND `completed` ARE NOT EVIDENCE. `Player.handleResilienceExhausted`
 * calls the SAME `clear()` callback as a genuine end-of-media event, so a child
 * whose stream died five seconds in reports `completed: true` from the identical
 * code path as one who listened to the whole thing. They are still written down —
 * the player resumes from `lastPositionSeconds` — but only `isSatisfied` over the
 * banked coverage decides the gate.
 *
 * WHY SATISFACTION IS HOUSEHOLD-WIDE. The code scope drops the learner (see
 * `YamlCompanionCodeStore`'s header), so when one child plays it through, the
 * next child's very first progress ping comes back with the code and no playback
 * of their own. That is the design, not a hole: the assumption is that they were
 * in the room.
 */
export class ReadalongLessonCompanionHandler {
  name = 'readalong';
  #companions; #codes; #clock; #logger;
  constructor({ companions, companionCodes = null, clock = () => new Date(), logger = console } = {}) {
    this.#companions = companions; this.#codes = companionCodes; this.#clock = clock; this.#logger = logger;
  }
  async open({ offer }) {
    const now = this.#clock().toISOString();
    const updated = await this.#companions.update(offer.id, (current) => ({
      ...current, state: { ...(current.state ?? {}), openedAt: current.state?.openedAt ?? now, parts: current.state?.parts ?? {} },
    }));
    if (!updated) return { outcome: 'failed', sentence: 'Something went wrong. Tell a grown-up.' };
    return {
      outcome: 'mount', sentence: 'Opening your companion.',
      effect: { kind: 'companion', companionId: updated.id, presentation: 'readalong', title: updated.companion.payload.playlist.title, parts: updated.companion.payload.playlist.parts, state: updated.state ?? {}, participation: updated.participation, learnerId: updated.learnerId },
    };
  }

  /**
   * @param {object} args
   * @param {object} args.offer the per-learner companion record
   * @param {{partId?: string, positionSeconds?: number, durationSeconds?: number,
   *          completed?: boolean, playedRanges?: Array<[number, number]>,
   *          maxRate?: number}} args.payload
   *   `playedRanges` is what the media element reports it actually rendered
   *   SINCE THE LAST SAMPLE, and `maxRate` is the fastest rate seen during that
   *   window. Both halves of that sentence are load-bearing and the client owes
   *   them: because a sample whose rate exceeded 1 has its ranges dropped
   *   outright, a client that instead sent the element's CUMULATIVE `played`
   *   would re-offer the fast audio on the next normal-speed tick and launder
   *   it. Deltas, paired with the rate they were played at.
   * @returns {Promise<{ok: boolean, tracked: boolean, satisfied?: boolean,
   *                    code?: string[]|null, remainingParts?: number,
   *                    gate?: 'none'|'open'|'closed'|'unavailable'}>}
   */
  async recordProgress({
    offer,
    payload: {
      partId, positionSeconds = 0, durationSeconds = 0, completed = false,
      playedRanges = [], maxRate,
    } = {},
  }) {
    const now = this.#clock().toISOString();
    const updated = await this.#companions.update(offer.id, (current) => {
      const part = current.companion?.payload?.playlist?.parts?.find((candidate) => candidate.id === partId);
      if (!part) return current;
      const previous = current.state?.parts?.[partId] ?? {};
      return {
        ...current,
        state: { ...(current.state ?? {}), openedAt: current.state?.openedAt ?? now, lastUpdatedAt: now,
          parts: { ...(current.state?.parts ?? {}), [partId]: {
            ...previous, startedAt: previous.startedAt ?? now,
            lastPositionSeconds: usableSeconds(positionSeconds),
            durationSeconds: usableSeconds(durationSeconds) || previous.durationSeconds || 0,
            ...(completed ? { completedAt: previous.completedAt ?? now } : {}),
          } },
        },
      };
    });
    if (!updated) return { ok: false, tracked: false };

    const verdict = await this.#verdict({ offer: updated, partId, durationSeconds, playedRanges, maxRate, now });
    return { ok: true, tracked: true, ...verdict };
  }

  /**
   * Bank the coverage and read the gate off it.
   *
   * `gate` SEPARATES THREE THINGS THAT OTHERWISE LOOK IDENTICAL. Without it,
   * `{satisfied: false, code: null, remainingParts: 0}` is the answer for an
   * optional companion that has no gate at all AND for a required one whose
   * code record is missing — so a card could tell a child "you're all set" over
   * a broken gate, or ask them to finish a read-along that never gated anything.
   *
   * - `none`        optional participation: no gate, no code, nothing to finish
   * - `open`        satisfied; `code` carries the letters
   * - `closed`      required and not yet satisfied; `remainingParts` is real
   * - `unavailable` the gate cannot be read (mis-wired store, or the record the
   *                 offer names is gone). Logged. A caller must show a
   *                 tell-a-grown-up slip, NOT a progress number.
   */
  async #verdict({ offer, partId, durationSeconds, playedRanges, maxRate, now }) {
    const ungated = { satisfied: false, code: null, remainingParts: 0, gate: 'none' };
    if (offer.participation !== 'required' || !offer.codeRef) return ungated;
    if (!this.#codes) {
      // A mis-wired composition, not a child's fault. Loud, and the telemetry
      // still landed — but the gate cannot be answered, so nothing is released.
      this.#logger.warn?.('school.companion.code-store-not-configured', {
        companionId: offer.id, lessonId: offer.lessonId,
      });
      return { ...ungated, gate: 'unavailable' };
    }

    const parts = offer.companion?.payload?.playlist?.parts ?? [];
    // A part the playlist does not name cannot bank coverage: the id travels
    // from a browser, and a typo must not mint a coverage bucket that then
    // counts toward the gate.
    const part = parts.find((candidate) => candidate.id === partId) ?? null;

    const record = await this.#codes.update(offer.codeRef, (draft) => {
      // MUTATE IN PLACE, return nothing. `YamlCompanionCodeStore.update` refuses
      // anything else, and the concise-arrow form that returns the value it
      // assigned once bricked a household's record permanently.
      draft.coverage = draft.coverage ?? {};
      if (part) {
        const banked = draft.coverage[part.id] ?? {};
        // A RUNNING MAXIMUM, for the same reason the rate rule exists: duration
        // is the DENOMINATOR, and a smaller one is strictly easier to satisfy.
        // Latest-wins here was a gate bypass with no playback in it at all —
        // report an hour and thirty seconds of it, then re-report the SAME part
        // as thirty seconds long with no ranges, and the banked thirty seconds
        // became the whole part. It is also not only hostile input: the client
        // pairs `durationSeconds` with `partId`, so any slip during a part
        // change drops a short chapter's length into a long chapter's bucket.
        const duration = Math.max(usableSeconds(banked.duration), usableSeconds(durationSeconds));
        // RATE GATES THE SAMPLE, and is not persisted.
        //
        // The earlier design banked a monotonic `maxRate` and let `isSatisfied`
        // refuse on it. That refused the right play and then never let go: one
        // chapter skimmed at 2x poisoned its bucket permanently, ten honest 1x
        // replays could not clear it, and because `requireParts` is every part,
        // it locked the SIBLING out of a lesson they never touched — with the
        // record reading `fraction: 1, satisfied: false` and no way for any UI
        // to say why. Dropping the fast sample's ranges instead refuses exactly
        // the same cheat ("set 2x, play through, set 1x on the last sample"
        // banks nothing) while an honest replay at normal speed still earns its
        // coverage. Conservative in the same direction, recoverable.
        const fast = usableRate(maxRate) > 1;
        const dropped = (Number(banked.fastSamplesDropped) || 0) + (fast ? 1 : 0);
        const incoming = fast || !Array.isArray(playedRanges) ? [] : playedRanges;
        // `mergeRanges` is idempotent and sorts, so merging the stored ranges
        // with the new ones IS the accumulate operation — two half-plays across
        // a reload become one whole.
        const ranges = bankable([...(banked.ranges ?? []), ...incoming], duration);
        draft.coverage[part.id] = {
          ranges,
          duration,
          // Derived, rewritten from the same two fields in the same breath so it
          // cannot drift. It is here for the grown-up reading the YAML to find
          // out why a gate will not open — which is also why the count below is
          // kept: "coverage is not moving" and "every sample so far was too
          // fast" look identical without it.
          fraction: coverageFraction({ ranges, duration }),
          satisfied: isSatisfied({ ranges, duration }),
          // Carried forward whether or not THIS sample was fast: the count is a
          // history, and zeroing it on the next honest tick would erase the only
          // evidence of why nothing accumulated.
          ...(dropped ? { fastSamplesDropped: dropped } : {}),
        };
      }
      const cleared = parts.filter((candidate) => draft.coverage[candidate.id]?.satisfied === true);
      if (!draft.satisfiedAt && cleared.length >= requiredParts(draft.requireParts, parts.length)) {
        // FIRST SATISFIER WINS, and is never overwritten: `satisfiedBy` is the
        // child who actually did the listening, and a sibling reading the code
        // afterwards must not take the credit.
        draft.satisfiedAt = now;
        draft.satisfiedBy = offer.learnerId ?? null;
        // The part's contentId, not its id — it is the thing that was played.
        draft.satisfiedVia = (part && cleared.some((candidate) => candidate.id === part.id)
          ? part
          : cleared[cleared.length - 1])?.contentId ?? null;
      }
    });
    if (!record) {
      // The offer names a code record that is gone or unreadable. The gate
      // cannot be answered from nothing, and guessing `satisfied` either way is
      // worse than saying no.
      this.#logger.error?.('school.companion.code-record-missing', {
        companionId: offer.id, codeRef: offer.codeRef, lessonId: offer.lessonId,
      });
      return { ...ungated, gate: 'unavailable' };
    }

    const required = requiredParts(record.requireParts, parts.length);
    const cleared = parts.filter((candidate) => record.coverage?.[candidate.id]?.satisfied === true).length;
    const satisfied = Boolean(record.satisfiedAt);
    return {
      satisfied,
      code: satisfied ? record.code ?? null : null,
      // What is still OUTSTANDING against the requirement, not how many parts
      // are unplayed. With `requireParts: 1` over four chapters and none of
      // them touched this is 1, because one is all the gate ever wanted.
      remainingParts: satisfied ? 0 : Math.max(0, required - cleared),
      gate: satisfied ? 'open' : 'closed',
    };
  }
}

/**
 * How many parts must clear, as a count — which is how both authored settings
 * arrive: `requireParts: 1` is 1, `requireParts: all` is the playlist's length
 * (`IssueDocument.resolveRequireParts` settles it at mint time, so the number
 * is frozen with the code and cannot move under a printed sheet).
 *
 * Clamped to the playlist, because a record asking for more parts than exist is
 * a gate no child can ever open, and a lesson whose chapter list was edited
 * after the code was minted would produce exactly that.
 */
function requiredParts(stored, total) {
  const parts = total > 0 ? total : 1;
  // Anything that is not a usable count means EVERY part — `'all'` from a
  // hand-edited record, and `undefined` from one minted before the field
  // existed. Defaulting to 1 here would loosen a gate on a record nobody
  // intended to loosen; every part is the reading this codebase already had.
  if (!Number.isFinite(stored) || stored < 1) return parts;
  return Math.min(Math.floor(stored), parts);
}
