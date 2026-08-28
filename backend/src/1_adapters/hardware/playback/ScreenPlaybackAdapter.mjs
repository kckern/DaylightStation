/**
 * ScreenPlaybackAdapter — the real playback target behind spec §8, for the
 * case where the "player" is a ROOM'S SCREEN rather than a headset slot.
 *
 * `VirtualPlaybackAdapter` stood in for this from the day the media leg was
 * written — composition read "real playback target; null until §8 lands". This
 * is §8, and `schoolLifecycle.mjs` now builds this class on the real branch.
 * The port shape is the double's, kept deliberately: `dispatch()`
 * returns a correlator record whose `dispatchId` the work session stores,
 * `getStatus()` answers `SlotStatus[]`, the port topic is still
 * `school-playback` and the event `type` is still `dispatched`. ONE thing is
 * widened — see SESSION ID below — and the double and `FakePlayback` were
 * changed in the same commit so the three cannot drift.
 *
 * ## What a dispatch to a screen actually IS
 *
 * Two steps, in this order and never the other:
 *
 *   1. **Wake.** Delegated whole to `WakeAndLoadService.execute(deviceId, query)`,
 *      exactly as `LivingroomTvSurface` delegates it. This adapter contains no
 *      device-control logic of its own — no HA call, no ADB, no FKB — because
 *      there is already one place that knows how to bring a dark TV up and it
 *      is not here.
 *   2. **Tell the room.** A `{ type: 'lesson.open', sessionId, learnerId }`
 *      frame on `lesson:{location}` — one topic per room, mirroring
 *      `reading:{location}` (`ReadingSessionService.readingTopic`) — so the
 *      already-mounted `school-lesson` widget opens the lesson in place.
 *
 * ## THE INVARIANT: a screen that is not coming on is never told
 *
 * Wake failure throws, and NOTHING is broadcast. That is not politeness; it is
 * the only outcome that leaves the child a way forward. `DispatchMedia` catches
 * a throwing `dispatch()`, appends a NON-ADVANCING `failed` event and says
 * "… did not answer. Scan your card to try again." — the session stays
 * `created`, so the next scan really does re-dispatch. A broadcast that escaped
 * a failed wake would let `media_dispatched` be recorded against a dark TV, and
 * the idempotency matrix would then answer every retry with "It is already
 * playing. Enjoy!" for the rest of the day.
 *
 * The same reasoning extends one step further, and this is the one thing here
 * the plan did not ask for. `WakeAndLoadService`'s final step is a CONTENT LOAD
 * (`device.loadContent(screenPath, query)`), which on the living-room Shield is
 * an unconditional FKB `loadURL` — i.e. a page load. The reading path avoids
 * `WakeAndLoadService` for exactly this reason (`app.mjs`'s `wakeScreen`:
 * "reloading the page would drop the very WebSocket that carried the
 * `session-open` this tap just produced"). Since we DO wake through it, the
 * screen's WebSocket is torn down and rebuilt in the middle of the dispatch, so
 * a `lesson.open` published the instant the wake returns is published into an
 * empty room. So: after the wake, wait (bounded) for at least one live
 * subscriber on the room's topic, and if none ever arrives, throw — for the
 * same reason as above, a failure the child can retry beats a silent success
 * nobody heard. A bus that cannot count subscribers simply skips the wait.
 *
 * ## SESSION ID — the one port widening
 *
 * The widget fetches its own snapshot (`GET /api/v1/school/lesson/:sessionId`),
 * so `lesson.open` MUST carry the session id, and `dispatch()`'s original
 * argument list had no place for one. It is added rather than derived: the
 * adapter cannot invent it, and the only caller — `DispatchMedia` — has it in
 * hand. It is REQUIRED, here and in the double, because a dispatch that cannot
 * name its session is a broadcast the screen can do nothing with, and a double
 * that tolerated its absence would let that ship green.
 *
 * ## `getStatus()` returns an EMPTY LIST, on purpose
 *
 * `SlotStatus` is a playback-hub slot projection — `bt_connected`, `volume`,
 * `playlist_pos`, `now_playing`. A room's TV has none of those readable from
 * here: this adapter holds one write-only seam (wake) and a bus, and asks the
 * screen nothing. Synthesising a slot per screen would be inventing state, and
 * `now_playing` in particular would report a lesson as playing for as long as
 * the process lived, including after the child walked out. Who is watching a
 * room is a question the house already answers elsewhere — `TVControlAdapter`'s
 * power sensor plus `ScreenContentTracker`, composed by
 * `LivingroomTvSurface.occupancy()`. The honest answer here is "this adapter
 * contributes no slots", and `[]` is a valid `SlotStatus[]`.
 *
 * Layer: ADAPTER (1_adapters/hardware/playback).
 *
 * @module adapters/hardware/playback
 */
import { randomUUID } from 'node:crypto';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const SOURCE = 'screen-playback';

/** Kept from the double so a Phase-F consumer reads one topic, not two. */
const DEFAULT_TOPIC = 'school-playback';

/** How long to give the screen's SPA to come back after the wake's page load. */
const DEFAULT_LISTENER_WAIT_MS = 20_000;
const DEFAULT_LISTENER_POLL_MS = 250;

/** One topic per room, so a screen hears its own lessons and nothing else. */
export const lessonTopic = (location) => `lesson:${location}`;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Normalise the configured screen targets.
 *
 * `device` defaults to `id` because the two are the same string for every
 * screen we have (`livingroom-tv` is both the school target and the
 * `devices.yml` id); `location` has NO default on purpose — see `#screenFor`.
 *
 * @param {Array} raw
 * @returns {Array<{id: string, deviceId: string, location: string|null}>}
 */
export function normaliseScreens(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s === 'object' && isNonEmptyString(s.id))
    .map((s) => ({
      id: s.id.trim(),
      deviceId: isNonEmptyString(s.device) ? s.device.trim()
        : (isNonEmptyString(s.deviceId) ? s.deviceId.trim() : s.id.trim()),
      location: isNonEmptyString(s.location) ? s.location.trim() : null,
    }));
}

export class ScreenPlaybackAdapter {
  #eventBus; #wakeAndLoad; #screens; #topic; #wakeQuery;
  #listenerWaitMs; #listenerPollMs; #sleep; #logger; #clock; #mintId;

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus - IEventBus; `broadcast` is required,
   *   `getTopicSubscriberCount` is used when present
   * @param {{execute: Function}} deps.wakeAndLoad - WakeAndLoadService
   * @param {Array} [deps.screens=[]] - configured screen targets:
   *   `{ id, device?, location }` — `location` is what the topic is built from
   * @param {string} [deps.topic='school-playback'] - the port's own topic
   * @param {Object} [deps.wakeQuery] - extra query for the wake stack (volume, …)
   * @param {number} [deps.listenerWaitMs=20000]
   * @param {number} [deps.listenerPollMs=250]
   * @param {(ms: number) => Promise<void>} [deps.sleep]
   * @param {Object} [deps.logger=console]
   * @param {() => Date} [deps.clock]
   * @param {() => string} [deps.mintId]
   */
  constructor({
    eventBus, wakeAndLoad, screens = [], topic = DEFAULT_TOPIC, wakeQuery = {},
    listenerWaitMs = DEFAULT_LISTENER_WAIT_MS, listenerPollMs = DEFAULT_LISTENER_POLL_MS,
    sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    logger = console, clock = () => new Date(), mintId = () => `dsp_${randomUUID()}`,
  } = {}) {
    if (!eventBus || typeof eventBus.broadcast !== 'function') {
      throw new InfrastructureError('ScreenPlaybackAdapter requires eventBus.broadcast', {
        code: 'MISSING_DEPENDENCY', dependency: 'eventBus',
      });
    }
    if (!wakeAndLoad || typeof wakeAndLoad.execute !== 'function') {
      throw new InfrastructureError('ScreenPlaybackAdapter requires wakeAndLoad.execute', {
        code: 'MISSING_DEPENDENCY', dependency: 'wakeAndLoad',
      });
    }
    this.#eventBus = eventBus;
    this.#wakeAndLoad = wakeAndLoad;
    this.#screens = normaliseScreens(screens);
    this.#topic = topic;
    this.#wakeQuery = { ...wakeQuery };
    this.#listenerWaitMs = listenerWaitMs;
    this.#listenerPollMs = listenerPollMs;
    this.#sleep = sleep;
    this.#logger = logger;
    this.#clock = clock;
    this.#mintId = mintId;
  }

  /** The screen targets this adapter can actually reach. */
  targets() { return this.#screens.map((s) => ({ ...s })); }

  /**
   * Wake a room's screen and open a lesson on it.
   *
   * @param {Object} args
   * @param {string} args.target - a configured screen target id
   * @param {string} args.contentId - the manifest locator (`source:id`; a bare
   *   id is a Plex id, the hub convention the double documents)
   * @param {string} args.sessionId - the work session the widget will fetch
   * @param {string} [args.learnerId]
   * @param {number} [args.durationSec=0]
   * @returns {Promise<Object>} dispatch record; `dispatchId` is the correlator
   * @throws {InfrastructureError} on a bad argument, an unreachable screen, or
   *   a room that never came back to listen — every one of them BEFORE any
   *   broadcast
   */
  async dispatch({ target, contentId, sessionId, learnerId = null, durationSec = 0 } = {}) {
    // Every refusal below happens before the TV is touched: a dispatch we know
    // is malformed must not leave a room lit up with nothing on it.
    if (!isNonEmptyString(target)) {
      throw new InfrastructureError('dispatch requires a target', { code: 'INVALID_DISPATCH', field: 'target', value: target });
    }
    if (!isNonEmptyString(contentId)) {
      throw new InfrastructureError('dispatch requires a contentId', { code: 'INVALID_DISPATCH', field: 'contentId', value: contentId });
    }
    if (!isNonEmptyString(sessionId)) {
      throw new InfrastructureError('dispatch requires a sessionId — the screen fetches the lesson by it', {
        code: 'INVALID_DISPATCH', field: 'sessionId', value: sessionId,
      });
    }
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) {
      throw new InfrastructureError('dispatch requires a non-negative durationSec', { code: 'INVALID_DISPATCH', field: 'durationSec', value: durationSec });
    }

    const screen = this.#screenFor(target.trim());
    const topic = lessonTopic(screen.location);

    await this.#wake(screen, sessionId);
    await this.#awaitListener(topic, screen, sessionId);

    const record = {
      dispatchId: this.#mintId(),
      target: screen.id,
      contentId,
      learnerId,
      sessionId,
      durationSec,
      positionSec: 0,
      status: 'playing',
      startedAt: this.#clock().toISOString(),
      endedAt: null,
    };

    // The frame the widget acts on. Deliberately thin — ids only, no lesson
    // content: the widget fetches its own snapshot, so a checkpoint's answers
    // never travel over a topic anybody in the house can subscribe to.
    this.#eventBus.broadcast(topic, {
      type: 'lesson.open',
      sessionId,
      learnerId,
      dispatchId: record.dispatchId,
      target: record.target,
      ts: record.startedAt,
    });

    // And the port's own announcement, in the double's shape. WRAPPED, unlike
    // the one above: the room has already been told, so a fault on this
    // observability topic must not throw — `DispatchMedia` would file a
    // `failed`, the child would scan again, and the lesson would open twice.
    try {
      this.#eventBus.broadcast(this.#topic, {
        source: SOURCE,
        type: 'dispatched',
        dispatchId: record.dispatchId,
        target: record.target,
        contentId: record.contentId,
        learnerId: record.learnerId,
        sessionId: record.sessionId,
        location: screen.location,
        seconds: 0,
        durationSec: record.durationSec,
        percent: 0,
        ts: record.startedAt,
      });
    } catch (err) {
      this.#logger.warn?.('screen-playback.announce-failed', {
        dispatchId: record.dispatchId, topic: this.#topic, error: err?.message ?? String(err),
      });
    }

    this.#logger.info?.('screen-playback.dispatched', {
      dispatchId: record.dispatchId, target: record.target, location: screen.location,
      contentId, learnerId, sessionId,
    });
    return { ...record };
  }

  /**
   * @returns {import('#domains/playback-hub/value-objects/SlotStatus.mjs').SlotStatus[]}
   *   always empty — see the header. A screen is not a hub slot, and this
   *   adapter observes nothing it could honestly report.
   */
  getStatus() { return []; }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * A target with no `location` is a configuration bug that would otherwise
   * fail invisibly: the wake would run, the TV would come on, and the frame
   * would go to a topic no screen subscribes to. Refuse it up front, where the
   * message names the fix.
   */
  #screenFor(target) {
    const found = this.#screens.find((s) => s.id === target);
    if (!found) {
      throw new InfrastructureError(`no screen target configured for ${target}`, {
        code: 'UNKNOWN_TARGET', target, known: this.#screens.map((s) => s.id),
      });
    }
    if (!found.location) {
      throw new InfrastructureError(
        `screen target ${target} has no location — add \`location:\` to its media.targets entry`,
        { code: 'TARGET_NOT_ADDRESSABLE', target },
      );
    }
    return found;
  }

  async #wake(screen, sessionId) {
    let result;
    try {
      result = await this.#wakeAndLoad.execute(screen.deviceId, { ...this.#wakeQuery });
    } catch (err) {
      this.#logger.warn?.('screen-playback.wake-threw', {
        target: screen.id, deviceId: screen.deviceId, sessionId, error: err?.message ?? String(err),
      });
      throw new InfrastructureError(`${screen.id} did not wake: ${err?.message ?? String(err)}`, {
        code: 'WAKE_FAILED', target: screen.id, deviceId: screen.deviceId,
      });
    }
    if (!result || result.ok !== true) {
      const reason = result?.error || 'the wake reported no result';
      this.#logger.warn?.('screen-playback.wake-failed', {
        target: screen.id, deviceId: screen.deviceId, sessionId,
        failedStep: result?.failedStep ?? null, error: reason,
      });
      throw new InfrastructureError(`${screen.id} did not wake: ${reason}`, {
        code: 'WAKE_FAILED', target: screen.id, deviceId: screen.deviceId,
        failedStep: result?.failedStep ?? null,
      });
    }
  }

  /**
   * The wake's last step reloads the screen's page, which drops its WebSocket.
   * Publishing before it is back is publishing to nobody, and the session would
   * still be recorded as dispatched. So wait for the room to be listening —
   * and if it never is, fail in a way the child can retry.
   *
   * `getTopicSubscriberCount` counts WILDCARD subscribers too, and the screen
   * framework's predicate-filtered hooks make a screen client subscribe `'*'`
   * (`websocketService._syncSubscriptions`). So in practice this waits for "the
   * page is back and its socket has re-synced", not "the lesson widget is
   * mounted". That is the signal the reload actually destroys, and the widget
   * mounts with the page — so it is the right gate, and it is deliberately not
   * claimed to be stronger than it is.
   */
  async #awaitListener(topic, screen, sessionId) {
    if (typeof this.#eventBus.getTopicSubscriberCount !== 'function') return;
    const attempts = Math.max(1, Math.ceil(this.#listenerWaitMs / Math.max(1, this.#listenerPollMs)));
    for (let i = 0; i < attempts; i += 1) {
      let count = 0;
      try {
        count = this.#eventBus.getTopicSubscriberCount(topic);
      } catch {
        // A bus that cannot answer is not a screen that is absent.
        return;
      }
      if (count > 0) return;
      await this.#sleep(this.#listenerPollMs);
    }
    this.#logger.warn?.('screen-playback.no-listener', {
      target: screen.id, location: screen.location, topic, sessionId, waitedMs: this.#listenerWaitMs,
    });
    throw new InfrastructureError(
      `${screen.id} woke but nothing is listening on ${topic}`,
      { code: 'NO_SCREEN_LISTENER', target: screen.id, topic },
    );
  }
}

export default ScreenPlaybackAdapter;
