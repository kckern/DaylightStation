// Screen session controls — the P1 "screen player capabilities" contract.
//
//   - `session` command params (sleep timer, Put it back, countdown control)
//   - `SessionSnapshot.controls`: what a screen publishes about those controls
//     (Add only, end-of-queue mode, stop after current, sleep timer, the
//     next-episode countdown, end-of-queue status and screen notes)
//   - `DeviceStartStatus`: per-device start progress / last failure, published
//     on `device-start:<deviceId>` so every house-view row can show it
//     (RQ-HOUSE-04), not only the device that started it.
//
// See docs/reference/media/media-app-technical.md §6.2.6, §6.6 and §9.14–9.15.
// This module must not import shapes.mjs (shapes imports it).
import {
  PLAYER_FEATURE_ACTIONS, validatePlayerFeatureParams, validatePlayerFeatureControls,
} from './playerFeatures.mjs';

export const SESSION_ACTIONS = Object.freeze([
  'sleep-timer', 'cancel-sleep-timer', 'resume-sleep', 'put-back', 'cancel-countdown', 'start-next-now',
  // Player features (P2): tracks, Show briefly, music behind — playerFeatures.mjs.
  ...PLAYER_FEATURE_ACTIONS,
]);
export const END_OF_QUEUE_MODES = Object.freeze(['stop', 'repeat', 'similar']);
export const SLEEP_TIMER_AT_END = Object.freeze(['item']);
export const SLEEP_TIMER_MAX_MINUTES = 720;
export const SCREEN_NOTE_KINDS = Object.freeze(['paused', 'stopped', 'replaced', 'moved', 'brief']);
export const END_OF_QUEUE_STATUS_CODES = Object.freeze(['NOTHING_SIMILAR', 'SIMILAR_ADDED', 'STOPPED_AFTER_CURRENT']);
// `queued`: the screen took the content as a queue add (Add only) — reached, not started.
export const START_PHASES = Object.freeze(['starting', 'delivered', 'queued', 'started', 'failed']);
/** Longest origin `name` a screen will show (contract cap). */
export const ORIGIN_NAME_MAX_LENGTH = 80;

/** Seconds of the visible next-episode countdown (requirements §NF timing table). */
export const NEXT_EPISODE_COUNTDOWN_SECONDS = 10;
/** How long a screen keeps the pre-change snapshot that Put it back restores. */
export const PUT_BACK_WINDOW_MS = 10_000;
/** Fade-out length before a sleep timer stops playback. */
export const SLEEP_FADE_MS = 10_000;
/** "Keep similar things playing" skips anything played within this window. */
export const SIMILAR_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const isSessionAction = (v) => SESSION_ACTIONS.includes(v);
export const isEndOfQueueMode = (v) => END_OF_QUEUE_MODES.includes(v);

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const result = (errors) => ({ valid: errors.length === 0, errors });

/**
 * Validate the params of a `command: "session"` envelope.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSessionActionParams(params) {
  const errors = [];
  const p = params ?? {};
  if (!isSessionAction(p.action)) return result(['action: required session action']);
  const feature = validatePlayerFeatureParams(p);
  if (feature) return feature;
  if (p.action === 'sleep-timer') {
    const hasMinutes = p.minutes !== undefined;
    const hasAtEnd = p.atEnd !== undefined;
    if (hasMinutes === hasAtEnd) errors.push('sleep-timer: exactly one of minutes | atEnd');
    if (hasMinutes && !(isNum(p.minutes) && p.minutes > 0 && p.minutes <= SLEEP_TIMER_MAX_MINUTES)) {
      errors.push(`minutes: must be a number in (0, ${SLEEP_TIMER_MAX_MINUTES}]`);
    }
    if (hasAtEnd && !SLEEP_TIMER_AT_END.includes(p.atEnd)) errors.push(`atEnd: must be one of ${SLEEP_TIMER_AT_END.join('|')}`);
  }
  if (p.action === 'put-back' && p.noteId !== undefined && !isStr(p.noteId)) errors.push('noteId: must be string when present');
  return result(errors);
}

function validateOriginLike(origin, prefix, errors) {
  if (origin === null || origin === undefined) return;
  if (!isObj(origin)) { errors.push(`${prefix}: must be object or null`); return; }
  if (!['device', 'routine', 'unknown'].includes(origin.kind)) errors.push(`${prefix}.kind: must be device|routine|unknown`);
}

function validatePosition(value, prefix, errors) {
  if (value === null || value === undefined) return;
  if (!isObj(value)) { errors.push(`${prefix}: must be object or null`); return; }
  if (value.contentId != null && !isStr(value.contentId)) errors.push(`${prefix}.contentId: string`);
  if (value.queueItemId != null && !isStr(value.queueItemId)) errors.push(`${prefix}.queueItemId: string`);
  if (!isNum(value.position) || value.position < 0) errors.push(`${prefix}.position: non-negative number`);
}

/**
 * Validate `SessionSnapshot.controls` (§9.14). Every field is required on a
 * published block so consumers never have to guess a default.
 */
export function validateSessionControls(controls) {
  const errors = [];
  if (!isObj(controls)) return result(['controls: required object']);
  if (!isBool(controls.addOnly)) errors.push('controls.addOnly: boolean');
  if (!isEndOfQueueMode(controls.endOfQueue)) errors.push(`controls.endOfQueue: ${END_OF_QUEUE_MODES.join('|')}`);
  if (!isBool(controls.stopAfterCurrent)) errors.push('controls.stopAfterCurrent: boolean');

  const timer = controls.sleepTimer;
  if (timer !== null) {
    if (!isObj(timer)) errors.push('controls.sleepTimer: object or null');
    else {
      if (timer.mode !== 'minutes' && timer.mode !== 'atEnd') errors.push('controls.sleepTimer.mode: minutes|atEnd');
      if (timer.mode === 'minutes' && !(isNum(timer.remainingSeconds) && timer.remainingSeconds >= 0)) {
        errors.push('controls.sleepTimer.remainingSeconds: non-negative number for minutes mode');
      }
      if (timer.mode === 'atEnd' && !SLEEP_TIMER_AT_END.includes(timer.atEnd)) errors.push('controls.sleepTimer.atEnd: item');
      if (!isStr(timer.setAt)) errors.push('controls.sleepTimer.setAt: ISO string');
      if (timer.fading !== undefined && !isBool(timer.fading)) errors.push('controls.sleepTimer.fading: boolean');
      validatePosition(timer.setPosition, 'controls.sleepTimer.setPosition', errors);
    }
  }
  if (controls.sleepResume !== null) {
    validatePosition(controls.sleepResume, 'controls.sleepResume', errors);
    if (isObj(controls.sleepResume) && !isStr(controls.sleepResume.stoppedAt)) errors.push('controls.sleepResume.stoppedAt: ISO string');
  }
  const countdown = controls.countdown;
  if (countdown !== null) {
    if (!isObj(countdown)) errors.push('controls.countdown: object or null');
    else {
      if (!isNum(countdown.seconds) || countdown.seconds <= 0) errors.push('controls.countdown.seconds: positive number');
      if (!isNum(countdown.remainingSeconds) || countdown.remainingSeconds < 0) errors.push('controls.countdown.remainingSeconds: non-negative number');
      if (!isObj(countdown.next) || !isStr(countdown.next.contentId)) errors.push('controls.countdown.next.contentId: required');
    }
  }
  const status = controls.endOfQueueStatus;
  if (status !== null) {
    if (!isObj(status) || !END_OF_QUEUE_STATUS_CODES.includes(status.code)) {
      errors.push(`controls.endOfQueueStatus.code: ${END_OF_QUEUE_STATUS_CODES.join('|')}`);
    } else if (!isStr(status.at)) errors.push('controls.endOfQueueStatus.at: ISO string');
  }
  if (!Array.isArray(controls.notes)) errors.push('controls.notes: array');
  else {
    controls.notes.forEach((note, i) => {
      const prefix = `controls.notes[${i}]`;
      if (!isObj(note)) { errors.push(`${prefix}: object`); return; }
      if (!isStr(note.id)) errors.push(`${prefix}.id: required`);
      if (!SCREEN_NOTE_KINDS.includes(note.kind)) errors.push(`${prefix}.kind: ${SCREEN_NOTE_KINDS.join('|')}`);
      if (!isStr(note.label)) errors.push(`${prefix}.label: required`);
      if (!Number.isInteger(note.count) || note.count < 1) errors.push(`${prefix}.count: positive integer`);
      if (!isStr(note.at)) errors.push(`${prefix}.at: ISO string`);
      validateOriginLike(note.origin, `${prefix}.origin`, errors);
      if (note.putBack !== null && note.putBack !== undefined
        && !(isObj(note.putBack) && isStr(note.putBack.availableUntil))) errors.push(`${prefix}.putBack: { availableUntil } or null`);
    });
  }
  // Optional player-feature blocks (tracks, brief, musicBehind) — absent or null when idle.
  errors.push(...validatePlayerFeatureControls(controls).errors);
  return result(errors);
}

export function createDefaultSessionControls() {
  return {
    addOnly: false,
    endOfQueue: 'stop',
    stopAfterCurrent: false,
    sleepTimer: null,
    sleepResume: null,
    countdown: null,
    endOfQueueStatus: null,
    notes: [],
  };
}

// --- Device start status (RQ-HOUSE-04) ------------------------------------

/**
 * Build the `device-start:<deviceId>` payload (§9.15).
 */
export function buildDeviceStartStatus({
  deviceId, dispatchId = null, phase, step = null, stepStatus = null, error = null,
  contentId = null, lastFailure = null, updatedAt, stale = false,
} = {}) {
  return {
    topic: 'device-start',
    deviceId,
    dispatchId,
    phase,
    step,
    stepStatus,
    error,
    contentId,
    lastFailure,
    stale,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}

export function validateDeviceStartStatus(msg) {
  const errors = [];
  if (!isObj(msg)) return result(['DeviceStartStatus: not an object']);
  if (msg.topic !== undefined && msg.topic !== 'device-start' && !String(msg.topic).startsWith('device-start:')) {
    errors.push('topic: must be device-start');
  }
  if (!isStr(msg.deviceId)) errors.push('deviceId: required string');
  if (!START_PHASES.includes(msg.phase)) errors.push(`phase: ${START_PHASES.join('|')}`);
  if (msg.phase === 'failed' && !isStr(msg.error)) errors.push('error: required for failed phase');
  if (msg.lastFailure !== null && msg.lastFailure !== undefined) {
    const f = msg.lastFailure;
    if (!isObj(f) || !isStr(f.error) || !isStr(f.at)) errors.push('lastFailure: { dispatchId, step, error, at } or null');
  }
  if (!isStr(msg.updatedAt)) errors.push('updatedAt: ISO string');
  if (msg.stale !== undefined && !isBool(msg.stale)) errors.push('stale: boolean');
  return result(errors);
}
