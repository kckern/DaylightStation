import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { languageReelsApi } from './languageReelsApi.js';
import './LanguageReels.scss';

const ORDER = ['flashcards', 'listen', 'cloze', 'watch', 'comprehension', 'speaking'];
const LABELS = { flashcards: 'Prepare', listen: 'Listen', cloze: 'Fill the line', watch: 'Watch', comprehension: 'Understand', speaking: 'Speak your part' };
const asList = (value) => Array.isArray(value) ? value : [];
const source = (reel, key) => asList(reel?.authoring?.[key] ?? reel?.[key]);

function Media({ src, video = false, onEnded, mediaRef, muted = false }) {
  return <video ref={mediaRef} className={video ? 'language-reels__video' : 'language-reels__audio'} src={src} controls playsInline muted={muted} onEnded={onEnded} />;
}

function Cloze({ reel, mediaUrl, onDone, onAttempt }) {
  const items = source(reel, 'cloze'); const [index, setIndex] = useState(0); const [answer, setAnswer] = useState(null); const [wrong, setWrong] = useState(false);
  const item = items[index]; const line = asList(reel.transcript).find((cue) => cue.id === item?.lineId);
  const choices = useMemo(() => item ? [item.answer, ...asList(item.decoys)].sort(() => Math.random() - 0.5) : [], [item]);
  if (!items.length) return <StageNotice text="There are no reconstruction prompts for this reel." onDone={onDone} />;
  const select = (choice) => {
    onAttempt({ type: 'cloze', itemId: item.id ?? item.lineId, answer: choice, correct: choice === item.answer });
    if (choice !== item.answer) { setAnswer(choice); setWrong(true); return; }
    setAnswer(choice); setWrong(false);
    window.setTimeout(() => { if (index + 1 === items.length) onDone(); else { setIndex((n) => n + 1); setAnswer(null); } }, 450);
  };
  return <section className="language-reels__stage"><p className="language-reels__counter">Line {index + 1} of {items.length}</p><p className="language-reels__prompt">{item.prompt}</p>
    {line && <Media src={`${mediaUrl}#t=${line.startMs / 1000},${line.endMs / 1000}`} />}
    <div className="language-reels__choices">{choices.map((choice) => <button type="button" key={choice} className={`language-reels__choice ${answer === choice ? (wrong ? 'is-wrong' : 'is-right') : ''}`} onClick={() => select(choice)}>{choice}</button>)}</div>
    {wrong && <p className="language-reels__feedback">Not quite — listen again and try another answer.</p>}</section>;
}

function Comprehension({ reel, onDone, onAttempt }) {
  const items = source(reel, 'comprehension'); const [index, setIndex] = useState(0); const [answer, setAnswer] = useState(null);
  const item = items[index]; const choices = asList(item?.choices ?? item?.options);
  if (!items.length) return <StageNotice text="There are no comprehension questions for this reel." onDone={onDone} />;
  const correct = item.answer ?? item.correctAnswer;
  return <section className="language-reels__stage"><p className="language-reels__counter">Question {index + 1} of {items.length}</p><h3>{item.prompt ?? item.question}</h3><div className="language-reels__choices">{choices.map((choice) => <button type="button" key={choice} className={`language-reels__choice ${answer === choice ? (choice === correct ? 'is-right' : 'is-wrong') : ''}`} onClick={() => { onAttempt({ type: 'comprehension', itemId: item.id ?? String(index), answer: choice, correct: choice === correct }); setAnswer(choice); if (choice === correct) window.setTimeout(() => index + 1 === items.length ? onDone() : (setIndex((n) => n + 1), setAnswer(null)), 450); }}>{choice}</button>)}</div>{answer && answer !== correct && <p className="language-reels__feedback">Try again. Think about the whole scene.</p>}</section>;
}

function Speaking({ reel, mediaUrl, onDone }) {
  const segments = asList(reel?.authoring?.speaking?.segments); const [index, setIndex] = useState(0); const [recording, setRecording] = useState(false); const [take, setTake] = useState(null); const [error, setError] = useState(null); const recorder = useRef(null); const chunks = useRef([]); const stream = useRef(null); const preview = useRef(null); const scene = useRef(null); const replacement = useRef(null); const replacementStarted = useRef(false);
  const rawSegment = segments[index]; const line = asList(reel.transcript).find((cue) => cue.id === rawSegment?.lineId); const segment = { ...line, ...rawSegment }; const duration = rawSegment ? Math.max(0.25, (segment.endMs - segment.startMs) / 1000 * 1.25) : 0;
  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()); if (take) URL.revokeObjectURL(take); }, [take]);
  if (!segments.length) return <StageNotice text="Speaking is optional for this reel." onDone={onDone} />;
  const begin = async () => { try { setError(null); stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks.current = []; const capture = new MediaRecorder(stream.current); recorder.current = capture; capture.ondataavailable = (event) => event.data.size && chunks.current.push(event.data); capture.onstop = () => { stream.current?.getTracks().forEach((track) => track.stop()); const next = URL.createObjectURL(new Blob(chunks.current, { type: capture.mimeType || 'audio/webm' })); setTake((old) => { if (old) URL.revokeObjectURL(old); return next; }); setRecording(false); }; capture.start(); setRecording(true); } catch { setError('Microphone permission was not available. You can skip this optional step.'); } };
  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();
  const accept = () => index + 1 === segments.length ? onDone() : (setIndex((n) => n + 1), setTake(null));
  const hearInScene = () => {
    const player = scene.current; if (!player || !take) return;
    const before = Math.max(0, (segment.startMs - (segment.replacementPaddingMs?.before ?? 0)) / 1000);
    const after = (segment.endMs + (segment.replacementPaddingMs?.after ?? 0)) / 1000;
    player.currentTime = before; player.muted = false; replacementStarted.current = false;
    replacement.current = new Audio(take);
    replacement.current.onended = () => { player.muted = false; if (player.paused && player.currentTime >= after) player.play().catch(() => {}); };
    player.ontimeupdate = () => {
      if (player.currentTime < before || player.currentTime > after) return;
      player.muted = true;
      if (!replacementStarted.current) { replacementStarted.current = true; replacement.current.play().catch(() => {}); }
      // A take can run 25% long. Freeze the picture at the original line's
      // endpoint instead of cutting the learner off, then resume on audio end.
      if (player.currentTime >= after && !replacement.current.paused) player.pause();
    };
    player.play().catch(() => setError('Playback needs a tap to start. Try again.'));
  };
  return <section className="language-reels__stage"><p className="language-reels__prompt">{segment.prompt ?? segment.text}</p><p className="language-reels__hint">You may take up to {duration.toFixed(1)} seconds. This is participation, not pronunciation grading.</p><Media src={`${mediaUrl}#t=${segment.startMs / 1000},${segment.endMs / 1000}`} />
    {!take && <button type="button" className="lang-btn lang-btn--primary" onClick={recording ? stop : begin}>{recording ? 'Stop recording' : 'Record my line'}</button>}
    {recording && <p className="language-reels__recording">Recording…</p>}{take && <><audio ref={preview} controls src={take} /><video ref={scene} className="language-reels__video" src={mediaUrl} controls playsInline /><div className="language-reels__actions"><button type="button" className="lang-btn" onClick={hearInScene}>Hear it in the scene</button><button type="button" className="lang-btn" onClick={() => { URL.revokeObjectURL(take); setTake(null); }}>Record again</button><button type="button" className="lang-btn lang-btn--primary" onClick={accept}>Use this take</button></div></>}
    {error && <p className="language-reels__feedback">{error}</p>}<button type="button" className="lang-btn" onClick={onDone}>Skip speaking for this reel</button></section>;
}

function StageNotice({ text, onDone }) { return <section className="language-reels__stage"><p>{text}</p><button type="button" className="lang-btn lang-btn--primary" onClick={onDone}>Continue</button></section>; }

/** Standalone reel sequence; its session/grant never shares Sentence Ladder state. */
export default function LanguageReelsProgram({ userId, reelId, reelGrant, onExit }) {
  const [activity, setActivity] = useState(null); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [card, setCard] = useState(0); const [revealed, setRevealed] = useState(false); const [mediaComplete, setMediaComplete] = useState(false);
  const load = useCallback(async () => { const result = await languageReelsApi.open(userId, reelId, reelGrant); if (!result.ok) { setError(result.status === 403 ? 'This reel needs a current assignment.' : 'This reel could not open.'); return; } setActivity(result.data); setError(null); }, [userId, reelId, reelGrant]);
  useEffect(() => { load(); }, [load]);
  const stages = activity?.session?.stages ?? {}; const current = useMemo(() => ORDER.find((stage) => stages[stage] === false) ?? null, [stages]);
  useEffect(() => setMediaComplete(false), [current]);
  const advance = async () => { if (!current || saving) return; setSaving(true); const result = await languageReelsApi.stage(userId, reelId, current, reelGrant); setSaving(false); if (!result.ok) { setError('That step did not save. Try again.'); return; } setActivity((value) => ({ ...value, session: result.data })); };
  if (error) return <div className="lang-program lang-program--error"><p>{error}</p><button type="button" className="lang-btn" onClick={load}>Try again</button></div>;
  if (!activity) return <div className="lang-program lang-program--loading">Loading reel…</div>;
  const reel = activity.reel; const cards = asList(reel.vocabulary);
  const recordAttempt = (attempt) => { languageReelsApi.attempt(userId, reelId, reelGrant, attempt); };
  let body;
  if (current === 'flashcards') { const item = cards[card]; body = <section className="language-reels__stage"><p className="language-reels__counter">Card {card + 1} of {cards.length}</p><h3 className="language-reels__term">{item.term}</h3>{revealed && <><p>{item.definition}</p><p className="language-reels__example">{item.example_ko}</p><p className="language-reels__hint">{item.example_en}</p></>}{!revealed ? <button type="button" className="lang-btn lang-btn--primary" onClick={() => setRevealed(true)}>Reveal</button> : <button type="button" className="lang-btn lang-btn--primary" onClick={() => card + 1 === cards.length ? advance() : (setCard((n) => n + 1), setRevealed(false))}>{card + 1 === cards.length ? 'Start listening' : 'Next card'}</button>}</section>; }
  else if (current === 'listen' || current === 'watch') body = <section className="language-reels__stage"><p>{current === 'listen' ? 'Listen all the way through without looking at the video or transcript.' : 'Now watch the full scene.'}</p><Media src={activity.mediaUrl} video={current === 'watch'} onEnded={() => setMediaComplete(true)} /><button type="button" className="lang-btn lang-btn--primary" disabled={!mediaComplete || saving} onClick={advance}>{mediaComplete ? 'Continue' : 'Finish the reel to continue'}</button></section>;
  else if (current === 'cloze') body = <Cloze reel={reel} mediaUrl={activity.mediaUrl} onDone={advance} onAttempt={recordAttempt} />;
  else if (current === 'comprehension') body = <Comprehension reel={reel} onDone={advance} onAttempt={recordAttempt} />;
  else if (current === 'speaking') body = <Speaking reel={reel} mediaUrl={activity.mediaUrl} onDone={advance} />;
  else body = <section className="language-reels__stage"><p>Reel complete.</p><button type="button" className="lang-btn lang-btn--primary" onClick={onExit}>Done</button></section>;
  return <div className="lang-program language-reels-program"><header className="lang-program__header"><div><span className="lang-program__eyebrow">Language Reel · {LABELS[current] ?? 'Complete'}</span><h2 className="lang-program__day">{reel.title}</h2></div></header>{body}</div>;
}
