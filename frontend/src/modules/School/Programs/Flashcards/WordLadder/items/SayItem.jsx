import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import VoiceBand from '../../../SentenceLadder/rungs/VoiceBand.jsx';
import { FitText } from '../FitText.jsx';
import { playClip, playSequence } from '../wordLadderAudio.js';
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
  item, mode, langs, resolveAssetUrl, onRespond, api, sittingId, userId, busy = false,
}) {
  const [hasTaken, setHasTaken] = useState(false);
  const [notice, setNotice] = useState(null);
  // { term, audio } once `saveRecording`'s `reveal` lands — the ONLY source of
  // the term for say-from-cue, and of the native clip for read-aloud/say-from-cue.
  const [revealed, setRevealed] = useState(null);
  const takeUrlRef = useRef(null);

  const word = item.word ?? null;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
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
      wordLadderLog.recordingUploaded({ itemId: item.id, mode, bytes: blob.size, durationMs });
      if (data?.reveal) {
        const audio = data.reveal.audio ? resolveAssetUrl(data.reveal.audio) : null;
        setRevealed({ term: data.reveal.term, audio });
        nativeAudio = audio;
      }
    } else {
      // An upload failure is logged and never blocks — the take was still
      // said and heard; only the grown-up review copy (and, for
      // read-aloud/say-from-cue, the reveal) is missing.
      wordLadderLog.recordingFailed({ itemId: item.id, mode, status });
      if (mode !== 'say-after') nativeAudio = null;
    }

    // Own take, then the native word — never the other order (spec §1 1.2).
    await playSequence([{ url: takeUrl, kind: 'take' }, ...(nativeAudio ? [{ url: nativeAudio, kind: 'term' }] : [])]);
  }, [api, sittingId, userId, item.id, mode, termAudio, resolveAssetUrl]);

  const recorder = useTakeRecorder({ onTake });

  // Mount-only (WordLadderProgram keys each item to a fresh instance, so
  // item.id never changes within one SayItem's life — this is really
  // "on arrival" / "on the way out", not "on every item change"). The
  // cleanup revokes whatever take URL is still held when the item leaves —
  // not only when a NEXT take within this same item replaces it.
  useEffect(() => {
    if (mode === 'say-after' && termAudio) playClip(termAudio, 'term');
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio, 'gloss');
    return () => {
      if (takeUrlRef.current) { URL.revokeObjectURL(takeUrlRef.current); takeUrlRef.current = null; }
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recorder.verdict) return;
    wordLadderLog.recordingRefused({ itemId: item.id, mode, reason: recorder.verdict });
    wordLadderLog.noticeShown({ itemId: item.id, mode, reason: recorder.verdict });
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

  const showCue = mode === 'say-from-cue';
  // say-after/read-aloud already carry the term; say-from-cue only ever
  // learns it from `reveal` — never render it a moment earlier than that.
  const term = showCue ? revealed?.term ?? null : word?.term ?? null;
  const recording = recorder.phase === 'recording';
  const saving = recorder.phase === 'saving';

  return (
    <section className="wl-item wl-say" aria-label="Say it">
      <div className="wl-prompt">
        {showCue && item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {showCue && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {showCue && item.cue?.type === 'audio' && (
          <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio, 'gloss')}><Icon name="volume" /> Listen</TouchButton>
        )}
        {term && <FitText role="term" text={term} lang={langs.term} />}
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
