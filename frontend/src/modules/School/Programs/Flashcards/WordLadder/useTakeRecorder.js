import { useCallback, useEffect, useRef, useState } from 'react';
import useVoiceCapture from '../../SentenceLadder/rungs/useVoiceCapture.js';
import { SILENT_LEVEL, judgeTake } from '../../shared/speechFloor.js';

/**
 * One word-ladder take: record, judge against the shared speech floor
 * (`shared/speechFloor.js` — the same floor Sentence Ladder's recording rung
 * uses), and hand a KEPT take's blob to the caller. Wraps
 * `SentenceLadder/rungs/useVoiceCapture.js`, which owns the mic itself
 * (opened only for the take, released the moment it ends).
 *
 * SPEAKING IS NEVER A GATE (spec §3, §6): a refused take never calls
 * `onTake` and never disables anything — the item's own Next/Skip stays
 * enabled throughout (that discipline lives in the item, not here). This
 * hook's only job is: was there a take worth keeping, and here it is.
 *
 * `judgeTake` needs a live loudness sample to refuse on `too-quiet`
 * (`WE ONLY REFUSE ON WHAT WE COULD MEASURE` — see speechFloor.js), so the
 * caller must feed the returned `onLevel(level)` into a `VoiceBand`'s
 * `onLevel` prop while `phase === 'recording'`. A caller that renders no
 * band still gets the length floor (`too-short`), just never `too-quiet`.
 */
export default function useTakeRecorder({ onTake } = {}) {
  const [phase, setPhase] = useState('idle'); // idle | recording | saving
  const [verdict, setVerdict] = useState(null);

  const silenceRef = useRef({ heard: false, sampled: false });
  const handlerRef = useRef(onTake);
  handlerRef.current = onTake;
  // False once the caller has unmounted. A take STOPPED just before unmount
  // (Stop, then Next) is no longer "recording", so `cancel()` cannot mark it
  // — but MediaRecorder still fires `onstop` afterwards. Without this guard
  // that late take would reach a dead item: a stale upload, playback over the
  // next item, and an object URL nobody revokes.
  const liveRef = useRef(true);

  const receiveTake = useCallback(({ blob, durationMs }) => {
    if (!liveRef.current) return;
    const { heard, sampled } = silenceRef.current;
    const result = judgeTake({ heard, sampled: sampled === true, durationMs });
    setVerdict(result);
    setPhase('idle');
    // A refused take is never handed on — see the module doc above.
    if (!result) handlerRef.current?.({ blob, durationMs });
  }, []);

  const onDenied = useCallback(() => {
    setPhase('idle');
  }, []);

  const {
    start: startCapture, stop: stopCapture, cancel, release, stream,
  } = useVoiceCapture({ onTake: receiveTake, onDenied });

  const start = useCallback(async () => {
    setVerdict(null);
    silenceRef.current = { heard: false, sampled: false };
    const started = await startCapture();
    if (started) setPhase('recording');
  }, [startCapture]);

  const stop = useCallback(() => {
    setPhase('saving');
    stopCapture();
  }, [stopCapture]);

  /** Fed by a `VoiceBand`'s `onLevel` while recording (0..1, shaped). */
  const onLevel = useCallback((level) => {
    const s = silenceRef.current;
    s.sampled = true;
    if (level >= SILENT_LEVEL) s.heard = true;
  }, []);

  // A take in progress when the caller unmounts (a new item arrived, the
  // learner left) is thrown away, not delivered — half a take is not a take.
  // The live flag drops first so a late `onstop` (see liveRef) is ignored too.
  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; cancel(); };
  }, [cancel]);

  return {
    start, stop, phase, verdict, stream, onLevel, release,
  };
}
