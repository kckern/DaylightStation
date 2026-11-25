/**
 * heldRecoveryModel — what the Player's held card says and offers.
 *
 * A held video (recovery exhausted, or a source the server is still repairing)
 * used to show one fixed set of pills — Retry, Quality…, Skip — on every
 * surface. That offered a Skip that did nothing on the last item, a Close the
 * host already had, buttons a numpad cannot reach and a desktop form on a TV.
 *
 * The rule here: offer an action only when the surface can perform it, the
 * host does not already provide it, and it means something right now.
 *
 * - input: 'touch' | 'pointer' | 'remote' | 'numpad' | 'none'
 *   (PlaybackSurfaceContext; screens declare it, apps provide it).
 * - Close/Exit is never offered: every host owns its exit (✕, Back, key 4).
 * - Skip only with a next item in the Player's own queue, and it names it.
 * - Quality: one "Lower quality" rung below what is playing, or the host's own
 *   dialog where one exists (MediaApp). Never the desktop form.
 * - numpad: no buttons (the office keypad has no OK or arrows) — the card
 *   names the keys that act. none: no buttons — the card states the automatic
 *   plan the Player runs.
 *
 * Pure: the Player and the card read it; tests pin it.
 */

export const AUTO_RETRY_LIMIT = 3;
export const AUTO_RETRY_DELAY_SEC = 20;

const QUALITY_RUNGS = [720, 480];

/** The next rung below the playing picture height, as a maxResolution string. */
export function lowerQualityStep(videoHeight) {
  const h = Number(videoHeight);
  if (!Number.isFinite(h) || h <= 0) return null;
  const rung = QUALITY_RUNGS.find((r) => r < h);
  return rung ? String(rung) : null;
}

const BUTTON_INPUTS = new Set(['touch', 'pointer', 'remote']);

/**
 * @param {object} p
 * @param {'touch'|'pointer'|'remote'|'numpad'|'none'} p.input
 * @param {'exhausted'|'source-wait'} p.state
 * @param {string|null} [p.positionLabel]  e.g. '1:13'
 * @param {string|null} [p.sourceNotice]   the source-wait message
 * @param {{title?: string}|null} [p.next] the next item in the Player's queue
 * @param {number} [p.retryAfterMs]        retry cooldown remaining
 * @param {number|null} [p.videoHeight]    playing picture height
 * @param {boolean} [p.canChangeQuality]   the source accepts quality limits
 * @param {boolean} [p.qualityHost]        the host has its own quality dialog
 * @param {number} [p.autoAttempt]         automatic retries made (input none)
 * @param {number|null} [p.autoRetryInSec] seconds to the next automatic retry
 * @returns {{ headline: string, detail: string|null, actions: object[], focusable: boolean,
 *   keyHint: string|null, plan: string|null }}
 */
export function heldRecoveryModel({
  input = 'pointer', state = 'exhausted', positionLabel = null, sourceNotice = null,
  next = null, retryAfterMs = 0, videoHeight = null, canChangeQuality = false,
  qualityHost = false, autoAttempt = 0, autoRetryInSec = null,
}) {
  const sourceWait = state === 'source-wait';
  const nextTitle = next ? (next.title || 'the next video') : null;
  const skipLabel = nextTitle ? `Skip to ${nextTitle}` : null;

  // Everything this moment could offer, in order.
  const offers = [];
  if (!sourceWait) {
    const waitSec = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : 0;
    offers.push({ id: 'retry', label: waitSec ? `Try again in ${waitSec}s` : 'Try again', disabled: waitSec > 0 });
  }
  if (skipLabel) offers.push({ id: 'skip', label: skipLabel });
  if (!sourceWait && canChangeQuality) {
    if (qualityHost) offers.push({ id: 'quality', label: 'Quality…' });
    else {
      const resolution = lowerQualityStep(videoHeight);
      if (resolution) offers.push({ id: 'lower-quality', label: `Lower quality (${resolution}p)`, resolution });
    }
  }

  let headline = sourceWait ? 'Waiting for the video' : 'The video stopped loading';
  const detail = sourceWait ? (sourceNotice || null) : (positionLabel ? `Stopped at ${positionLabel}` : null);
  let plan = null;
  let keyHint = null;
  let actions = [];

  if (BUTTON_INPUTS.has(input)) {
    actions = offers;
    // A key line only when there is a choice to make: one focused button and
    // OK needs no caption that repeats its own label.
    if (input === 'remote' && actions.length > 1) keyHint = '▲ ▼  Choose    OK  Select';
  } else if (input === 'numpad') {
    // The keypad's own keys: play/pause retries a held video, next skips.
    const parts = [];
    if (!sourceWait) {
      const waitSec = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : 0;
      parts.push(waitSec ? `Play/Pause  Try again in ${waitSec}s` : 'Play/Pause  Try again');
    }
    if (skipLabel) parts.push(`Next  ${skipLabel}`);
    keyHint = parts.length ? parts.join('    ') : null;
  } else if (!sourceWait) {
    // No input: the Player retries on its own, then moves on or stops.
    if (autoAttempt < AUTO_RETRY_LIMIT) {
      plan = `Trying again in ${autoRetryInSec ?? AUTO_RETRY_DELAY_SEC}s (attempt ${autoAttempt + 1} of ${AUTO_RETRY_LIMIT})`;
    } else if (nextTitle) {
      plan = `Playing ${nextTitle} next`;
    } else {
      headline = "This video couldn't be loaded";
    }
  }

  return {
    headline,
    detail,
    actions,
    focusable: input === 'remote' && actions.length > 0,
    keyHint,
    plan,
  };
}
