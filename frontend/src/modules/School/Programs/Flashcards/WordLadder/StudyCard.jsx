import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../home/icons/Icon.jsx';
import VoiceBand from '../../SentenceLadder/rungs/VoiceBand.jsx';
import useVoiceCapture from '../../SentenceLadder/rungs/useVoiceCapture.js';
import { SILENT_LEVEL, judgeTake } from '../../shared/speechFloor.js';
import { playClip, playSequence } from './wordLadderAudio.js';
import { wordLadderLog } from './wordLadderLog.js';

/** Picture, Korean, native audio. Anything missing is simply not drawn. */
export function WordFace({ card, resolveAssetUrl }) {
  return (
    <div className="word-ladder-face">
      {card.media?.image && <img className="word-ladder-picture" src={resolveAssetUrl(card.media.image)} alt={card.english} />}
      <p className="word-ladder-korean" lang="ko">{card.korean}</p>
      {card.media?.audio && (
        <button type="button" className="word-ladder-hear" onClick={() => playClip(resolveAssetUrl(card.media.audio))}>
          <Icon name="volume" /> Hear it
        </button>
      )}
    </div>
  );
}

const VERDICT_COPY = {
  'too-quiet': "I couldn't hear you — say it out loud.",
  'too-short': 'Say the whole word, then stop.',
};

/**
 * One study card: front plays ko.mp3; record (when the mic is available) →
 * the take plays back, then the native audio; flip to English; mark.
 * `reviewOnly` is the rev-3 review run: flip and move on, nothing else.
 */
export default function StudyCard({
  card, needsRecording = false, resolveAssetUrl = (id) => id, onRecorded = async () => false,
  onMark = async () => {}, onMicUnavailable = () => {}, reviewOnly = false, onNext = () => {},
}) {
  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | recording | saving
  const [recorded, setRecorded] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const levels = useRef({ heard: false, sampled: false });
  const nativeUrl = card.media?.audio ? resolveAssetUrl(card.media.audio) : null;

  useEffect(() => {
    setFlipped(false); setPhase('idle'); setRecorded(false); setVerdict(null); setBusy(false);
    if (nativeUrl) playClip(nativeUrl);
  // Reset once per card; nativeUrl is derived from the same card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.wordId]);

  const onTake = useCallback(async ({ blob, durationMs }) => {
    const takeVerdict = judgeTake({ heard: levels.current.heard, sampled: levels.current.sampled, durationMs });
    if (takeVerdict) {
      setVerdict(takeVerdict); setPhase('idle');
      wordLadderLog.recordingRefused({ wordId: card.wordId, reason: takeVerdict, durationMs, bytes: blob?.size ?? null });
      return;
    }
    setVerdict(null); setPhase('saving');
    const ok = await onRecorded(blob);
    setPhase('idle');
    if (!ok) return;
    setRecorded(true);
    const takeUrl = URL.createObjectURL(blob);
    await playSequence([takeUrl, nativeUrl].filter(Boolean));
    URL.revokeObjectURL(takeUrl);
  }, [card.wordId, nativeUrl, onRecorded]);

  const onDenied = useCallback((error) => {
    setPhase('idle');
    onMicUnavailable(error?.name || 'denied');
  }, [onMicUnavailable]);

  const { start, stop, stream } = useVoiceCapture({ onTake, onDenied });
  const onLevel = useCallback((level) => {
    levels.current.sampled = true;
    if (level >= SILENT_LEVEL) levels.current.heard = true;
  }, []);
  const beginRecording = async () => {
    levels.current = { heard: false, sampled: false };
    setVerdict(null);
    if (await start()) setPhase('recording');
  };
  const mark = async (value) => {
    if (busy) return;
    setBusy(true);
    await onMark(value);
    setBusy(false);
  };
  const showRecorder = !reviewOnly && needsRecording && !recorded && !flipped;
  const canFlip = reviewOnly || !needsRecording || recorded;

  return (
    <section className="word-ladder-card word-ladder-study" aria-label={reviewOnly ? 'Review card' : 'Study card'}>
      {flipped ? (
        <div className="word-ladder-back">
          <p className="word-ladder-english">{card.english}</p>
          {card.pronunciation && <p className="word-ladder-pronunciation">{card.pronunciation}</p>}
        </div>
      ) : <WordFace card={card} resolveAssetUrl={resolveAssetUrl} />}
      {showRecorder && (
        <div className="word-ladder-record">
          <VoiceBand stream={phase === 'recording' ? stream : null} onLevel={phase === 'recording' ? onLevel : null} />
          {phase === 'recording' ? (
            <button type="button" onClick={() => stop()}><Icon name="stop" /> Stop</button>
          ) : (
            <button type="button" disabled={phase === 'saving'} onClick={beginRecording}>
              <Icon name={verdict ? 'record-again' : 'record'} /> {verdict ? 'Record again' : 'Record'}
            </button>
          )}
          {verdict && <p role="status">{VERDICT_COPY[verdict]}</p>}
        </div>
      )}
      {!flipped && canFlip && <button type="button" className="word-ladder-flip" onClick={() => setFlipped(true)}>Flip</button>}
      {flipped && !reviewOnly && (
        <div className="word-ladder-marks">
          <button type="button" disabled={busy} onClick={() => mark('know')}><Icon name="keep" /> I know it</button>
          <button type="button" disabled={busy} onClick={() => mark('learning')}>Still learning</button>
        </div>
      )}
      {flipped && reviewOnly && <button type="button" onClick={onNext}><Icon name="next" /> Next card</button>}
    </section>
  );
}
