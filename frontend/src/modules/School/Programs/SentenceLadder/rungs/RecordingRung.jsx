import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import Icon from '../../../home/icons/Icon.jsx';
import VoiceBand from './VoiceBand.jsx';

/**
 * Recording — say it yourself (design §1).
 *
 * One gesture, then the rung runs itself until the learner has spoken:
 *
 *   tap / Space ─▶ the sentence sounds ─▶ the ding ─▶ the mic is live
 *   tap / Space ─▶ the take plays straight back ─▶ Keep it, or Record again
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
  entry, audioUrl, cueUrl = null, onComplete, saving, onDisableMicrophone,
}) {
  // idle → prompting → recording → playback → review
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [stream, setStream] = useState(null);
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
  const takeStartedAtRef = useRef(0);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const blobRef = useRef(null);
  const takeUrlRef = useRef(null);
  const playbackRef = useRef(null);
  const unbindPlaybackRef = useRef(null);
  const silenceRef = useRef({ since: null, heard: false, sampled: false });
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const rootRef = useRef(null);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStream(null);
  }, []);

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

  const beginCapture = useCallback(async () => {
    setError(null);
    setSilent(false);
    setTakeVerdict(null);
    silenceRef.current = { since: null, heard: false, sampled: false };
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mic;
      chunksRef.current = [];

      const recorder = new MediaRecorder(mic);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        blobRef.current = blob;
        if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
        takeUrlRef.current = URL.createObjectURL(blob);
        // Release the mic between takes rather than holding it for the whole
        // session — on a shared kiosk another app may need it.
        releaseMic();
        const durationMs = Date.now() - takeStartedAtRef.current;
        const heard = silenceRef.current.heard;
        languageLog.capture('stop', { seq: entry.seq, bytes: blob.size, heard, durationMs });
        // The same facts the log has always carried, now also enforced.
        // WE ONLY REFUSE ON WHAT WE COULD MEASURE. `heard` comes from a live
        // level meter that needs an AudioContext; a browser without one reports
        // no levels at all and the band just stays a baseline. There, `heard`
        // is false for every take ever made, and refusing on it would lock the
        // rung shut on a device where nothing is wrong. So loudness is only
        // judged when a level actually arrived; length is judged always.
        const measurable = silenceRef.current.sampled === true;
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

        // Straight into hearing it. The Stop tap is the gesture behind this
        // play(), so autoplay policy is satisfied; if it still refuses, the
        // review controls appear and nothing is lost but the listen.
        setPhase('playback');
        const el = new Audio(takeUrlRef.current);
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
        decodeTake(blob).then((samples) => { if (blobRef.current === blob) setTake(samples); });
      };

      recorder.start();
      takeStartedAtRef.current = Date.now();
      setStream(mic);
      setPhase('recording');
      languageLog.capture('start', { seq: entry.seq });
    } catch (err) {
      // MediaRecorder construction/start can fail after getUserMedia succeeds.
      // Release that already-open stream on every failure path.
      releaseMic();
      languageLog.captureError('denied', { seq: entry.seq, error: err?.message });
      // The old copy told the learner to "skip this one" — and no skip existed
      // anywhere in this component, so a denied mic stranded the recording
      // badge forever pointing at a control that was never built. The real
      // escape hatch is the ladder's own: drop the rung from this device and
      // sentences graduate across the gap.
      setError('The microphone is unavailable on this device.');
      setPhase('idle');
    }
  }, [entry.seq, releaseMic]);

  // The prompt plays, then the ding, then recording begins — one sequence,
  // one gesture. The learner shouldn't have to hunt for a second button
  // between hearing and speaking.
  const { playSequence, stop, blocked } = useSentenceAudio({ onSequenceEnd: beginCapture });

  useEffect(() => {
    setPhase('idle');
    setError(null);
    languageLog.rung('enter', { rung: 'recording', seq: entry.seq });
    // Take the keyboard on arrival. The tap that brought the child here — the
    // ladder's Recording step, the previous sentence's Keep — leaves focus on
    // THAT control, and a Space pressed there would re-press it, not start
    // this. The stage itself is the thing the keys belong to now.
    rootRef.current?.focus?.({ preventScroll: true });
    return () => {
      stop();
      stopPlayback();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      takeUrlRef.current = null;
    };
  }, [entry.seq, stop, stopPlayback]);

  const cue = useCallback(() => (cueUrl ? [{ url: cueUrl, role: 'cue' }] : []), [cueUrl]);

  const start = useCallback(() => {
    dropTake();
    setPhase('prompting');
    playSequence([...clipsFor(entry, audioUrl), ...cue()]);
  }, [entry, audioUrl, cue, playSequence, dropTake]);

  // Again means the ding and the mic — not the whole sentence over. Hearing
  // the prompt again is what the Repetition rung is for, and a retry that is
  // slower than the first attempt is backwards.
  const recordAgain = useCallback(() => {
    stopPlayback();
    dropTake();
    setTakeVerdict(null);
    setPhase('prompting');
    languageLog.capture('retake', { seq: entry.seq });
    playSequence(cue());
  }, [entry.seq, cue, playSequence, stopPlayback, dropTake]);

  useEffect(() => {
    if (!blocked || phase !== 'prompting') return;
    stop();
    setPhase('idle');
  }, [blocked, phase, stop]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

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
      const go = e.key === ' ' || e.key === 'Enter';
      const again = e.key === 'Backspace';
      if (!go && !again) return;
      if (ownsKeys(e.target)) return;
      const current = phaseRef.current;
      if (go) {
        if (current === 'idle') { e.preventDefault(); start(); }
        else if (current === 'recording') { e.preventDefault(); stopRecording(); }
        else if (current === 'playback') { e.preventDefault(); skipPlayback(); }
        else if (current === 'review') { e.preventDefault(); accept(); }
        return;
      }
      if (current === 'playback' || current === 'review') { e.preventDefault(); recordAgain(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, stopRecording, skipPlayback, accept, recordAgain]);

  const getPlayhead = useCallback(() => {
    const el = playbackRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return 0;
    return Math.min(1, el.currentTime / el.duration);
  }, []);

  const targetLang = entry.prompt?.[0]?.language;

  return (
    <div ref={rootRef} tabIndex={-1} className={`lang-rung lang-rung--recording is-${phase}`}>
      <p className="lang-rung__target">{entry.text?.[targetLang]}</p>

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
            : 'That was too quick — say the whole sentence.'}</p>
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
        {phase === 'recording' && (
          <button type="button" className="lang-tile lang-tile--live" onClick={stopRecording} aria-label="Stop">
            <Icon name="stop" className="lang-tile__glyph" />
            <span className="lang-tile__word" aria-hidden="true">Stop</span>
          </button>
        )}
        {phase === 'review' && (
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
    </div>
  );
}
