import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import Icon from '../../../home/icons/Icon.jsx';
import VoiceBand from './VoiceBand.jsx';
import useVoiceCapture from './useVoiceCapture.js';
import {
  createVoiceMeter, meterLevel, meterSummary, judgeTake,
} from '../../shared/speechFloor.js';
import useModelPauses from './useModelPauses.js';
import { snapCut } from './pauses.js';
import {
  emptyPieces, spanOf, canCut, addCut, setTake as setPieceTake, pieceVerdict, totalMs, allHeard,
  pieceSpans, spanMs, pieceCount, nextToSay, saidTakes, isPartial,
} from './pieces.js';
import { joinTake } from './joinTake.js';

/**
 * Recording — say it yourself (design §1), in chunks the learner chooses.
 *
 * 2026-09-23 owner: Space pauses to chunk; Tab never destroys; ← start over;
 * Backspace redo chunk; silence auto-stop.
 *
 * Space is the one forward key and never destroys anything:
 *
 *   Space ─▶ the sentence plays
 *   Space while it plays ─▶ pause HERE: that ends this chunk (snapped back to
 *        the model's nearest pause) ─▶ the ding ─▶ the mic is live
 *   Space while recording ─▶ stop; the chunk's take plays straight back
 *   Space in review ─▶ the sentence goes on FROM WHERE IT PAUSED ─▶ …the same loop
 *   the sentence plays to its end ─▶ ding ─▶ mic: that is the last chunk
 *   Space after the last chunk ─▶ the chunks are joined into one take ─▶ Keep
 *
 * Said in one go, that is simply a single chunk: Space, let it finish, ding,
 * mic, Space, Keep.
 *
 *   Tab        hear it again — the sentence, or the chunk's span; with a take,
 *              the span then the take. At a live mic it STOPS AND KEEPS the take
 *              and then plays span + take. Never throws anything away.
 *   Backspace  redo this chunk (its span, the ding, the mic); others are kept
 *   ←          start the whole sentence over: every chunk goes
 *   Enter      done — join what has been said, even mid-sentence
 *   →          pause here (the old key, kept as an alias of Space)
 *   a segment  of the chunk bar, tapped: redo that chunk
 *
 * After speech has been heard, AUTO_STOP_SILENT_MS of silence ends a take by
 * itself (`capture.auto-stop`, via `auto`). Leading silence never does; the
 * "is the microphone on?" warning still covers that.
 *
 * The ding is the cue to speak, so nothing on screen has to say "listen" or
 * "now". Playback is automatic: hearing yourself is the point of the rung. The
 * one moving thing is the voice band, the learner's own sound drawn as it
 * happens. The result is never scored (§7). A focused control keeps its own
 * keys. This rung only exists when a microphone was detected.
 */

/** The take is kept as this many mono samples — plenty for a band a few
 *  hundred bars wide, cheap enough to bin every resize. */
const TAKE_SAMPLES = 4096;
/**
 * How long joining the pieces may take before it is given up as failed. The
 * join is a few decodes and one encode of a sentence — well under a second on
 * the Portal — so ten seconds is only reached when a decode has hung, and a
 * learner left on "Joining" forever has no way on.
 */
const JOIN_TIMEOUT_MS = 10000;

/** `promise`, or a rejection with Error('timeout') after `ms`. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A control that owns its own keys — a focused button's Enter, a text field's
 *  Backspace. The rung's keys never fire over one of these. */
const ownsKeys = (el) => Boolean(el?.closest?.('button, input, select, textarea, a[href], [contenteditable="true"]'));

/** Decode a take to a small mono sample array for the band. Null when the
 *  browser cannot decode it — the band keeps its live picture instead. */
async function decodeTake(blob) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx || !blob?.arrayBuffer) return null;
  let ctx;
  try {
    ctx = new Ctx();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / TAKE_SAMPLES));
    const out = new Float32Array(Math.ceil(channel.length / step));
    for (let i = 0, j = 0; i < channel.length; i += step, j += 1) out[j] = channel[i];
    return out;
  } catch {
    return null;
  } finally {
    ctx?.close?.().catch?.(() => {});
  }
}

/** The rung's keys, as the log names them. */
const KEY_VIA = {
  ' ': 'key:Space',
  Enter: 'key:Enter',
  Tab: 'key:Tab',
  Backspace: 'key:Backspace',
  ArrowRight: 'key:ArrowRight',
  ArrowLeft: 'key:ArrowLeft',
};

/** Voiced/silent time of a take joined from pieces: the sum, or null when any
 *  piece could not be measured. Trailing silence is the last piece's. */
function sumVoice(takes) {
  const sum = (key) => (takes.every((t) => t?.[key] != null) ? takes.reduce((n, t) => n + t[key], 0) : null);
  return { voicedMs: sum('voicedMs'), silentMs: sum('silentMs'), endSilentMs: takes.at(-1)?.endSilentMs ?? null };
}

export default function RecordingRung({
  entry, audioUrl, cueUrl = null, onComplete, saving, onDisableMicrophone, showShortcuts = false,
  /** Told every phase change — the ladder's `rung.stalled` names the phase. */
  onPhase = null,
}) {
  // idle → prompting → recording → playback → review
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [take, setTake] = useState(null);
  const [silent, setSilent] = useState(false);
  /**
   * The FINISHED take's verdict — `null` | `'too-quiet'` | `'too-short'`.
   * Decided at stop, not by the live meter, and it GATES Keep.
   *
   * `silent` above needs SILENT_AFTER_MS (2s) of sub-floor level while
   * recording, so a take shorter than that could capture nothing and say
   * nothing: no warning could fire, playback was a second of silence that is
   * easy to miss, and `Keep` sat there as the primary button. A child could
   * bank an empty recording having never been told it was empty — and, on
   * 2026-09-11, did, twice, accepting one of them a second after it stopped.
   *
   * So this is not advice. A take that clears neither floor cannot be kept, and
   * the only way on is to record again.
   */
  const [takeVerdict, setTakeVerdict] = useState(null);
  /**
   * Consecutive refusals. A gate with no way through is a trap, and the mic
   * really can be dead — so after three the ladder's own escape hatch appears.
   * It is deliberately the DEVICE-level one ("skip recording on this device"),
   * not a per-sentence skip: a broken panel stops asking, while a child having
   * a hard time with one sentence still has to say it.
   */
  const [refusals, setRefusals] = useState(0);
  const blobRef = useRef(null);
  const takeUrlRef = useRef(null);
  const playbackRef = useRef(null);
  const unbindPlaybackRef = useRef(null);
  /** The live level meter for the take in progress (`speechFloor.js`): the
   *  silent warning, the too-quiet verdict, and the voiced/silent split. */
  const silenceRef = useRef(createVoiceMeter(0));
  const phaseRef = useRef(phase);
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  useEffect(() => { phaseRef.current = phase; onPhaseRef.current?.(phase); }, [phase]);

  /**
   * OBSERVABILITY (2026-09-23). A stuck sitting has to be explainable from the
   * capture lines alone — a live test of seq 16 had three Tab restarts in 5s
   * and a 19s gap before a join, and the log could not say which key did what
   * or what filled the gap. So every capture line carries:
   *
   *  - `via`: the key or touch that drove it (`key:Space`, `key:Tab`, …,
   *    `touch`), or `auto` when the rung did it by itself (the mic opening
   *    after the ding, a playback ending). Set ONCE, in `dispatch`, which every
   *    key and every tile goes through — never guessed at a call site.
   *  - `phase`: the rung's phase BEFORE the action.
   *
   * `intentRef` holds the gesture only while it is being dispatched. A stop is
   * the exception: the recorder hands the take back later (asynchronously on a
   * real MediaRecorder), so the gesture that asked for it is parked in
   * `stopIntentRef` until the take arrives.
   */
  const intentRef = useRef(null);
  const stopIntentRef = useRef(null);
  const log = useCallback((detail, data = {}, intent = intentRef.current) => {
    languageLog.capture(detail, {
      seq: entry.seq, ...data, via: intent?.via ?? 'auto', phase: intent?.phase ?? phaseRef.current,
    });
  }, [entry.seq]);

  /**
   * TIME ON A REVIEW. From the moment a take (or piece) is ready to judge until
   * the learner does something about it — `capture.review-idle` — so a gap
   * before a Next or a Keep reads as sitting, not as a slow device. `ms` is the
   * idle time only: a compare or a listen started from the review is its own
   * `capture.playback`, and pauses the clock. `reviewMs` is the wall time.
   */
  const reviewRef = useRef(null);
  const toReview = useCallback(() => {
    if (!reviewRef.current) {
      const now = Date.now();
      reviewRef.current = { since: now, idleMs: 0, idleSince: now };
    }
    setPhase('review');
  }, []);
  useEffect(() => { if (phase !== 'review') reviewRef.current = null; }, [phase]);
  const pauseReviewClock = () => {
    const r = reviewRef.current;
    if (r?.idleSince != null) { r.idleMs += Date.now() - r.idleSince; r.idleSince = null; }
  };
  const resumeReviewClock = () => {
    const r = reviewRef.current;
    if (r && r.idleSince == null) r.idleSince = Date.now();
  };

  /** Every key and tile goes through here — the one place `via` is decided. */
  const dispatch = useCallback((via, action) => {
    const intent = { via, phase: phaseRef.current };
    const r = reviewRef.current;
    if (intent.phase === 'review' && r) {
      const now = Date.now();
      const idle = r.idleMs + (r.idleSince != null ? now - r.idleSince : 0);
      languageLog.capture('review-idle', {
        seq: entry.seq,
        ...(pieceRef.current != null ? { piece: pieceRef.current } : {}),
        ms: idle,
        reviewMs: now - r.since,
        via,
        phase: intent.phase,
      });
      reviewRef.current = { since: now, idleMs: 0, idleSince: r.idleSince != null ? now : null };
    }
    intentRef.current = intent;
    try {
      action();
    } finally {
      intentRef.current = null;
    }
  }, [entry.seq]);
  const onTap = (action) => () => dispatch('touch', action);

  /**
   * PLAYBACK, one line per thing heard: `capture.playback {what, ms, outcome}`
   * — the sentence (or a line of it), a piece's span of the model, the take,
   * or a compare — and whether it `ended`, was `stopped`, or was `blocked`.
   * Three players, one open record each; opening a new one closes the old as
   * stopped, so nothing is left dangling. The ding alone is not logged.
   */
  const playsRef = useRef({ prompt: null, listen: null, take: null });
  const openPlay = useCallback((slot, what, extra = {}) => {
    const open = playsRef.current[slot];
    if (open) {
      languageLog.capture('playback', { seq: entry.seq, ...open.extra, what: open.what, ms: Date.now() - open.at, outcome: 'stopped', via: 'auto', phase: phaseRef.current });
    }
    playsRef.current[slot] = { what, extra, at: Date.now() };
    if (slot === 'listen') pauseReviewClock();
  }, [entry.seq]);
  const closePlay = useCallback((slot, outcome) => {
    const open = playsRef.current[slot];
    if (!open) return;
    playsRef.current[slot] = null;
    languageLog.capture('playback', {
      seq: entry.seq, ...open.extra, what: open.what, ms: Date.now() - open.at, outcome,
      via: intentRef.current?.via ?? 'auto', phase: intentRef.current?.phase ?? phaseRef.current,
    });
    if (slot === 'listen') resumeReviewClock();
  }, [entry.seq]);
  const rootRef = useRef(null);
  // The sentence being said, and its meaning. The meaning is shown for
  // reinforcement and can be heard on request; it is never played on its own.
  const targetLang = entry.prompt?.[0]?.language;
  const sourceLang = Object.keys(entry.text || {}).find((language) => language !== targetLang) ?? null;

  /**
   * RECORDING IN PIECES (2026-09-22). `piece` is the index of the piece in
   * hand, or null for an ordinary one-go take. The pieces themselves live in a
   * ref (`pieces.js` shape) because every handler reads them at key-press time.
   *
   * `pieceRef` IS WRITTEN WHEREVER `piece` IS SET, synchronously, and never
   * mirrored by an effect: the ding can end and a take arrive before an effect
   * runs, and a late mirror would overwrite a newer write with an older piece.
   */
  const [piece, setPiece] = useState(null);
  const pieceRef = useRef(null);
  const piecesRef = useRef(emptyPieces());
  const pieceUrlRef = useRef(null);
  /** The model's length, read at the cut — where the last piece's span ends. */
  const sentenceMsRef = useRef(null);
  /**
   * What happens when the take now being recorded arrives, instead of the
   * plain playback: `'compare'` (Tab stopped it — the learner wanted to HEAR
   * it again, so they hear the model, then the take they just made, and keep
   * it) or `'finish'` (Enter stopped it — join now). Null otherwise.
   */
  const afterTakeRef = useRef(null);
  /** The helpers a take hands on to, defined further down; read at arrival. */
  const routeRef = useRef({});
  /** Set when a join failed: this sentence is said in one go from then on. */
  const noPiecesRef = useRef(false);
  /** The kept take was joined from pieces, so "again" starts the sentence over. */
  const joinedRef = useRef(false);
  /** The join in flight. A join that finishes after the learner has left, or
   *  started the sentence over, must not land a take on the new state. */
  const joinRef = useRef(null);
  /**
   * The clip the prompting player is sounding now, or null. The Pause tile
   * follows THIS, not `phase`: the ding after the sentence, a retake's ding
   * and a redo of a bounded piece are all "prompting" too, and a Pause tile
   * there would be a control that does nothing.
   */
  const [sounding, setSounding] = useState(null);
  /** The last join failed. Its own notice rather than `error`, because the
   *  error notice offers to switch the microphone off, and the mic is fine. */
  const [joinFailed, setJoinFailed] = useState(false);
  const modelUrl = targetLang ? audioUrl(entry.seq, targetLang) : null;
  /**
   * The model whose pauses are wanted, set by the first start of a sentence —
   * see `useModelPauses`. Keyed by URL rather than a boolean reset on arrival:
   * a boolean still true for the render that brings the NEXT sentence would
   * decode that sentence before any effect could turn it off.
   */
  const [pausesFor, setPausesFor] = useState(null);
  const pauses = useModelPauses(modelUrl, pausesFor === modelUrl);

  const stopPlayback = useCallback(() => {
    closePlay('take', 'stopped');
    const el = playbackRef.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.src = '';
    }
    unbindPlaybackRef.current?.();
    unbindPlaybackRef.current = null;
    playbackRef.current = null;
  }, [closePlay]);

  const dropTake = useCallback(() => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    blobRef.current = null;
    setTake(null);
  }, []);

  const dropPieces = useCallback(() => {
    if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
    pieceUrlRef.current = null;
    piecesRef.current = emptyPieces();
    pieceRef.current = null;
    joinRef.current = null;
    setPiece(null);
  }, []);

  /** Pieces thrown away before they became a take — a sentence started over
   *  from idle, a mic that went away. Logged, because a run of these is a
   *  sentence too long to finish even in parts. */
  const abandonPieces = useCallback(() => {
    const pieces = piecesRef.current.takes.length;
    if (pieces) log('pieces-abandoned', { pieces });
    dropPieces();
  }, [dropPieces, log]);

  /**
   * Straight into hearing it — a whole take or one piece. The Stop tap is the
   * gesture behind this play(), so autoplay policy is satisfied; if it still
   * refuses, the review controls appear and nothing is lost but the listen.
   */
  const playBack = useCallback((url, piece = null) => {
    setPhase('playback');
    openPlay('take', 'take', piece != null ? { piece } : {});
    const el = new Audio(url);
    // The take plays back at the panel's master volume, like the prompt.
    unbindPlaybackRef.current = bindMediaToMaster(el);
    playbackRef.current = el;
    const finish = (outcome) => () => {
      closePlay('take', outcome);
      unbindPlaybackRef.current?.();
      unbindPlaybackRef.current = null;
      playbackRef.current = null;
      toReview();
    };
    el.onended = finish('ended');
    el.onerror = finish('blocked');
    const result = el.play();
    if (result?.catch) {
      result.catch((err) => {
        languageLog.audioError('play-blocked', { url: 'take', error: err?.message });
        closePlay('take', 'blocked');
        playbackRef.current = null;
        toReview();
      });
    }
  }, [closePlay, openPlay, toReview]);

  /**
   * A finished take. The mic is already closed by the time this runs (see
   * `useVoiceCapture`), so everything here is about judging the take and
   * playing it back — none of which is a reason to keep the microphone open.
   * A take joined from pieces arrives here too, as one ordinary take.
   */
  const receiveTake = useCallback(({
    blob, durationMs, heard, measurable, voice, intent,
  }) => {
    blobRef.current = blob;
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = URL.createObjectURL(blob);
    log('stop', {
      bytes: blob.size, heard, durationMs, ...voice,
    }, intent);
    // The same facts the log has always carried, now also enforced.
    // WE ONLY REFUSE ON WHAT WE COULD MEASURE. `heard` comes from a live
    // level meter that needs an AudioContext; a browser without one reports
    // no levels at all and the band just stays a baseline. There, `heard`
    // is false for every take ever made, and refusing on it would lock the
    // rung shut on a device where nothing is wrong. So loudness is only
    // judged when a level actually arrived; length is judged always.
    // A take joined from pieces is judged here too, on the same one-go floor
    // (MIN_TAKE_MS, in `speechFloor`) — its loudness was judged per piece.
    const verdict = judgeTake({ heard, sampled: measurable, durationMs });
    setTakeVerdict(verdict);
    if (verdict) {
      setRefusals((n) => n + 1);
      // Logged as its own event: a run of these is what tells a grown-up the
      // rung is being tapped through rather than done, and it is not
      // recoverable from `capture.stop` without knowing these thresholds.
      log('refused', {
        reason: verdict, durationMs, bytes: blob.size, heard, measurable, ...voice,
      }, intent);
    } else {
      setRefusals(0);
    }

    const after = afterTakeRef.current;
    afterTakeRef.current = null;
    if (after === 'compare') routeRef.current.compare?.(null, 'recording');
    else playBack(takeUrlRef.current);
    decodeTake(blob).then((samples) => { if (blobRef.current === blob) setTake(samples); });
  }, [log, playBack]);

  /**
   * A finished PIECE: judged on its own floor (`pieceVerdict` — a phrase, not
   * a sentence), kept in its slot, played straight back. It is not the take
   * yet; the pieces become one only after the last of them.
   */
  const receivePiece = useCallback(({
    blob, durationMs, heard, measurable, voice, intent,
  }) => {
    const i = pieceRef.current;
    piecesRef.current = setPieceTake(piecesRef.current, i, {
      blob, durationMs, heard, ...voice,
    });
    // The piece's span of the model, beside the take: a take much shorter than
    // its span is a piece that was cut off, and without the span it cannot be
    // told from one that was simply said quickly.
    const span = spanOf(piecesRef.current, i);
    const toMs = span.toMs ?? sentenceMsRef.current;
    log('piece-stop', {
      piece: i, durationMs, heard, bytes: blob.size, fromMs: span.fromMs, toMs, spanMs: spanMs({ fromMs: span.fromMs, toMs }), ...voice,
    }, intent);
    const verdict = pieceVerdict({ durationMs, heard, measurable });
    setTakeVerdict(verdict);
    if (verdict) {
      setRefusals((n) => n + 1);
      log('refused', {
        piece: i, reason: verdict, durationMs, bytes: blob.size, heard, measurable, ...voice,
      }, intent);
    } else {
      setRefusals(0);
    }
    if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
    pieceUrlRef.current = URL.createObjectURL(blob);
    const after = afterTakeRef.current;
    afterTakeRef.current = null;
    if (after === 'compare') routeRef.current.compare?.(i, 'recording');
    else if (after === 'finish' && !verdict) routeRef.current.finish?.(intent);
    else playBack(pieceUrlRef.current, i);
    // The decode is slow and the learner may already have moved on — to the
    // next piece, or a redo — so the picture lands only if this piece's take
    // is still the one being heard or reviewed.
    decodeTake(blob).then((samples) => {
      const phaseNow = phaseRef.current;
      if (pieceRef.current !== i || piecesRef.current.takes[i]?.blob !== blob) return;
      if (phaseNow !== 'playback' && phaseNow !== 'review') return;
      setTake(samples);
    });
  }, [log, playBack]);

  // Whether a take is a piece is decided when it ARRIVES, from the ref: the
  // cut sets `pieceRef` synchronously, and the ding can end — and the mic
  // open — before any effect has run.
  const onTake = useCallback(({ blob, durationMs }) => {
    const heard = silenceRef.current.heard;
    const measurable = silenceRef.current.sampled === true;
    const voice = meterSummary(silenceRef.current);
    const intent = stopIntentRef.current ?? intentRef.current;
    stopIntentRef.current = null;
    const take = {
      blob, durationMs, heard, measurable, voice, intent,
    };
    if (pieceRef.current != null) receivePiece(take);
    else receiveTake(take);
  }, [receivePiece, receiveTake]);

  const onDenied = useCallback((err) => {
    languageLog.captureError('denied', { seq: entry.seq, error: err?.message });
    // The old copy told the learner to "skip this one" — and no skip existed
    // anywhere in this component, so a denied mic stranded the recording
    // badge forever pointing at a control that was never built. The real
    // escape hatch is the ladder's own: drop the rung from this device and
    // sentences graduate across the gap.
    setError('The microphone is unavailable on this device.');
    // Pieces said so far go too: the sentence cannot be finished without the
    // mic, and a later start begins it whole.
    abandonPieces();
    setPhase('idle');
  }, [abandonPieces, entry.seq]);

  // Destructured, not held as an object: `beginCapture` is what
  // `useSentenceAudio` fires at the end of the prompt sequence, so an identity
  // that changed every render would re-arm that sequence mid-play.
  const {
    start: startCapture, stop: stopCapture, cancel: cancelCapture, release: releaseMic, stream,
  } = useVoiceCapture({
    onTake, onDenied,
  });

  const beginCapture = useCallback(async () => {
    setError(null);
    setSilent(false);
    setTakeVerdict(null);
    silenceRef.current = createVoiceMeter(Date.now());
    stopIntentRef.current = null;
    afterTakeRef.current = null;
    if (!await startCapture()) return;
    setPhase('recording');
    log('start', pieceRef.current != null ? { piece: pieceRef.current } : {});
  }, [log, startCapture]);

  // The prompt player's sequence ran to its end (the sentence, or a span, and
  // the ding): the playback ended, and the mic opens.
  const onPromptEnd = useCallback(() => {
    closePlay('prompt', 'ended');
    beginCapture();
  }, [beginCapture, closePlay]);
  const onListenEnd = useCallback(() => closePlay('listen', 'ended'), [closePlay]);

  // The prompt plays, then the ding, then recording begins — one sequence,
  // one gesture. The learner shouldn't have to hunt for a second button
  // between hearing and speaking.
  const {
    playSequence, stop: stopPromptPlayer, blocked, position,
  } = useSentenceAudio({ onSequenceEnd: onPromptEnd, onClip: setSounding });
  /** Stop the prompt player, closing its playback line as `outcome`. */
  const stop = useCallback((outcome = 'stopped') => {
    closePlay('prompt', outcome);
    stopPromptPlayer();
  }, [closePlay, stopPromptPlayer]);
  // HEARING IT AGAIN WITHOUT RECORDING. A second player, because the one above
  // opens the microphone when it finishes: a child who only wants to hear a
  // line once more must never find the mic live at the end of it.
  const {
    playSequence: listenTo, stop: stopListenPlayer, blocked: listenBlocked,
  } = useSentenceAudio({ onSequenceEnd: onListenEnd });
  const stopListening = useCallback(() => {
    closePlay('listen', 'stopped');
    stopListenPlayer();
  }, [closePlay, stopListenPlayer]);
  useEffect(() => { if (listenBlocked) closePlay('listen', 'blocked'); }, [listenBlocked, closePlay]);

  useEffect(() => {
    setPhase('idle');
    setError(null);
    // A new sentence may be cut again, whatever happened to the last one.
    noPiecesRef.current = false;
    joinedRef.current = false;
    pieceRef.current = null;
    setPiece(null);
    setJoinFailed(false);
    sentenceMsRef.current = null;
    languageLog.rung('enter', { rung: 'recording', seq: entry.seq });
    // Take the keyboard on arrival. The tap that brought the child here — the
    // ladder's Recording step, the previous sentence's Keep — leaves focus on
    // THAT control, and a Space pressed there would re-press it, not start
    // this. The stage itself is the thing the keys belong to now.
    rootRef.current?.focus?.({ preventScroll: true });
    return () => {
      // LEAVING PARTWAY THROUGH A SENTENCE IN PIECES drops every piece. Half a
      // sentence is not a recording, so nothing is uploaded; the log says how
      // far the learner got, because a run of these is a sentence too long to
      // finish even in parts.
      if (piecesRef.current.takes.length) {
        languageLog.capture('pieces-abandoned', {
          seq: entry.seq, pieces: piecesRef.current.takes.length, via: 'auto', phase: phaseRef.current,
        });
      }
      piecesRef.current = emptyPieces();
      joinRef.current = null;
      if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
      pieceUrlRef.current = null;
      stop();
      stopListening();
      stopPlayback();
      // A take in progress is thrown away, not handed back: releasing the mic
      // alone ends the recorder, which would deliver a take — and play it —
      // for a sentence that is no longer on screen.
      cancelCapture();
      releaseMic();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      takeUrlRef.current = null;
    };
  }, [entry.seq, stop, stopListening, stopPlayback, cancelCapture, releaseMic]);

  const cue = useCallback(() => (cueUrl ? [{ url: cueUrl, role: 'cue' }] : []), [cueUrl]);

  const start = useCallback(() => {
    stopListening();
    dropTake();
    abandonPieces();
    joinedRef.current = false;
    setJoinFailed(false);
    setPausesFor(modelUrl);
    setPhase('prompting');
    openPlay('prompt', 'sentence');
    playSequence([...clipsFor(entry, audioUrl), ...cue()]);
  }, [entry, audioUrl, modelUrl, cue, playSequence, dropTake, abandonPieces, stopListening, openPlay]);

  // Again means the ding and the mic — not the whole sentence over. Hearing
  // the prompt again is what the Repetition rung is for, and a retry that is
  // slower than the first attempt is backwards.
  //
  // EXCEPT AFTER A TAKE JOINED FROM PIECES. That sentence was too long to say
  // in one go, so a bare ding would ask for exactly that; it starts over from
  // the sentence, and can be cut again.
  //
  // A COMPARE MAY STILL BE SOUNDING (Tab, then Backspace). It is silenced
  // before anything else: left running, the speaker plays the model and the
  // old take into the new take, and its level passes the too-quiet gate.
  const recordAgain = useCallback(() => {
    stopListening();
    if (joinedRef.current) {
      stopPlayback();
      log('retake', { joined: true });
      start();
      return;
    }
    stopPlayback();
    dropTake();
    setTakeVerdict(null);
    setPhase('prompting');
    log('retake');
    playSequence(cue());
  }, [log, cue, playSequence, stopPlayback, stopListening, dropTake, start]);

  /** Piece i's part of the model, as a clip: from its start to its cut, or to
   *  the end of the sentence for the open-ended last piece. */
  const spanClip = useCallback((i) => {
    const { fromMs, toMs } = spanOf(piecesRef.current, i);
    return {
      url: modelUrl, language: targetLang, startMs: fromMs, ...(toMs != null ? { endMs: toMs } : {}),
    };
  }, [modelUrl, targetLang]);

  /** Piece i's part of the model, then the ding, then the mic. */
  const playPiece = useCallback((i) => {
    stopPlayback();
    stopListening();
    dropTake();
    setTakeVerdict(null);
    setPhase('prompting');
    openPlay('prompt', 'span', { piece: i });
    playSequence([spanClip(i), ...cue()]);
  }, [cue, dropTake, openPlay, playSequence, spanClip, stopListening, stopPlayback]);

  /** Backspace in piece review: this piece only — its span, the ding, the mic.
   *  The pieces before it are kept, and its old take stays until a new one
   *  replaces it. */
  const redoPiece = useCallback(() => {
    const i = pieceRef.current;
    if (i == null) return;
    if (phaseRef.current === 'recording') cancelCapture();
    log('piece-redo', { piece: i });
    playPiece(i);
  }, [cancelCapture, log, playPiece]);

  /**
   * GO FROM IDLE. Normally the sentence from the top — but idle with a piece
   * in hand means the piece's sound was blocked, and starting over would
   * throw away the parts already said. So it resumes that piece instead.
   */
  const begin = useCallback(() => {
    const i = pieceRef.current;
    if (i == null) { start(); return; }
    log('piece-resume', { piece: i });
    playPiece(i);
  }, [log, playPiece, start]);

  /**
   * → WHILE THE SENTENCE PLAYS: "that's enough — let me say this much". Only
   * the target clip can be cut (not the meaning, not the ding), only an
   * open-ended span, and the cut snaps back to the pause the learner meant
   * (`pauses.js`). A snap that would land too close to the span's start is
   * dropped for the raw press, which `canCut` has already allowed.
   */
  const cut = useCallback(() => {
    if (phaseRef.current !== 'prompting' || noPiecesRef.current) return;
    const at = position();
    if (!at || at.language !== targetLang) return;
    const i = pieceRef.current ?? 0;
    if (!canCut(piecesRef.current, i, at.ms)) return;
    const snapped = snapCut(at.ms, pauses.current);
    const cutMs = canCut(piecesRef.current, i, snapped) ? snapped : at.ms;
    piecesRef.current = addCut(piecesRef.current, cutMs);
    stop();
    // Synchronously: the ding can end, and the take arrive, before an effect.
    pieceRef.current = i;
    setPiece(i);
    if (at.durationMs != null) sentenceMsRef.current = at.durationMs;
    // Where every piece now lies in the model — so a take can be read against
    // the span it was meant to cover.
    log('cut', {
      piece: i,
      rawMs: at.ms,
      cutMs,
      snapped: cutMs !== at.ms,
      sentenceMs: sentenceMsRef.current,
      pieceSpans: pieceSpans(piecesRef.current, sentenceMsRef.current),
    });
    playSequence(cue());
  }, [cue, log, pauses, playSequence, position, stop, targetLang]);

  /**
   * After the last piece: join them into ONE take, which then goes through
   * the ordinary review — verdict, playback, Keep — exactly like a take said
   * in one go. Loudness was judged per piece, so the joined take is judged on
   * length alone (`measurable: false`).
   *
   * A JOIN THAT FAILS (no Web Audio, a piece that will not decode, or no
   * answer within JOIN_TIMEOUT_MS) falls back to the one-go rung for this
   * sentence: the pieces cannot become a recording, and offering the cut
   * again would fail the same way.
   */
  const finishPieces = useCallback(async (heldIntent = null) => {
    const state = piecesRef.current;
    // ENTER JOINS WHAT HAS BEEN SAID, even mid-sentence: the child said "that
    // much", and that much is the recording. The tail nobody said is simply
    // not in it — `partial: true` on the stitched line says so, and the
    // joined take still has to clear the one-go length floor.
    const takes = saidTakes(state);
    const partial = isPartial(state);
    const token = {};
    joinRef.current = token;
    // The Finish press, held across the join: the stitched line is its.
    const intent = heldIntent ?? intentRef.current;
    setPhase('joining');
    let blob;
    try {
      blob = await withTimeout(joinTake(takes.map((t) => t.blob)), JOIN_TIMEOUT_MS);
    } catch (err) {
      if (joinRef.current !== token) return;
      log('stitch-failed', { pieces: takes.length, error: err?.message }, intent);
      dropPieces();
      noPiecesRef.current = true;
      setJoinFailed(true);
      setPhase('idle');
      return;
    }
    // Left, or started over, while the join ran: the result belongs to nothing.
    if (joinRef.current !== token) return;
    const said = { ...state, takes };
    const durationMs = totalMs(said);
    const voice = sumVoice(takes);
    log('stitched', {
      pieces: takes.length, durationMs, bytes: blob.size, ...voice, ...(partial ? { partial: true, of: pieceCount(state) } : {}),
    }, intent);
    dropPieces();
    joinedRef.current = true;
    receiveTake({
      blob, durationMs, heard: allHeard(said), measurable: false, voice, intent,
    });
  }, [dropPieces, log, receiveTake]);

  /** Space in chunk review: on with the sentence FROM WHERE IT PAUSED — the
   *  first later chunk not yet said — or, once every chunk has a take, the
   *  join. A refused chunk goes nowhere; Backspace redoes it. */
  const nextPiece = useCallback(() => {
    if (takeVerdict) return;
    const i = pieceRef.current;
    if (i == null) return;
    stopPlayback();
    stopListening();
    const j = nextToSay(piecesRef.current, i);
    if (j == null) {
      finishPieces();
      return;
    }
    pieceRef.current = j;
    setPiece(j);
    log('piece-next', { piece: j });
    playPiece(j);
  }, [finishPieces, log, playPiece, stopListening, stopPlayback, takeVerdict]);

  /** ENTER: done — join what has been said, from wherever the rung is. With
   *  no chunks it is the ordinary "go" (stop, keep). */
  const done = useCallback(() => {
    const current = phaseRef.current;
    const inChunks = pieceRef.current != null;
    if (!inChunks || current === 'idle' || current === 'joining') return false;
    if (current === 'recording') {
      afterTakeRef.current = 'finish';
      stopIntentRef.current = intentRef.current;
      stopCapture();
      return true;
    }
    if (current === 'prompting' && !saidTakes(piecesRef.current).length) return true;
    if ((current === 'playback' || current === 'review') && takeVerdict) return true;
    stop();
    stopPlayback();
    stopListening();
    finishPieces();
    return true;
  }, [finishPieces, stop, stopCapture, stopListening, stopPlayback, takeVerdict]);

  /**
   * Hear one line — the sentence or its meaning — without recording anything.
   * Allowed at every point except while the learner is speaking or the prompt
   * is already sounding; a finished take is kept, because this is a listen, not
   * a retake.
   */
  const hear = useCallback((language) => {
    if (!language) return;
    const current = phaseRef.current;
    if (current === 'recording' || current === 'prompting' || current === 'joining') return;
    stopPlayback();
    if (current === 'playback') toReview();
    languageLog.rung('hear', { rung: 'recording', seq: entry.seq, language });
    openPlay('listen', 'sentence', { language });
    listenTo([{ url: audioUrl(entry.seq, language), language }]);
  }, [audioUrl, entry.seq, listenTo, openPlay, stopPlayback, toReview]);

  /** The model against the take just made: a chunk's span then its take, or
   *  the whole sentence then the whole take. Nothing is thrown away. */
  const compare = useCallback((i, from) => {
    const url = i != null ? pieceUrlRef.current : takeUrlRef.current;
    if (!url) return;
    stopPlayback();
    toReview();
    log('compare', { from, ...(i != null ? { piece: i } : {}) });
    openPlay('listen', 'compare', i != null ? { piece: i } : {});
    listenTo([
      i != null ? spanClip(i) : { url: audioUrl(entry.seq, targetLang), language: targetLang },
      { url, role: 'take', gapMs: 400 },
    ]);
  }, [audioUrl, entry.seq, listenTo, log, openPlay, spanClip, stopPlayback, targetLang, toReview]);
  routeRef.current = { compare, finish: finishPieces };

  /**
   * TAB = HEAR IT AGAIN, AND NEVER DESTROYS ANYTHING (owner ruling 2026-09-23).
   *
   *  - before any take: the whole sentence (a chunk in hand: its span);
   *  - while the sentence or a span sounds: that sound again from its start —
   *    there is no take yet, so nothing is lost;
   *  - WHILE RECORDING: the take is STOPPED AND KEPT, and the learner hears the
   *    model then that take. Ignoring Tab at a live mic was the other option;
   *    it was not chosen because a child who presses "hear it again" and hears
   *    nothing presses it again — which is exactly the three presses in 5s
   *    that, until this ruling, wiped the take three times on seq 16;
   *  - with a take: a compare, as before.
   *
   * Backspace is the retake key. Tab never is.
   */
  const replaySentence = useCallback(() => {
    const current = phaseRef.current;
    const i = pieceRef.current;
    if (current === 'joining') return;
    if (current === 'idle') {
      if (i == null) { hear(targetLang); return; }
      log('hear', { from: current, piece: i, what: 'span' });
      openPlay('listen', 'span', { piece: i });
      listenTo([spanClip(i)]);
      return;
    }
    if (current === 'recording') {
      log('hear', { from: current, ...(i != null ? { piece: i } : {}) });
      afterTakeRef.current = 'compare';
      stopIntentRef.current = intentRef.current;
      stopCapture();
      return;
    }
    if (current === 'prompting') {
      log('hear', { from: current, ...(i != null ? { piece: i, what: 'span' } : { what: 'sentence' }) });
      stop();
      if (i != null) playPiece(i);
      else start();
      return;
    }
    compare(i, current);
  }, [compare, hear, listenTo, log, openPlay, playPiece, spanClip, start, stop, stopCapture, targetLang]);

  /** ← START OVER: every chunk goes, and the sentence plays from the top. */
  const startOver = useCallback(() => {
    const current = phaseRef.current;
    log('restart', { from: current, pieces: saidTakes(piecesRef.current).length });
    if (current === 'recording') cancelCapture();
    stop();
    stopPlayback();
    stopListening();
    dropPieces();
    joinedRef.current = false;
    setTakeVerdict(null);
    start();
  }, [cancelCapture, dropPieces, log, start, stop, stopListening, stopPlayback]);

  /** Redo chunk j — Backspace on the chunk in hand, or a tap on its segment.
   *  Its span, the ding, the mic; every other chunk is kept. */
  const redoChunk = useCallback((j) => {
    const current = phaseRef.current;
    if (current === 'joining') return;
    if (current === 'recording') cancelCapture();
    stop();
    stopPlayback();
    stopListening();
    pieceRef.current = j;
    setPiece(j);
    log('piece-redo', { piece: j });
    playPiece(j);
  }, [cancelCapture, log, playPiece, stop, stopListening, stopPlayback]);

  useEffect(() => {
    if (!blocked || phase !== 'prompting') return;
    stop('blocked');
    setPhase('idle');
  }, [blocked, phase, stop]);

  // The take arrives after the recorder stops — later, on a real device — so
  // the gesture that stopped it is parked for `onTake` to put on the line.
  const stopRecording = useCallback(() => {
    stopIntentRef.current = intentRef.current;
    stopCapture();
  }, [stopCapture]);

  const skipPlayback = useCallback(() => {
    stopPlayback();
    toReview();
  }, [stopPlayback, toReview]);

  const accept = useCallback(() => {
    // THE GATE. A take that cleared neither floor is not an attempt, and the
    // only way on is to record again. Enforced here rather than only by
    // disabling the tile, because the keyboard reaches `accept` directly.
    if (takeVerdict) return;
    if (!blobRef.current || saving) return;
    stopPlayback();
    log('keep', { joined: joinedRef.current, bytes: blobRef.current.size });
    languageLog.rung('complete', { rung: 'recording', seq: entry.seq });
    onComplete({ seq: entry.seq, rung: 'recording', blob: blobRef.current });
  }, [entry.seq, log, onComplete, saving, stopPlayback, takeVerdict]);

  // The band reports every live level; two seconds under the floor with
  // nothing yet heard is the moment to say so in words. A level arriving at
  // all marks loudness as measurable on this device — see the verdict for why
  // that is a precondition for refusing on it. The meter (`speechFloor.js`)
  // decides; this only shows it, and logs the two moments it changes — never
  // a line per frame.
  const onLevel = useCallback((level) => {
    const m = silenceRef.current;
    const now = Date.now();
    const change = meterLevel(m, level, now);
    if (!change) return;
    if (change === 'auto-stop') {
      // Speech was heard, then AUTO_STOP_SILENT_MS of nothing: the take ends
      // itself, exactly as if Stop had been pressed.
      const intent = { via: 'auto', phase: 'recording' };
      log('auto-stop', {
        ...(pieceRef.current != null ? { piece: pieceRef.current } : {}),
        silentMs: Math.round(m.endSilentMs),
        afterMs: now - m.startedAt,
      }, intent);
      stopIntentRef.current = intent;
      stopCapture();
      return;
    }
    setSilent(change === 'silent-on');
    log(change === 'silent-on' ? 'silent-warning' : 'silent-cleared', {
      ...(pieceRef.current != null ? { piece: pieceRef.current } : {}),
      afterMs: now - m.startedAt,
    });
  }, [log, stopCapture]);

  /** Backspace / the Again tile: redo the chunk in hand, or — with no chunks —
   *  record again. A live take is thrown away first: that is what "again" is. */
  const again = useCallback(() => {
    if (pieceRef.current != null) { redoPiece(); return; }
    if (phaseRef.current === 'recording') cancelCapture();
    recordAgain();
  }, [cancelCapture, recordAgain, redoPiece]);

  /** Space / the forward tile, by phase. */
  const forward = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'idle') begin();
    else if (current === 'prompting') cut();
    else if (current === 'recording') stopRecording();
    else if (current === 'playback') skipPlayback();
    else if (current === 'review') {
      if (pieceRef.current != null) nextPiece();
      else accept();
    }
  }, [accept, begin, cut, nextPiece, skipPlayback, stopRecording]);

  /**
   * THE KEYS (owner ruling 2026-09-23):
   *
   *   Space      forward, never destructive — play / pause here / stop / next / join / keep
   *   Tab        hear it again, never destructive (see `replaySentence`)
   *   Backspace  redo this chunk (with no chunks: record again)
   *   ←          start the whole sentence over
   *   Enter      done — join what is said, even mid-sentence (no chunks: as Space)
   *   →          pause here, kept as an alias of Space while the sentence plays
   *
   * Tab belongs to the rung whatever holds focus; every other key is left to a
   * focused control that owns it (a tabbed-to button's Enter, a field's
   * Backspace).
   */
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) dispatch('key:Shift+Tab', () => hear(sourceLang));
        else dispatch('key:Tab', replaySentence);
        return;
      }
      const via = KEY_VIA[e.key];
      if (!via || ownsKeys(e.target)) return;
      const current = phaseRef.current;
      const inChunks = pieceRef.current != null;
      if (e.key === 'ArrowRight') {
        if (current === 'prompting') { e.preventDefault(); dispatch(via, cut); }
        return;
      }
      if (e.key === 'ArrowLeft') {
        // Nothing to start over from an untouched sentence: the arrow is left alone.
        if (current === 'idle' && !inChunks) return;
        e.preventDefault();
        dispatch(via, startOver);
        return;
      }
      if (e.key === 'Backspace') {
        if (current === 'recording' || current === 'playback' || current === 'review') {
          e.preventDefault();
          dispatch(via, again);
        }
        return;
      }
      if (e.key === 'Enter' && inChunks && current !== 'idle') {
        e.preventDefault();
        dispatch(via, done);
        return;
      }
      // Space, or Enter with no chunks: forward. Enter never cuts — a cut is
      // a pause, and Enter means done.
      if (e.key === 'Enter' && current === 'prompting') return;
      if (current === 'joining') return;
      e.preventDefault();
      dispatch(via, forward);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [again, cut, dispatch, done, forward, hear, replaySentence, sourceLang, startOver]);

  const getPlayhead = useCallback(() => {
    const el = playbackRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return 0;
    return Math.min(1, el.currentTime / el.duration);
  }, []);

  // A tapped line hands the keys straight back to the stage, so the next Space
  // is still the rung's rather than a second press of the line.
  const tapToHear = (language) => () => {
    dispatch('touch', () => hear(language));
    rootRef.current?.focus?.({ preventScroll: true });
  };
  // The Pause tile is the touch twin of →; it hands the keys back the same way.
  const tapToCut = () => {
    dispatch('touch', cut);
    rootRef.current?.focus?.({ preventScroll: true });
  };
  const inPieces = piece != null;
  // Mirrors what `cut` accepts: the sentence itself, open-ended (the whole of
  // it, or the rest after the last cut), on a sentence that may still be cut.
  const cutOffered = phase === 'prompting' && !noPiecesRef.current
    && sounding?.language === targetLang && sounding?.endMs == null;
  const chunks = piecesRef.current;
  const lastPiece = inPieces && nextToSay(chunks, piece) == null;
  const said = saidTakes(chunks).length;
  const hasTake = phase === 'playback' || phase === 'review';
  const key = (hint) => (showShortcuts ? <kbd className="lang-tile__key" aria-hidden="true">{hint}</kbd> : null);

  /**
   * THE CHUNK BAR: the sentence as segments, one per chunk, sized by its span
   * of the model when the sentence's length is known. Filled = said, lit = the
   * chunk in hand, empty = still to do. A segment is a button: tapping it
   * redoes that chunk (the touch twin of Backspace, for any chunk). Before any
   * pause the whole sentence is one segment.
   */
  const segments = (() => {
    const count = pieceCount(chunks);
    const sentenceMs = sentenceMsRef.current;
    return Array.from({ length: count }, (_, j) => {
      const { fromMs, toMs } = spanOf(chunks, j);
      const end = toMs ?? sentenceMs;
      const grow = sentenceMs && end != null ? Math.max(1, end - fromMs) : 1;
      const filled = count === 1 && !inPieces ? Boolean(take) || (hasTake && Boolean(blobRef.current)) : Boolean(chunks.takes[j]);
      const current = inPieces ? j === piece : phase !== 'idle';
      return {
        j, grow, filled, current,
      };
    });
  })();
  const tapSegment = (j) => () => {
    dispatch('touch', () => {
      if (inPieces || pieceCount(chunks) > 1) { redoChunk(j); return; }
      if (phaseRef.current === 'idle') begin();
      else if (phaseRef.current !== 'prompting' && phaseRef.current !== 'joining') again();
    });
    rootRef.current?.focus?.({ preventScroll: true });
  };

  return (
    <div ref={rootRef} tabIndex={-1} className={`lang-rung lang-rung--recording is-${phase}`}>
      {/* The meaning, small, above the sentence — reinforcement, never spoken
          unless asked for. Both lines can be tapped to hear them; Tab never
          lands on them, because Tab is "hear it again". */}
      {sourceLang && entry.text?.[sourceLang] && (
        <button type="button" tabIndex={-1} className="lang-rung__say lang-rung__source" onClick={tapToHear(sourceLang)}>
          {entry.text[sourceLang]}
        </button>
      )}
      <button type="button" tabIndex={-1} className="lang-rung__say lang-rung__target" onClick={tapToHear(targetLang)}>
        {entry.text?.[targetLang]}
      </button>

      {/* Always on the stage — a bare line before anything has been said, so
          the sentence does not move when the voice starts filling it. */}
      <VoiceBand
        stream={phase === 'recording' ? stream : null}
        take={take}
        getPlayhead={phase === 'playback' ? getPlayhead : null}
        onLevel={phase === 'recording' ? onLevel : null}
      />

      {blocked && (
        <p className="lang-rung__notice" role="alert">The sound didn’t start — try again.</p>
      )}
      {silent && phase === 'recording' && (
        <p className="lang-rung__notice" role="alert">Nothing’s coming through — is the microphone on?</p>
      )}
      {/* A take that cleared neither floor, however short. Said here because the
          live warning above cannot reach a take shorter than two seconds, and
          those are precisely the takes most likely to be empty. */}
      {takeVerdict && (phase === 'playback' || phase === 'review') && (
        <div className="lang-rung__notice" role="alert">
          <p>{takeVerdict === 'too-quiet'
            ? 'We didn’t hear that one — say it out loud and have another go.'
            : `That was too quick — say the whole ${inPieces ? 'part' : 'sentence'}.`}</p>
          {/* Three in a row and the mic may simply be dead. The way out is the
              DEVICE-level one, so a broken panel stops asking while a child
              stuck on one sentence still has to say it. */}
          {refusals >= 3 && onDisableMicrophone && (
            <button type="button" className="lang-btn" onClick={onDisableMicrophone}>
              Skip recording on this device
            </button>
          )}
        </div>
      )}
      {joinFailed && phase === 'idle' && (
        <p className="lang-rung__notice" role="alert">Couldn’t put the parts together — say it in one go.</p>
      )}
      {error && (
        <div className="lang-rung__notice" role="alert">
          <p>{error}</p>
          {onDisableMicrophone && (
            <button type="button" className="lang-btn" onClick={onDisableMicrophone}>
              Skip recording on this device
            </button>
          )}
        </div>
      )}

      <div className="lang-chunks" role="group" aria-label="The sentence, in parts">
        {segments.map(({
          j, grow, filled, current,
        }) => (
          <button
            key={j}
            type="button"
            tabIndex={-1}
            className={`lang-chunks__seg${filled ? ' is-filled' : ''}${current ? ' is-current' : ''}`}
            style={{ flexGrow: grow }}
            onClick={tapSegment(j)}
            disabled={phase === 'joining'}
            aria-label={`Part ${j + 1}${filled ? ', recorded' : ''}${current ? ', now' : ''}`}
          />
        ))}
      </div>
      {inPieces && (phase === 'playback' || phase === 'review') && (
        <p className="lang-rung__part">Part {piece + 1}</p>
      )}
      <div className="lang-rung__controls">
        {phase === 'idle' && (
          <button type="button" className="lang-tile lang-tile--primary" onClick={onTap(begin)} aria-label="Listen, then record">
            <Icon name="record" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Play</span>
            {key('Space')}
          </button>
        )}
        {/* THE FORWARD TILE while the sentence sounds: "Pause here" — stop it
            there and say that much. Only while a cuttable part of the sentence
            is sounding; during the ding or a bounded span it is a status. */}
        {cutOffered && (
          <button type="button" className="lang-tile lang-tile--primary" onClick={tapToCut} aria-label="Pause here">
            <Icon name="pause" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Pause here</span>
            {key('Space')}
          </button>
        )}
        {((phase === 'prompting' && !cutOffered) || phase === 'playback') && (
          <span className="lang-tile lang-tile--status" role="status" aria-label={phase === 'prompting' ? 'Listen' : 'Playing your recording'}>
            <Icon name="volume" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">{phase === 'prompting' ? 'Listen' : 'Playing'}</span>
          </span>
        )}
        {phase === 'joining' && (
          <span className="lang-tile lang-tile--status" role="status" aria-label="Putting it together">
            <Icon name="volume" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Joining</span>
          </span>
        )}
        {phase === 'recording' && (
          <button type="button" className="lang-tile lang-tile--live" onClick={onTap(stopRecording)} aria-label="Stop">
            <Icon name="stop" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Stop</span>
            {key('Space')}
          </button>
        )}
        {phase === 'review' && inPieces && (
          <>
            {/* A CHUNK, not the take: Again redoes this chunk only, and the
                primary tile goes on with the sentence — or, once every chunk
                is said, joins them. A refused chunk goes nowhere. */}
            <button
              type="button"
              className={`lang-tile${takeVerdict ? ' lang-tile--primary' : ''}`}
              onClick={onTap(redoPiece)}
              aria-label="Redo this part"
            >
              <Icon name="record-again" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">Redo</span>
              {key('⌫')}
            </button>
            <button
              type="button"
              className={`lang-tile${takeVerdict ? '' : ' lang-tile--primary'}`}
              onClick={onTap(nextPiece)}
              disabled={Boolean(takeVerdict)}
              aria-label={lastPiece ? 'Finish' : 'Next part'}
            >
              <Icon name={lastPiece ? 'keep' : 'next'} className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">{lastPiece ? 'Join' : 'Next'}</span>
              {key('Space')}
            </button>
          </>
        )}
        {phase === 'review' && !inPieces && (
          <>
            {/* WHICH TILE IS PRIMARY FOLLOWS THE TAKE. A refused take means the
                only thing to do is go again, so Again leads and Keep is
                disabled outright. The way past a dead mic is the device-level
                escape in the notice above, not a quiet take. */}
            <button
              type="button"
              className={`lang-tile${takeVerdict ? ' lang-tile--primary' : ''}`}
              onClick={onTap(recordAgain)}
              aria-label="Record again"
            >
              <Icon name="record-again" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">Again</span>
              {key('⌫')}
            </button>
            <button
              type="button"
              className={`lang-tile${takeVerdict ? '' : ' lang-tile--primary'}`}
              onClick={onTap(accept)}
              disabled={saving || Boolean(takeVerdict)}
              aria-label={saving ? 'Saving' : 'Keep it'}
            >
              <Icon name="keep" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">{saving ? 'Saving…' : 'Keep'}</span>
              {key('Space')}
            </button>
          </>
        )}
        {/* The secondary keys, as tiles: hear it again, start over, done. */}
        {phase !== 'joining' && (
          <button type="button" className="lang-tile lang-tile--minor" onClick={onTap(replaySentence)} aria-label="Hear it again">
            <Icon name="volume" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Hear it</span>
            {key('Tab')}
          </button>
        )}
        {(inPieces || joinedRef.current) && phase !== 'joining' && (
          <button type="button" className="lang-tile lang-tile--minor" onClick={onTap(startOver)} aria-label="Start over">
            <Icon name="restart" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Start over</span>
            {key('←')}
          </button>
        )}
        {inPieces && said > 0 && phase !== 'joining' && !(phase === 'review' && lastPiece) && (
          <button
            type="button"
            className="lang-tile lang-tile--minor"
            onClick={onTap(done)}
            disabled={hasTake && Boolean(takeVerdict)}
            aria-label="Done"
          >
            <Icon name="keep" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Done</span>
            {key('Enter')}
          </button>
        )}
      </div>
    </div>
  );
}
