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
   *   `playedRanges` is the union of what the media element reports it actually
   *   rendered since the last sample; `maxRate` is the fastest rate seen during
   *   it. Both are folded into what is already banked, so a reload adds rather
   *   than replaces.
   * @returns {Promise<{ok: boolean, tracked: boolean, satisfied?: boolean,
   *                    code?: string[]|null, remainingParts?: number}>}
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
   * An OPTIONAL companion has no `codeRef`, no record and no gate, so it answers
   * `satisfied: false, code: null, remainingParts: 0` — nothing is outstanding
   * because nothing is required, and there is no code to withhold or release.
   */
  async #verdict({ offer, partId, durationSeconds, playedRanges, maxRate, now }) {
    const unsatisfied = { satisfied: false, code: null, remainingParts: 0 };
    if (offer.participation !== 'required' || !offer.codeRef) return unsatisfied;
    if (!this.#codes) {
      // A mis-wired composition, not a child's fault. Loud, and the telemetry
      // still landed — but the gate cannot be answered, so nothing is released.
      this.#logger.warn?.('school.companion.code-store-not-configured', {
        companionId: offer.id, lessonId: offer.lessonId,
      });
      return unsatisfied;
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
        // `mergeRanges` is idempotent and sorts, so merging the stored ranges
        // with the new ones IS the accumulate operation — two half-plays across
        // a reload become one whole.
        const ranges = mergeRanges([...(banked.ranges ?? []), ...(Array.isArray(playedRanges) ? playedRanges : [])]);
        // A RUNNING MAXIMUM, persisted, monotonic. The instantaneous rate is
        // worthless: a child sets 2x, plays through, sets it back to 1x before
        // the final sample, and would otherwise pass — and so would one who
        // simply refreshed the page.
        const rate = Math.max(usableRate(banked.maxRate), usableRate(maxRate));
        const duration = usableSeconds(durationSeconds) || usableSeconds(banked.duration);
        draft.coverage[part.id] = {
          ranges,
          duration,
          maxRate: rate,
          // Derived, rewritten from the same three fields in the same breath so
          // it cannot drift. It is here for the grown-up reading the YAML to
          // find out why a gate will not open.
          fraction: coverageFraction({ ranges, duration }),
          satisfied: isSatisfied({ ranges, duration, maxRate: rate }),
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
      return unsatisfied;
    }

    const required = requiredParts(record.requireParts, parts.length);
    const cleared = parts.filter((candidate) => record.coverage?.[candidate.id]?.satisfied === true).length;
    const satisfied = Boolean(record.satisfiedAt);
    return {
      satisfied,
      code: satisfied ? record.code ?? null : null,
      // What is still OUTSTANDING against the requirement, not how many parts
      // are unplayed. With `require_parts: 1` over four chapters and none of
      // them touched this is 1, because one is all the gate ever wanted.
      remainingParts: satisfied ? 0 : Math.max(0, required - cleared),
    };
  }
}

/**
 * How many parts must clear, as a count — which is how both authored settings
 * arrive: `require_parts: 1` is 1, `require_parts: all` is the playlist's
 * length (`IssueDocument` resolves it at mint time).
 *
 * Clamped to the playlist, because a record asking for more parts than exist is
 * a gate no child can ever open, and a lesson whose chapter list was edited
 * after the code was minted would produce exactly that.
 */
function requiredParts(stored, total) {
  const asked = Number.isFinite(stored) && stored >= 1 ? Math.floor(stored) : 1;
  return total > 0 ? Math.min(asked, total) : asked;
}
