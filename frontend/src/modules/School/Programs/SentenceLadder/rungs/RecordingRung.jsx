import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import Icon from '../../../home/icons/Icon.jsx';
import VoiceBand from './VoiceBand.jsx';
import useVoiceCapture from './useVoiceCapture.js';
import useModelPauses from './useModelPauses.js';
import { snapCut } from './pauses.js';
import {
  emptyPieces, spanOf, canCut, addCut, setTake as setPieceTake, isLast, pieceVerdict, totalMs, allHeard,
} from './pieces.js';
import { joinTake } from './joinTake.js';

/**
 * Recording — say it yourself (design §1).
 *
 * One gesture, then the rung runs itself until the learner has spoken:
 *
 *   tap / Space ─▶ the sentence sounds ─▶ the ding ─▶ the mic is live
 *   tap / Space ─▶ the take plays straight back ─▶ Keep it, or Record again
 *   Tab (with a take) ─▶ the sentence, then the take — compare, nothing lost
 *   → while the sentence plays ─▶ ding ─▶ say that much ─▶ Space ─▶ the rest
 *     plays from the cut ─▶ ding ─▶ say it ─▶ … ─▶ Finish joins them into one take
 *
 * The ding is the cue to speak, so nothing on screen has to say "listen" or
 * "now" — a child follows the sound, not the copy. Playback is automatic and
 * has no player: hearing yourself is the point of the rung, not an option in
 * it. The one moving thing is the voice band, the learner's own sound drawn
 * as it happens, which is also how they can see that the microphone hears
 * them at all.
 *
 * The result is never scored: the 2016 app didn't score it either, and a
 * recording is evidence for the learner's own review, not a graded artifact.
 * Speech scoring is a named deferral (§7).
 *
 * Every step has one key. Space or Enter is "go" — start, stop, keep —
 * because a child at a keyboard should never have to find a different key
 * for the next thing; Backspace is "record again". A focused control keeps
 * its own keys — a tabbed-to button's Enter, a menu field's Backspace — so
 * nobody is surprised by a rung acting from underneath the thing they hold.
 *
 * This rung only exists when a microphone was detected. It is never rendered
 * as a dead control — the queue simply omits it on a device without one.
 */

/** Below this shaped level for SILENT_AFTER_MS, the mic is called silent. */
const SILENT_LEVEL = 0.04;
const SILENT_AFTER_MS = 2000;
/**
 * The floor a take has to clear to be KEPT at all: long enough to be a
 * sentence, and loud enough to have been one.
 *
 * A rung that accepts anything is a rung that can be tapped through, and the
 * evidence that this was happening is in the log for 2026-09-11: six takes, the
 * last two at ~1s each with `heard: false`, one of them accepted 1 second after
 * it stopped. Recording was being spent rather than done.
 *
 * `heard` is the strong signal and does most of the work — it means the live
 * level never once crossed SILENT_LEVEL, and a real utterance always crosses
 * it. The duration floor catches the other shape: a tap, a cough, a single loud
 * syllable that clears the level but is not an attempt at the sentence.
 *
 * 1200ms IS NOT A GUESS. The six takes from that session were pulled off disk
 * and measured, and they separate cleanly:
 *
 *   take  length   peak      whisper no_speech   text
 *   1-4   1.74s     -0.0dB   0.035-0.093         real Korean sentences
 *          -2.58s   -4.5dB                       (incl. the 이 가방은/가방들은 pair)
 *   5     1.14s    -63.5dB   0.941               silence
 *   6     0.66s    -52.6dB   0.963               silence
 *
 * A -63dB peak is under a quiet room's noise floor; the spectrograms of 5 and 6
 * are black, with no harmonics or formants anywhere. Whisper returned the same
 * byte-identical Korean broadcast sign-off for both, which is its documented
 * hallucination on silence — two different files producing one phrase is the
 * tell. Spoken takes ran 1.74-2.58s and tapped-through ones 0.66-1.14s, so the
 * floor sits in the gap with room on either side.
 */
const MIN_TAKE_MS = 1200;
/** The take is kept as this many mono samples — plenty for a band a few
 *  hundred bars wide, cheap enough to bin every resize. */
const TAKE_SAMPLES = 4096;

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

export default function RecordingRung({
  entry, audioUrl, cueUrl = null, onComplete, saving, onDisableMicrophone, showShortcuts = false,
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
  const silenceRef = useRef({ since: null, heard: false, sampled: false });
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
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
  }, []);

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
    if (pieces) languageLog.capture('pieces-abandoned', { seq: entry.seq, pieces });
    dropPieces();
  }, [dropPieces, entry.seq]);

  /**
   * Straight into hearing it — a whole take or one piece. The Stop tap is the
   * gesture behind this play(), so autoplay policy is satisfied; if it still
   * refuses, the review controls appear and nothing is lost but the listen.
   */
  const playBack = useCallback((url) => {
    setPhase('playback');
    const el = new Audio(url);
    // The take plays back at the panel's master volume, like the prompt.
    unbindPlaybackRef.current = bindMediaToMaster(el);
    playbackRef.current = el;
    const finish = () => {
      unbindPlaybackRef.current?.();
      unbindPlaybackRef.current = null;
      playbackRef.current = null;
      setPhase('review');
    };
    el.onended = finish;
    el.onerror = finish;
    const result = el.play();
    if (result?.catch) {
      result.catch((err) => {
        languageLog.audioError('play-blocked', { url: 'take', error: err?.message });
        playbackRef.current = null;
        setPhase('review');
      });
    }
  }, []);

  /**
   * A finished take. The mic is already closed by the time this runs (see
   * `useVoiceCapture`), so everything here is about judging the take and
   * playing it back — none of which is a reason to keep the microphone open.
   * A take joined from pieces arrives here too, as one ordinary take.
   */
  const receiveTake = useCallback(({
    blob, durationMs, heard, measurable,
  }) => {
    blobRef.current = blob;
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = URL.createObjectURL(blob);
    languageLog.capture('stop', { seq: entry.seq, bytes: blob.size, heard, durationMs });
    // The same facts the log has always carried, now also enforced.
    // WE ONLY REFUSE ON WHAT WE COULD MEASURE. `heard` comes from a live
    // level meter that needs an AudioContext; a browser without one reports
    // no levels at all and the band just stays a baseline. There, `heard`
    // is false for every take ever made, and refusing on it would lock the
    // rung shut on a device where nothing is wrong. So loudness is only
    // judged when a level actually arrived; length is judged always.
    const verdict = measurable && !heard ? 'too-quiet'
      : durationMs < MIN_TAKE_MS ? 'too-short'
        : null;
    setTakeVerdict(verdict);
    if (verdict) {
      setRefusals((n) => n + 1);
      // Logged as its own event: a run of these is what tells a grown-up the
      // rung is being tapped through rather than done, and it is not
      // recoverable from `capture.stop` without knowing these thresholds.
      languageLog.capture('refused', { seq: entry.seq, reason: verdict, durationMs, bytes: blob.size, heard, measurable });
    } else {
      setRefusals(0);
    }

    playBack(takeUrlRef.current);
    decodeTake(blob).then((samples) => { if (blobRef.current === blob) setTake(samples); });
  }, [entry.seq, playBack]);

  /**
   * A finished PIECE: judged on its own floor (`pieceVerdict` — a phrase, not
   * a sentence), kept in its slot, played straight back. It is not the take
   * yet; the pieces become one only after the last of them.
   */
  const receivePiece = useCallback(({
    blob, durationMs, heard, measurable,
  }) => {
    const i = pieceRef.current;
    piecesRef.current = setPieceTake(piecesRef.current, i, { blob, durationMs, heard });
    languageLog.capture('piece-stop', { seq: entry.seq, piece: i, durationMs, heard, bytes: blob.size });
    const verdict = pieceVerdict({ durationMs, heard, measurable });
    setTakeVerdict(verdict);
    if (verdict) {
      setRefusals((n) => n + 1);
      languageLog.capture('refused', {
        seq: entry.seq, piece: i, reason: verdict, durationMs, bytes: blob.size, heard, measurable,
      });
    } else {
      setRefusals(0);
    }
    if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
    pieceUrlRef.current = URL.createObjectURL(blob);
    playBack(pieceUrlRef.current);
    decodeTake(blob).then((samples) => {
      if (piecesRef.current.takes[i]?.blob === blob) setTake(samples);
    });
  }, [entry.seq, playBack]);

  // Whether a take is a piece is decided when it ARRIVES, from the ref: the
  // cut sets `pieceRef` synchronously, and the ding can end — and the mic
  // open — before any effect has run.
  const onTake = useCallback(({ blob, durationMs }) => {
    const heard = silenceRef.current.heard;
    const measurable = silenceRef.current.sampled === true;
    if (pieceRef.current != null) receivePiece({ blob, durationMs, heard, measurable });
    else receiveTake({ blob, durationMs, heard, measurable });
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
    silenceRef.current = { since: null, heard: false, sampled: false };
    if (!await startCapture()) return;
    setPhase('recording');
    languageLog.capture('start', { seq: entry.seq });
  }, [entry.seq, startCapture]);

  // The prompt plays, then the ding, then recording begins — one sequence,
  // one gesture. The learner shouldn't have to hunt for a second button
  // between hearing and speaking.
  const {
    playSequence, stop, blocked, position,
  } = useSentenceAudio({ onSequenceEnd: beginCapture, onClip: setSounding });
  // HEARING IT AGAIN WITHOUT RECORDING. A second player, because the one above
  // opens the microphone when it finishes: a child who only wants to hear a
  // line once more must never find the mic live at the end of it.
  const { playSequence: listenTo, stop: stopListening } = useSentenceAudio();

  useEffect(() => {
    setPhase('idle');
    setError(null);
    // A new sentence may be cut again, whatever happened to the last one.
    noPiecesRef.current = false;
    joinedRef.current = false;
    pieceRef.current = null;
    setPiece(null);
    setJoinFailed(false);
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
        languageLog.capture('pieces-abandoned', { seq: entry.seq, pieces: piecesRef.current.takes.length });
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
    playSequence([...clipsFor(entry, audioUrl), ...cue()]);
  }, [entry, audioUrl, modelUrl, cue, playSequence, dropTake, abandonPieces, stopListening]);

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
      languageLog.capture('retake', { seq: entry.seq, joined: true });
      start();
      return;
    }
    stopPlayback();
    dropTake();
    setTakeVerdict(null);
    setPhase('prompting');
    languageLog.capture('retake', { seq: entry.seq });
    playSequence(cue());
  }, [entry.seq, cue, playSequence, stopPlayback, stopListening, dropTake, start]);

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
    playSequence([spanClip(i), ...cue()]);
  }, [cue, dropTake, playSequence, spanClip, stopListening, stopPlayback]);

  /** Backspace in piece review: this piece only — its span, the ding, the mic.
   *  The pieces before it are kept, and its old take stays until a new one
   *  replaces it. */
  const redoPiece = useCallback(() => {
    const i = pieceRef.current;
    if (i == null) return;
    languageLog.capture('piece-redo', { seq: entry.seq, piece: i });
    playPiece(i);
  }, [entry.seq, playPiece]);

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
    languageLog.capture('cut', {
      seq: entry.seq, piece: i, rawMs: at.ms, cutMs, snapped: cutMs !== at.ms,
    });
    playSequence(cue());
  }, [cue, entry.seq, pauses, playSequence, position, stop, targetLang]);

  /**
   * After the last piece: join them into ONE take, which then goes through
   * the ordinary review — verdict, playback, Keep — exactly like a take said
   * in one go. Loudness was judged per piece, so the joined take is judged on
   * length alone (`measurable: false`).
   *
   * A JOIN THAT FAILS (no Web Audio, a piece that will not decode) falls back
   * to the one-go rung for this sentence: the pieces cannot become a
   * recording, and offering the cut again would fail the same way.
   */
  const finishPieces = useCallback(async () => {
    const state = piecesRef.current;
    const token = {};
    joinRef.current = token;
    setPhase('joining');
    let blob;
    try {
      blob = await joinTake(state.takes.map((t) => t.blob));
    } catch (err) {
      if (joinRef.current !== token) return;
      languageLog.capture('stitch-failed', { seq: entry.seq, pieces: state.takes.length, error: err?.message });
      dropPieces();
      noPiecesRef.current = true;
      setJoinFailed(true);
      setPhase('idle');
      return;
    }
    // Left, or started over, while the join ran: the result belongs to nothing.
    if (joinRef.current !== token) return;
    const durationMs = totalMs(state);
    languageLog.capture('stitched', {
      seq: entry.seq, pieces: state.takes.length, durationMs, bytes: blob.size,
    });
    dropPieces();
    joinedRef.current = true;
    receiveTake({
      blob, durationMs, heard: allHeard(state), measurable: false,
    });
  }, [dropPieces, entry.seq, receiveTake]);

  /** Space in piece review: the rest of the sentence, or — after the last
   *  piece — the join. A refused piece goes nowhere; Backspace redoes it. */
  const nextPiece = useCallback(() => {
    if (takeVerdict) return;
    const i = pieceRef.current;
    if (i == null) return;
    stopPlayback();
    stopListening();
    if (isLast(piecesRef.current, i)) {
      finishPieces();
      return;
    }
    pieceRef.current = i + 1;
    setPiece(i + 1);
    playPiece(i + 1);
  }, [finishPieces, playPiece, stopListening, stopPlayback, takeVerdict]);

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
    if (current === 'playback') setPhase('review');
    languageLog.rung('hear', { rung: 'recording', seq: entry.seq, language });
    listenTo([{ url: audioUrl(entry.seq, language), language }]);
  }, [audioUrl, entry.seq, listenTo, stopPlayback]);

  /**
   * TAB ALWAYS BRINGS THE SENTENCE BACK. Before a take it is a listen. While
   * the learner is recording it starts over: the take in progress is thrown
   * away — never judged, never played back — the sentence sounds again, and
   * the microphone opens when it has finished, exactly as the first press did.
   * Nobody is sent into a recording having heard it only once.
   *
   * ONCE A TAKE EXISTS, TAB IS A COMPARISON, NOT A RETAKE: the sentence, then
   * the learner's own take, and the take is kept. Throwing a finished take away
   * here is what happened on 2026-09-22 — Tab pressed 2.7s after a good take
   * stopped (seq 13) and again 1.7s into its playback (seq 14), each time to
   * hear the model against the take, each time deleting the take and opening
   * the mic. Backspace is the retake key; Tab never is, once there is
   * something to lose.
   */
  const replaySentence = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'idle') { hear(targetLang); return; }
    // The pieces are being joined; there is nothing to restart or compare yet.
    if (current === 'joining') return;
    // IN PIECES, THE SAME RULES FOR THE PIECE IN HAND: with its take, Tab
    // compares that piece's span with that take; otherwise it restarts that
    // piece — its span, the ding, the mic. Earlier pieces are never touched.
    if (pieceRef.current != null) {
      const i = pieceRef.current;
      if ((current === 'playback' || current === 'review') && pieceUrlRef.current) {
        stopPlayback();
        setPhase('review');
        languageLog.capture('compare', { seq: entry.seq, from: current, piece: i });
        listenTo([spanClip(i), { url: pieceUrlRef.current, role: 'take', gapMs: 400 }]);
        return;
      }
      languageLog.capture('replay-restart', { seq: entry.seq, from: current, piece: i });
      if (current === 'recording') cancelCapture();
      stop();
      playPiece(i);
      return;
    }
    if ((current === 'playback' || current === 'review') && takeUrlRef.current) {
      stopPlayback();
      setPhase('review');
      languageLog.capture('compare', { seq: entry.seq, from: current });
      listenTo([
        { url: audioUrl(entry.seq, targetLang), language: targetLang },
        { url: takeUrlRef.current, role: 'take', gapMs: 400 },
      ]);
      return;
    }
    languageLog.capture('replay-restart', { seq: entry.seq, from: current });
    if (current === 'recording') cancelCapture();
    stopPlayback();
    setTakeVerdict(null);
    start();
  }, [
    audioUrl, cancelCapture, entry.seq, hear, listenTo, playPiece, spanClip, start, stop, stopPlayback, targetLang,
  ]);

  useEffect(() => {
    if (!blocked || phase !== 'prompting') return;
    stop();
    setPhase('idle');
  }, [blocked, phase, stop]);

  const stopRecording = stopCapture;

  const skipPlayback = useCallback(() => {
    stopPlayback();
    setPhase('review');
  }, [stopPlayback]);

  const accept = useCallback(() => {
    // THE GATE. A take that cleared neither floor is not an attempt, and the
    // only way on is to record again. Enforced here rather than only by
    // disabling the tile, because the keyboard reaches `accept` directly.
    if (takeVerdict) return;
    if (!blobRef.current || saving) return;
    stopPlayback();
    languageLog.rung('complete', { rung: 'recording', seq: entry.seq });
    onComplete({ seq: entry.seq, rung: 'recording', blob: blobRef.current });
  }, [entry.seq, onComplete, saving, stopPlayback, takeVerdict]);

  // The band reports every live level; two seconds under the floor with
  // nothing yet heard is the moment to say so in words.
  const onLevel = useCallback((level) => {
    const s = silenceRef.current;
    const now = Date.now();
    // A level arrived at all, so loudness is measurable on this device. See the
    // verdict below for why that is a precondition for refusing on it.
    s.sampled = true;
    if (level >= SILENT_LEVEL) {
      s.heard = true;
      s.since = null;
      setSilent(false);
      return;
    }
    if (s.heard) return;
    if (s.since == null) s.since = now;
    else if (now - s.since >= SILENT_AFTER_MS) setSilent(true);
  }, []);

  // One key for "go", one for "again", the whole way through.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Tab belongs to the rung whatever holds focus: it hears the sentence
      // again (Shift+Tab, the meaning) and never moves focus off the stage.
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) hear(sourceLang);
        else replaySentence();
        return;
      }
      if (ownsKeys(e.target)) return;
      const current = phaseRef.current;
      // → cuts the sentence while it plays (recording in pieces). Anywhere
      // else the arrow is not the rung's, so it is left for the ladder.
      if (e.key === 'ArrowRight') {
        if (current === 'prompting') { e.preventDefault(); cut(); }
        return;
      }
      const go = e.key === ' ' || e.key === 'Enter';
      const again = e.key === 'Backspace';
      if (!go && !again) return;
      if (go) {
        if (current === 'idle') { e.preventDefault(); start(); }
        else if (current === 'recording') { e.preventDefault(); stopRecording(); }
        else if (current === 'playback') { e.preventDefault(); skipPlayback(); }
        else if (current === 'review') {
          e.preventDefault();
          if (pieceRef.current != null) nextPiece();
          else accept();
        }
        return;
      }
      if (current === 'playback' || current === 'review') {
        e.preventDefault();
        if (pieceRef.current != null) redoPiece();
        else recordAgain();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    start, stopRecording, skipPlayback, accept, recordAgain, hear, replaySentence, sourceLang, cut, nextPiece, redoPiece,
  ]);

  const getPlayhead = useCallback(() => {
    const el = playbackRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return 0;
    return Math.min(1, el.currentTime / el.duration);
  }, []);

  // A tapped line hands the keys straight back to the stage, so the next Space
  // is still the rung's rather than a second press of the line.
  const tapToHear = (language) => () => {
    hear(language);
    rootRef.current?.focus?.({ preventScroll: true });
  };
  // The Pause tile is the touch twin of →; it hands the keys back the same way.
  const tapToCut = () => {
    cut();
    rootRef.current?.focus?.({ preventScroll: true });
  };
  const inPieces = piece != null;
  // Mirrors what `cut` accepts: the sentence itself, open-ended (the whole of
  // it, or the rest after the last cut), on a sentence that may still be cut.
  const cutOffered = phase === 'prompting' && !noPiecesRef.current
    && sounding?.language === targetLang && sounding?.endMs == null;
  const lastPiece = inPieces && isLast(piecesRef.current, piece);
  const hasTake = phase === 'playback' || phase === 'review';
  const keysHint = inPieces && hasTake
    ? `Space: ${lastPiece ? 'finish' : 'next part'} · Tab: compare · Backspace: redo this part`
    : hasTake
      ? 'Space: go · Tab: compare with the sentence · Shift+Tab: hear the meaning · Backspace: record again'
      : `Space: go · Tab: hear it again · Shift+Tab: hear the meaning · Backspace: record again${
        cutOffered ? ' · →: pause here' : ''}`;

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

      {inPieces && (phase === 'playback' || phase === 'review') && (
        <p className="lang-rung__part">Part {piece + 1}</p>
      )}
      <div className="lang-rung__controls">
        {phase === 'idle' && (
          <button type="button" className="lang-tile lang-tile--primary" onClick={start} aria-label="Listen, then record">
            <Icon name="record" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Record</span>
          </button>
        )}
        {/* Sounding — the sentence and its ding, or the take. Not a control:
            the same tile, quiet, so the stage does not rearrange itself. */}
        {(phase === 'prompting' || phase === 'playback') && (
          <span className="lang-tile lang-tile--status" role="status" aria-label={phase === 'prompting' ? 'Listen' : 'Playing your recording'}>
            <Icon name="volume" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">{phase === 'prompting' ? 'Listen' : 'Playing'}</span>
          </span>
        )}
        {/* RECORDING IN PIECES: "that's enough — let me say this much". Only
            while a cuttable part of the sentence is sounding. */}
        {cutOffered && (
          <button type="button" className="lang-tile" onClick={tapToCut} aria-label="Pause here">
            <Icon name="stop" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Pause</span>
          </button>
        )}
        {phase === 'joining' && (
          <span className="lang-tile lang-tile--status" role="status" aria-label="Putting it together">
            <Icon name="volume" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Joining</span>
          </span>
        )}
        {phase === 'recording' && (
          <button type="button" className="lang-tile lang-tile--live" onClick={stopRecording} aria-label="Stop">
            <Icon name="stop" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Stop</span>
          </button>
        )}
        {phase === 'review' && inPieces && (
          <>
            {/* A PIECE, not the take: Again redoes this part only, and the
                primary tile goes on to the rest — or, after the last part,
                joins them. A refused part goes nowhere, as a refused take. */}
            <button
              type="button"
              className={`lang-tile${takeVerdict ? ' lang-tile--primary' : ''}`}
              onClick={redoPiece}
              aria-label="Redo this part"
            >
              <Icon name="record-again" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">Again</span>
            </button>
            <button
              type="button"
              className={`lang-tile${takeVerdict ? '' : ' lang-tile--primary'}`}
              onClick={nextPiece}
              disabled={Boolean(takeVerdict)}
              aria-label={lastPiece ? 'Finish' : 'Next part'}
            >
              <Icon name="keep" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">{lastPiece ? 'Finish' : 'Next'}</span>
            </button>
          </>
        )}
        {phase === 'review' && !inPieces && (
          <>
            {/* WHICH TILE IS PRIMARY FOLLOWS THE TAKE. A refused take means the
                only thing to do is go again, so Again leads and Keep is
                disabled outright — the rung does not move on something that was
                not said. The way past a dead mic is the device-level escape in
                the notice above, not a quiet take. */}
            <button
              type="button"
              className={`lang-tile${takeVerdict ? ' lang-tile--primary' : ''}`}
              onClick={recordAgain}
              aria-label="Record again"
            >
              <Icon name="record-again" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">Again</span>
            </button>
            <button
              type="button"
              className={`lang-tile${takeVerdict ? '' : ' lang-tile--primary'}`}
              onClick={accept}
              disabled={saving || Boolean(takeVerdict)}
              aria-label={saving ? 'Saving' : 'Keep it'}
            >
              <Icon name="keep" className="lang-tile__glyph" />
              <span className="lang-tile__word" aria-hidden="true">{saving ? 'Saving…' : 'Keep'}</span>
            </button>
          </>
        )}
      </div>
      {/* The keys, where there are keys to press. A touch panel is not told
          about a Tab it does not have. */}
      {showShortcuts && (
        <p className="lang-rung__keys" aria-hidden="true">
          {keysHint}
        </p>
      )}
    </div>
  );
}
