import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import VoiceBand from '../../../SentenceLadder/rungs/VoiceBand.jsx';
import { FitText } from '../FitText.jsx';
import { playClip, playSequence } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';
import { currentInput } from '../inputVia.js';
import useTakeRecorder from '../useTakeRecorder.js';
import EnglishCue, { englishCueAudio } from './EnglishCue.jsx';

/**
 * 1.2 say-after · 1.3 read-aloud · 3.4 say-from-cue (task catalogue §3).
 * SPEAKING IS NEVER GRADED AND NEVER A GATE: Next/Skip is available from the
 * moment the card is shown, whatever `onRespond` is called it always sends
 * `{done:true}` — a take is never required, only offered.
 *
 * What the child sees before a take differs by mode, and it follows what the
 * SERVER actually sent (`WordLadderSittingService#publicItem`) — not just a
 * local "don't render it yet":
 *   say-after     the item carries the full word (`item.word.media.audio`),
 *                 so the native audio plays once on arrival ("see and hear
 *                 it, then say it"). `saveRecording` returns no `reveal` for
 *                 this mode — nothing to reveal, it was already known.
 *   read-aloud    the item carries `item.word.term` but `media` is all null
 *                 — no audio until the take is in.
 *   say-from-cue  the item carries NO `word` at all, only the cue. The term
 *                 is learned for the first time from the take's response
 *                 (`reveal.term`/`reveal.audio`), which is the whole point:
 *                 reading it off the card can't stand in for recalling it.
 *
 * After a KEPT take, `api.uploadRecording` is awaited. On success its
 * `reveal` (when present) is what unlocks read-aloud/say-from-cue's native
 * audio and, for say-from-cue, the term text itself — there is no other copy
 * of either on this device before that response lands. On failure nothing is
 * revealed (logged, never blocking) — but say-after already knew its own
 * native audio locally, so its playback is unaffected by the upload's fate.
 * Either way the take itself always plays.
 */
export default function SayItem({
  item, mode, langs, resolveAssetUrl, onRespond, api, sittingId, userId, busy = false, onLayout,
}) {
  const [hasTaken, setHasTaken] = useState(false);
  const [notice, setNotice] = useState(null);
  // { term, audio } once `saveRecording`'s `reveal` lands — the ONLY source of
  // the term for say-from-cue, and of the native clip for read-aloud/say-from-cue.
  const [revealed, setRevealed] = useState(null);
  const takeUrlRef = useRef(null);
  // spec §8 say.recording `ms`: time since this say step appeared.
  const shownAtRef = useRef(Date.now());
  const logTake = useCallback((phase, extra = {}) => {
    // `itemMode`, not `mode` — the trace stamp overwrites a colliding `mode` key.
    wordLadderLog.sayRecording({ itemId: item.id, itemMode: mode, phase, ms: Date.now() - shownAtRef.current, ...extra });
  }, [item.id, mode]);

  const word = item.word ?? null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  // Known upfront only when the server sent it (say-after; null on read-aloud).
  const termAudio = word?.media?.audio ? resolveAssetUrl(word.media.audio) : null;

  const onTake = useCallback(async ({ blob, durationMs }) => {
    setHasTaken(true);
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    const takeUrl = URL.createObjectURL(blob);
    takeUrlRef.current = takeUrl;

    const { ok, status, data } = await api.uploadRecording(sittingId, { userId, itemId: item.id, blob });

    // say-after already has its own native audio; read-aloud/say-from-cue have
    // none until `reveal` says otherwise — and only ON A SUCCESSFUL upload,
    // since that response is the only place either ever comes from.
    let nativeAudio = termAudio;
    if (ok) {
      logTake('uploaded', { bytes: blob.size, durationMs });
      if (data?.reveal) {
        const audio = data.reveal.audio ? resolveAssetUrl(data.reveal.audio) : null;
        setRevealed({ term: data.reveal.term, audio });
        nativeAudio = audio;
      }
    } else {
      // An upload failure is logged and never blocks — the take was still
      // said and heard; only the grown-up review copy (and, for
      // read-aloud/say-from-cue, the reveal) is missing.
      logTake('failed', { status, durationMs });
      if (mode !== 'say-after') nativeAudio = null;
    }

    // Own take, then the native word — never the other order (spec §1 1.2).
    await playSequence([{ url: takeUrl, kind: 'take' }, ...(nativeAudio ? [{ url: nativeAudio, kind: 'term' }] : [])], { trigger: 'auto' });
  }, [api, sittingId, userId, item.id, mode, termAudio, resolveAssetUrl, logTake]);

  const recorder = useTakeRecorder({ onTake });

  // started / stopped from the recorder's own phase, so a key, a touch and
  // the Stop button all land here once (spec §8 say.recording).
  const lastPhaseRef = useRef(recorder.phase);
  useEffect(() => {
    const was = lastPhaseRef.current;
    lastPhaseRef.current = recorder.phase;
    if (was === recorder.phase) return;
    if (recorder.phase === 'recording') logTake('started', { via: currentInput() });
    else if (was === 'recording') logTake('stopped', { via: currentInput() });
  }, [recorder.phase, logTake]);

  // Mount-only (WordLadderProgram keys each item to a fresh instance, so
  // item.id never changes within one SayItem's life — this is really
  // "on arrival" / "on the way out", not "on every item change"). The
  // cleanup revokes whatever take URL is still held when the item leaves —
  // not only when a NEXT take within this same item replaces it.
  useEffect(() => {
    if (mode === 'say-after' && termAudio) playClip(termAudio, 'term', { trigger: 'auto' });
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio, 'gloss', { trigger: 'auto' });
    return () => {
      if (takeUrlRef.current) { URL.revokeObjectURL(takeUrlRef.current); takeUrlRef.current = null; }
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recorder.verdict) return;
    logTake('refused', { reason: recorder.verdict });
    wordLadderLog.noticeShown({ itemId: item.id, itemMode: mode, reason: recorder.verdict });
    setNotice(recorder.verdict === 'too-quiet'
      ? "We didn't hear that one — say it out loud and have another go."
      : 'That was too quick — say the whole word.');
  }, [recorder.verdict, item.id, mode, logTake]);

  const record = useCallback(() => {
    setNotice(null);
    if (recorder.phase === 'recording') recorder.stop();
    else recorder.start();
  }, [recorder]);

  const next = useCallback(() => {
    if (busy) return;
    // A Skip — moving on with no take — is logged apart from a Next after
    // one, with how it was pressed (spec §8 item.skipped). Never graded either way.
    if (!hasTaken) {
      wordLadderLog.itemSkipped({
        itemId: item.id, type: item.type, what: 'say', itemMode: mode, via: currentInput(),
        ms: Date.now() - shownAtRef.current, micOff: recorder.unavailable === true,
      });
    }
    onRespond({ done: true });
  }, [busy, onRespond, hasTaken, item.id, mode, recorder.unavailable]);

  const showCue = mode === 'say-from-cue';
  // say-after/read-aloud already carry the term; say-from-cue only ever
  // learns it from `reveal` — never render it a moment earlier than that.
  const term = showCue ? revealed?.term ?? null : word?.term ?? null;
  const recording = recorder.phase === 'recording';
  const saving = recorder.phase === 'saving';
  // No mic (none, refused, or it errored on start): a take is impossible, so
  // Space must not point at Record — it falls through to Skip. Never a dead end.
  const micOff = recorder.unavailable === true;
  useEffect(() => {
    if (micOff) logTake('unavailable');
  }, [micOff, logTake]);

  /*
   * THE KEY MAP (owner, binding): Space is the forward action and NEVER a skip.
   *   before a take     Space/Enter = Record
   *   while recording   Space/Enter = Stop
   *   saving            Space/Enter = nothing (a beat; the take is landing)
   *   after a take      Space/Enter = Next;  ← = Record again
   *   mic unavailable   Space/Enter = Skip/Next
   * Skip is a touch; its only key is Backslash, which has to be hunted for.
   * Tab = hear the cue again (never while the mic is open).
   */
  let spaceOwner = 'none';
  if (recording) spaceOwner = 'stop';
  else if (saving) spaceOwner = 'none';
  else if (hasTaken || micOff) spaceOwner = 'next';
  else spaceOwner = 'record';
  const forward = () => {
    if (spaceOwner === 'stop') recorder.stop();
    else if (spaceOwner === 'record') { if (!busy) record(); }
    else if (spaceOwner === 'next') next();
  };
  const canRecordAgain = hasTaken && !recording && !saving && !micOff;
  const cueClip = showCue ? englishCueAudio(item, resolveAssetUrl) : null;
  const hearCue = cueClip ? () => playClip(cueClip, 'gloss') : null; // trigger: the key/touch that asked
  useWordLadderKeys({
    ' ': forward,
    enter: forward,
    '\\': next,
    ...(canRecordAgain ? { arrowleft: () => { if (!busy) record(); } } : {}),
    ...(hearCue && !recording && !saving ? { tab: hearCue } : {}),
  });

  return (
    <section className="wl-item wl-say" aria-label="Say it">
      <div className="wl-prompt">
        {showCue && <EnglishCue item={item} resolveAssetUrl={resolveAssetUrl} lang={langs.gloss} />}
        {term && <FitText role="term" text={term} lang={langs.term} onFit={onLayout} />}
      </div>

      <VoiceBand
        stream={recording ? recorder.stream : null}
        onLevel={recording ? recorder.onLevel : null}
      />

      {notice && (
        <p className="wl-say__notice" role="alert">{notice}</p>
      )}

      <div className="wl-controls">
        {!recording && !saving && (
          <TouchButton
            variant={spaceOwner === 'record' ? 'primary' : 'secondary'}
            keyHint={spaceOwner === 'record' ? 'Space' : canRecordAgain ? '←' : undefined}
            onClick={record}
            disabled={busy}
          >
            <Icon name="record" /> {hasTaken ? 'Record again' : 'Record'}
          </TouchButton>
        )}
        {recording && (
          <TouchButton variant="primary" keyHint="Space" onClick={record}>
            <Icon name="stop" /> Stop
          </TouchButton>
        )}
        {saving && (
          <span className="ds-touch ds-touch--secondary" role="status" aria-label="Saving">
            <Icon name="volume" /> Saving…
          </span>
        )}
        {/* SPEAKING IS NEVER A GATE: this is enabled from the first render —
            "Skip" before any take, "Next" once one exists — never disabled by
            recording state. Space only lands here after a take (or with no
            mic); otherwise its key is the hunted-for Backslash. */}
        <TouchButton
          variant={spaceOwner === 'next' ? 'primary' : 'secondary'}
          keyHint={spaceOwner === 'next' ? 'Space' : '\\'}
          onClick={next}
          disabled={busy}
        >
          {hasTaken ? 'Next' : 'Skip'}
        </TouchButton>
      </div>
    </section>
  );
}
