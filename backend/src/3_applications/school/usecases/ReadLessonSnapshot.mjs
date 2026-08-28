/**
 * ReadLessonSnapshot — everything the living-room screen needs to take up a
 * gated media lesson, and nothing a child could use to skip one.
 *
 * The read half of the trio `DispatchMedia` / `RecordCheckpointAnswer` /
 * `RecordMediaCompletion` write. It exists because `GET /api/v1/school/lesson/
 * :sessionId` has to fold the session's event log and read the curriculum, and
 * `4_api` may do neither: `api-no-domains` forbids `reduceSession` and
 * `mediaCheckpoints` in a router, and `api-no-apps` means the router reaches a
 * use case rather than a store. So the derivation lives here, where it is also
 * testable without an HTTP server.
 *
 * ## WHAT IT MUST NEVER HAND OUT
 *
 * NO ANSWERS, EVER — but the QUESTIONS have to travel. `checkpoints` carries
 * `{id, at, items}` where `items` holds the PUBLIC projection of each bank
 * item (`{id, type, prompt, choices}`), never the authored item.
 *
 * The questions have to be here because nowhere else can send them:
 * `DispatchMedia.publicCheckpoints` strips items entirely, and
 * `RecordCheckpointAnswer` only GRADES — it answers `{status, correct,
 * attempts, checkpointCleared, seekCeiling, message}` and has never returned a
 * prompt. A snapshot of ids alone means `CheckpointQuizOverlay` has nothing to
 * render and every gate in the feature shows its fault card.
 *
 * What is withheld is the KEY: `answer`, `accept`, `expected`, and the answer
 * half of a matching item's `pairs`. See `PUBLIC_ITEM` below for the per-type
 * projection and for why it PICKS public keys rather than deleting private
 * ones.
 *
 * ## `cleared` IS A LIST OF BARE IDS
 *
 * Not the `{checkpointId, attempts, at}` rows the reducer holds. The screen
 * appends to this list locally when an answer clears a gate
 * (`useMediaLessonSession` does `[...prev, checkpointId]`) and hands the whole
 * thing to `useCheckpointGate` as `clearedIds`, so a row-shaped element would
 * make the list heterogeneous the moment the first checkpoint cleared and the
 * gate would stop recognising what was already answered. Ids in, ids out.
 *
 * ## `resumePosition` IS DERIVED, NOT REMEMBERED
 *
 * There is no durable playhead in this feature, by an explicit domain
 * decision: `sessionEvents.mjs` records `checkpoint_cleared` with a WALL-CLOCK
 * `at` and says in as many words that "a future need for the observed playhead
 * gets its own unambiguous `positionSeconds`" — no such event exists. So the
 * honest resume point is the furthest position we can PROVE the child reached:
 * the authored `at` of the furthest checkpoint they cleared. It is durable
 * (it comes off the event log), conservative (never ahead of what was watched)
 * and it costs no new state. `null` when nothing has cleared — never a
 * fabricated 0, which a screen would seek to and which would be
 * indistinguishable from "resume at the beginning".
 *
 * A lesson resumed this way replays the stretch between the last cleared gate
 * and where the child actually was. That is a few minutes of re-watching in
 * the reload case, and it re-asks NOTHING: cleared checkpoints stay cleared.
 *
 * ## IT REFUSES ONLY ONE THING
 *
 * An unknown session (`unknown_session` → 410 at the router). Every other
 * state answers: a stalled lesson, a completed one, a unit whose checkpoints
 * were edited away. A snapshot that refused would leave the widget with
 * nothing to render, and "blank TV in front of a four-year-old" is the failure
 * this whole subsystem is written to avoid. `playing` says which state it is
 * in so a caller that cares can tell.
 */
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { clearedSetFrom, seekCeilingFor } from '#domains/school/mediaCheckpoints.mjs';

/**
 * The PUBLIC projection of one bank item, per type.
 *
 * Every entry BUILDS a new object out of named keys. None of them spreads the
 * authored item, and that is the whole design: a field added to an item later
 * — a rubric, a hint, a second answer form — stays behind by default instead
 * of leaking on the day it is authored. `DispatchMedia.publicCheckpoints` made
 * the same choice for the same reason.
 *
 * WHAT IS PUBLIC: `prompt` and `choices`. Neither is an answer — a choice list
 * is the question — and both are already served whole to browsers by
 * `GET /api/v1/school/banks/:bankId`, which is how the touch-panel
 * `QuizRunner` renders items at all. This projection is strictly more
 * restrictive than that route, not less.
 *
 * WHAT IS NOT: `answer`, `accept`, `expected`, and the RIGHT half of a
 * `matching` item's `pairs`. A short-answer item is the clearest case — its
 * answer appears nowhere else, so shipping `accept` would hand over the key.
 *
 * MATCHING IS DELIBERATELY CRIPPLED HERE. Its `pairs` are simultaneously the
 * question (the left column) and the answer key (which right goes with which
 * left), so there is no projection that both renders it and withholds the key.
 * The lefts ship, the rights do not, and `MatchingItem` — which builds its
 * right-hand chips out of `p.right` — therefore cannot present a usable
 * question. That is the correct trade for THIS surface: a matching item is not
 * answerable from a d-pad in the first place (the living room has no pointer),
 * so authoring one onto a TV checkpoint is a curriculum mistake, and it should
 * fail visibly rather than by handing the answers to the room. The durable fix
 * is a validation rule at publish time, not a leak here.
 *
 * AN UNKNOWN TYPE HAS NO PROJECTOR AND IS NOT SHIPPED. It degrades to the bare
 * item id, which `CheckpointQuizOverlay` renders as its explicit fault card.
 * Fail-closed: a new item type cannot leak before somebody has decided what of
 * it is public.
 */
const PUBLIC_ITEM = Object.freeze({
  multiple_choice: (i) => ({ id: i.id, type: i.type, prompt: i.prompt, choices: [...(i.choices ?? [])] }),
  multi_select: (i) => ({ id: i.id, type: i.type, prompt: i.prompt, choices: [...(i.choices ?? [])] }),
  // The blank is IN the prompt (`ClozeItem` splits on `___`), so the prompt is
  // the whole renderable question and `answer` is pure key.
  cloze: (i) => ({ id: i.id, type: i.type, prompt: i.prompt }),
  short_answer: (i) => ({ id: i.id, type: i.type, prompt: i.prompt }),
  matching: (i) => ({
    id: i.id, type: i.type, prompt: i.prompt,
    pairs: (Array.isArray(i.pairs) ? i.pairs : []).map(({ left }) => ({ left })),
  }),
});

/** One item body, or `null` when nothing public can be made of it. */
function publicItem(item) {
  const project = item && typeof item === 'object' ? PUBLIC_ITEM[item.type] : null;
  if (!project || typeof item.id !== 'string' || !item.id) return null;
  return project(item);
}

export class ReadLessonSnapshot {
  #curriculum; #sessions; #bankReader; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {{getBank: (id: string) => object}} [deps.bankReader] - the same
   *   surface `RecordCheckpointAnswer` grades against, so the questions the
   *   screen shows and the questions the server marks come out of ONE bank
   *   read of ONE bank id. Optional: without it the checkpoints ship as bare
   *   ids and every gate shows the overlay's fault card — degraded, never
   *   leaky, and never a lesson that refuses to open.
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, bankReader = null, logger = console } = {}) {
    if (!curriculum || !sessions) throw new Error('ReadLessonSnapshot requires curriculum and sessions');
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#bankReader = bankReader;
    this.#logger = logger;
  }

  /**
   * @param {{sessionId?: string}} args
   * @returns {Promise<{ status: 'ok'|'unknown_session', sessionId: string|null,
   *                     learnerId: string|null, unitId: string|null,
   *                     contentId: string|null, title: string|null,
   *                     checkpoints: Array<{id: string, at: number}>,
   *                     cleared: string[], resumePosition: number|null,
   *                     seekCeiling: number|null, state: string|null, playing: boolean }>}
   */
  async execute({ sessionId = null } = {}) {
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) {
      this.#logger.info?.('school.lesson.snapshot.unknown-session', { sessionId });
      return {
        status: 'unknown_session',
        sessionId: null, learnerId: null, unitId: null, contentId: null, title: null,
        checkpoints: [], cleared: [], resumePosition: null, seekCeiling: null,
        state: null, playing: false,
      };
    }

    // A unit that cannot be read degrades to an UNGATED lesson rather than a
    // failure, matching `RecordMediaCompletion`'s judgement 1: we cannot know
    // what was owed, and refusing here would strand a child in front of a
    // lesson nothing can open. An empty list cannot block the frontend gate
    // ("no list, no gate"), which is the same safe direction.
    let unit = null;
    try {
      unit = await this.#curriculum.getUnit(state.unitId);
    } catch (err) {
      this.#logger.warn?.('school.lesson.snapshot.unit-unreadable', { sessionId, unitId: state.unitId, error: err.message });
    }
    const checkpoints = this.#publicCheckpoints(unit, sessionId);
    const cleared = [...clearedSetFrom(state.clearedCheckpoints)];

    // The title is the media's, not the unit's: it is what the screen puts
    // over the picture, and a manifest read that fails is worth a null rather
    // than a lesson that will not open.
    let title = unit?.title ?? null;
    if (unit?.media) {
      try {
        title = (await this.#curriculum.getManifest(unit.media))?.title ?? title;
      } catch (err) {
        this.#logger.warn?.('school.lesson.snapshot.manifest-unreadable', { sessionId, media: unit.media, error: err.message });
      }
    }

    const clearedSet = new Set(cleared);
    const reached = checkpoints.filter((cp) => clearedSet.has(cp.id)).map((cp) => cp.at);

    return {
      status: 'ok',
      sessionId: state.sessionId,
      learnerId: state.learnerId ?? null,
      unitId: state.unitId ?? null,
      contentId: state.mediaDispatch?.contentId ?? null,
      title,
      checkpoints,
      cleared,
      resumePosition: reached.length ? Math.max(...reached) : null,
      // Advisory: the frontend twin (`useCheckpointGate`) derives the same
      // number from `checkpoints` + `cleared`, which is what actually clamps
      // the seek bar. This is the server's own answer to the same question,
      // useful for logs and for a client that wants to cross-check itself.
      seekCeiling: seekCeilingFor(checkpoints, clearedSet),
      state: state.state ?? null,
      playing: state.state === 'media_dispatched',
    };
  }

  /**
   * The authored `checkpoints:` block as the screen may see it: `{id, at,
   * items}` where `items` holds ITEM BODIES rather than the bare ids the unit
   * authors.
   *
   * The bodies have to be here. The overlay renders `checkpoint.items`, and
   * nothing else in this feature ever sends a prompt to a browser —
   * `RecordCheckpointAnswer` only grades, and returns no question — so a
   * snapshot carrying ids alone leaves every gate showing a fault card over a
   * paused picture.
   *
   * An id that cannot be projected — the bank is gone, the item was deleted,
   * its type has no projector — stays a BARE STRING in the list rather than
   * being dropped. Dropping it would shorten the list the overlay walks while
   * `RecordCheckpointAnswer` still requires every authored item answered
   * before the gate opens, so the child would run out of questions with the
   * video still stopped. A string is what the overlay's fault card is for.
   */
  #publicCheckpoints(unit, sessionId) {
    if (!Array.isArray(unit?.checkpoints)) return [];
    const bank = this.#bank(unit, sessionId);
    const byId = new Map((bank?.items ?? []).map((item) => [item?.id, item]));
    return unit.checkpoints.map(({ id, at, items }) => ({
      id,
      at,
      items: (Array.isArray(items) ? items : []).map((itemId) => publicItem(byId.get(itemId)) ?? itemId),
    }));
  }

  /**
   * The unit's bank, or null. Never throws: `getBank` throws on an unknown id
   * (the `SchoolService` contract `RecordCheckpointAnswer` also guards), and a
   * catalog problem must not be the reason a lesson will not open.
   */
  #bank(unit, sessionId) {
    if (!unit?.bank || !this.#bankReader) {
      if (unit?.checkpoints?.length) {
        this.#logger.warn?.('school.lesson.snapshot.no-bank', { sessionId, unitId: unit?.unitId ?? null, bank: unit?.bank ?? null });
      }
      return null;
    }
    try {
      return this.#bankReader.getBank(unit.bank);
    } catch (err) {
      this.#logger.error?.('school.lesson.snapshot.bank-unreadable', { sessionId, bank: unit.bank, error: err.message });
      return null;
    }
  }
}

export default ReadLessonSnapshot;
