import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import VoiceBand from '../../../SentenceLadder/rungs/VoiceBand.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';
import useTakeRecorder from '../useTakeRecorder.js';
import CuePicture from './CuePicture.jsx';

/**
 * 1.2 say-after · 1.3 read-aloud · 3.4 say-from-cue (task catalogue §3).
 * SPEAKING IS NEVER GRADED AND NEVER A GATE: Next/Skip is available from the
 * moment the card is shown, whatever `onRespond` is called it always sends
 * `{done:true}` — a take is never required, only offered.
 *
 * What the child sees before a take differs by mode:
 *   say-after     the term + its native audio (played once on arrival — "see
 *                 and hear it, then say it").
 *   read-aloud    the term only — no audio until the take is in.
 *   say-from-cue  the cue only — the term is NOT shown until after a take,
 *                 so reading it off the card can't stand in for recalling it.
 *
 * After ANY take (kept or not attempted-again): the take plays back, then the
 * native term audio if the word has one — and for say-from-cue this is also
 * the moment the term itself is revealed, so the child compares what they
 * said against the real word right after saying it.
 */
export default function SayItem({
  item, mode, langs, resolveAssetUrl, onRespond, api, sittingId, userId, busy = false,
}) {
  const [hasTaken, setHasTaken] = useState(false);
  const [notice, setNotice] = useState(null);
  const takeUrlRef = useRef(null);

  const word = item.word ?? null;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  const termAudio = (item.assets?.audio ? resolveAssetUrl(item.assets.audio) : null)
    ?? (word?.media?.audio ? resolveAssetUrl(word.media.audio) : null);

  const onTake = useCallback(async ({ blob, durationMs }) => {
    setHasTaken(true);
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    const takeUrl = URL.createObjectURL(blob);
    takeUrlRef.current = takeUrl;

    api.uploadRecording(sittingId, { userId, itemId: item.id, blob }).then(({ ok, status }) => {
      if (ok) wordLadderLog.recordingUploaded({ itemId: item.id, mode, bytes: blob.size, durationMs });
      // An upload failure is logged and never blocks — the take was still
      // said and heard; only the grown-up review copy is missing.
      else wordLadderLog.recordingFailed({ itemId: item.id, mode, status });
    });

    // Own take, then the native word — never the other order (spec §1 1.2).
    await playClip(takeUrl);
    if (termAudio) await playClip(termAudio);
  }, [api, sittingId, userId, item.id, mode, termAudio]);

  const recorder = useTakeRecorder({ onTake });

  useEffect(() => {
    setHasTaken(false);
    setNotice(null);
    if (takeUrlRef.current) { URL.revokeObjectURL(takeUrlRef.current); takeUrlRef.current = null; }
    // say-after: "see and hear it, then say it" — the native word plays once,
    // unprompted, on arrival. read-aloud and say-from-cue give no audio yet.
    if (mode === 'say-after' && termAudio) playClip(termAudio);
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recorder.verdict) return;
    wordLadderLog.recordingRefused({ itemId: item.id, mode, reason: recorder.verdict });
    setNotice(recorder.verdict === 'too-quiet'
      ? "We didn't hear that one — say it out loud and have another go."
      : 'That was too quick — say the whole word.');
  }, [recorder.verdict, item.id, mode]);

  const record = useCallback(() => {
    setNotice(null);
    if (recorder.phase === 'recording') recorder.stop();
    else recorder.start();
  }, [recorder]);

  const next = useCallback(() => { if (!busy) onRespond({ done: true }); }, [busy, onRespond]);

  useWordLadderKeys({ ' ': next, enter: next });

  // The term is never shown ahead of a take on say-from-cue — that is the
  // whole point of the mode. Every other mode shows it from the start.
  const showTerm = mode !== 'say-from-cue' || hasTaken;
  const showCue = mode === 'say-from-cue';
  const recording = recorder.phase === 'recording';
  const saving = recorder.phase === 'saving';

  return (
    <section className="wl-item wl-say" aria-label="Say it">
      <div className="wl-prompt">
        {showCue && item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {showCue && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {showCue && item.cue?.type === 'audio' && (
          <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio)}><Icon name="volume" /> Listen</TouchButton>
        )}
        {showTerm && word?.term && <FitText role="term" text={word.term} lang={langs.term} />}
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
          <TouchButton variant="secondary" onClick={record} disabled={busy}>
            <Icon name="record" /> {hasTaken ? 'Record again' : 'Record'}
          </TouchButton>
        )}
        {recording && (
          <TouchButton variant="secondary" onClick={record}>
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
            recording state. */}
        <TouchButton variant="primary" keyHint="Space" onClick={next} disabled={busy}>
          {hasTaken ? 'Next' : 'Skip'}
        </TouchButton>
      </div>
    </section>
  );
}
