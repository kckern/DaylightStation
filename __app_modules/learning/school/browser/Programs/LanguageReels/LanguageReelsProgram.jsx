import { SchoolButton } from '../../portal/SchoolButton.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useTakeRecorder from "../shared/useTakeRecorder.js";
import { schoolLog } from "../../schoolLog.js";
import { languageReelsApi } from "./languageReelsApi.js";
import "./LanguageReels.scss";

const ORDER = ['flashcards', 'listen', 'cloze', 'watch', 'comprehension', 'speaking'];
const LABELS = { flashcards: 'Prepare', listen: 'Listen', cloze: 'Fill the line', watch: 'Watch', comprehension: 'Understand', speaking: 'Speak your part' };
const asList = (value) => Array.isArray(value) ? value : [];
const source = (reel, key) => asList(reel?.authoring?.[key] ?? reel?.[key]);

function Media({ src, video = false, onEnded, mediaRef, muted = false }) {
  return <video ref={mediaRef} className={video ? 'language-reels__video' : 'language-reels__audio'} src={src} controls playsInline muted={muted} onEnded={onEnded} />;
}

function Assessment({ reel, mediaUrl, type, onDone, onAttempt, disabled = false }) {
  const items = source(reel, type);
  const [index, setIndex] = useState(0); const [answer, setAnswer] = useState(null);
  const [wrong, setWrong] = useState(false); const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(null); const [accepted, setAccepted] = useState(false);
  const busy = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const item = items[index];
  const choices = useMemo(() => type === 'cloze' && item ? [item.answer, ...asList(item.decoys)].sort(() => Math.random() - 0.5) : asList(item?.choices ?? item?.options), [item, type]);
  if (!items.length) return <StageNotice text={type === 'cloze' ? 'There are no reconstruction prompts for this reel.' : 'There are no comprehension questions for this reel.'} onDone={onDone} />;
  const select = async (choice) => {
    if (busy.current || disabled || accepted) return;
    busy.current = true; setPending(true); setAnswer(choice); setFailure(null);
    try {
      const saved = await onAttempt({ type, itemId: item.id ?? (type === 'cloze' ? item.lineId : String(index)), answer: choice });
      if (!alive.current) return;
      setWrong(!saved.correct);
      if (saved.correct) {
        if (index + 1 === items.length) { setAccepted(true); await onDone(); }
        else { setIndex((value) => value + 1); setAnswer(null); setWrong(false); }
      }
    } catch {
      if (alive.current) setFailure('Your answer did not save. Retry this answer before continuing.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  };
  const line = asList(reel.transcript).find((cue) => cue.id === item.lineId);
  return <section className="language-reels__stage" aria-busy={pending}>
    <p className="language-reels__counter">{type === 'cloze' ? 'Line' : 'Question'} {index + 1} of {items.length}</p>
    <h3 className="language-reels__prompt">{item.prompt ?? item.question}</h3>
    {type === 'cloze' && line && <Media src={`${mediaUrl}#t=${line.startMs / 1000},${line.endMs / 1000}`} />}
    <div className="language-reels__choices">{choices.map((choice) => <SchoolButton variant="plain" type="button" key={choice} disabled={pending || disabled || accepted || Boolean(failure)} className={`language-reels__choice ${answer === choice && !failure && !pending ? (wrong ? 'is-wrong' : 'is-right') : ''}`} onClick={() => select(choice)}>{choice}</SchoolButton>)}</div>
    {pending && <p role="status">Saving answer…</p>}
    {failure && <div role="alert"><p>{failure}</p><SchoolButton variant="plain" type="button" className="lang-btn" disabled={pending || disabled} onClick={() => select(answer)}>Retry answer</SchoolButton></div>}
    {wrong && !failure && <p className="language-reels__feedback">Not quite — listen again and try another answer.</p>}
  </section>;
}

const REEL_TAKE_FLOOR = Object.freeze({ silentLevel: 0, minTakeMs: 0 });
function Speaking({ reel, mediaUrl, onDone }) {
  const segments = asList(reel?.authoring?.speaking?.segments);
  const [index, setIndex] = useState(0); const [take, setTake] = useState(null); const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false); const openingRef = useRef(false); const alive = useRef(true);
  const preview = useRef(null); const scene = useRef(null); const replacement = useRef(null); const replacementStarted = useRef(false);
  const capture = useTakeRecorder({ floor: REEL_TAKE_FLOOR, onTake: ({ blob }) => setTake(URL.createObjectURL(blob)) });
  const recording = capture.phase === 'recording';
  const rawSegment = segments[index]; const line = asList(reel.transcript).find((cue) => cue.id === rawSegment?.lineId); const segment = { ...line, ...rawSegment }; const duration = rawSegment ? Math.max(0.25, (segment.endMs - segment.startMs) / 1000 * 1.25) : 0;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => {
    capture.release(); preview.current?.pause(); scene.current?.pause();
    if (scene.current) scene.current.ontimeupdate = null;
    if (replacement.current) { replacement.current.pause(); replacement.current.onended = null; replacement.current = null; }
    if (take) URL.revokeObjectURL(take);
  }, [take, index, capture.release]);
  if (!segments.length) return <StageNotice text="Speaking is optional for this reel." onDone={onDone} />;
  const begin = async () => {
    if (openingRef.current) return;
    openingRef.current = true; setOpening(true); setError(null);
    try { await capture.start(); } finally { openingRef.current = false; if (alive.current) setOpening(false); }
  };
  const stop = capture.stop;
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
    {!take && <SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" disabled={opening || capture.phase === 'saving'} onClick={recording ? stop : begin}>{opening ? 'Opening microphone…' : recording ? 'Stop recording' : 'Record my line'}</SchoolButton>}
    {recording && <p className="language-reels__recording">Recording…</p>}{take && <><audio ref={preview} controls src={take} /><video ref={scene} className="language-reels__video" src={mediaUrl} controls playsInline /><div className="language-reels__actions"><SchoolButton variant="plain" type="button" className="lang-btn" onClick={hearInScene}>Hear it in the scene</SchoolButton><SchoolButton variant="plain" type="button" className="lang-btn" onClick={() => { setTake(null); }}>Record again</SchoolButton><SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" onClick={accept}>Use this take</SchoolButton></div></>}
    {(error || capture.unavailable) && <p className="language-reels__feedback">{error ?? 'Microphone permission was not available. You can skip this optional step.'}</p>}<SchoolButton variant="plain" type="button" className="lang-btn" onClick={onDone}>Skip speaking for this reel</SchoolButton></section>;
}

function StageNotice({ text, onDone }) { return <section className="language-reels__stage"><p>{text}</p><SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" onClick={onDone}>Continue</SchoolButton></section>; }

/** Standalone reel sequence; its session/grant never shares Sentence Ladder state. */
export default function LanguageReelsProgram({ userId, reelId, reelGrant, onExit }) {
  const [activity, setActivity] = useState(null); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [card, setCard] = useState(0); const [revealed, setRevealed] = useState(false); const [mediaComplete, setMediaComplete] = useState(false);
  const generation = useRef(0); const stageBusy = useRef(false);
  const load = useCallback(async () => {
    const run = ++generation.current; setError(null);
    try {
      const result = await languageReelsApi.open(userId, reelId, reelGrant);
      if (run !== generation.current) return;
      if (!result.ok || !result.data?.session || !result.data?.reel) { setError({ message: result.status === 403 ? 'This reel needs a current assignment.' : 'This reel could not open.', terminal: [401, 403, 404].includes(result.status), operation: 'open' }); return; }
      setActivity(result.data); schoolLog.session('reel-opened', { reelId });
    } catch { if (run === generation.current) setError({ message: 'This reel could not open.', operation: 'open' }); }
  }, [userId, reelId, reelGrant]);
  useEffect(() => { setActivity(null); setCard(0); setRevealed(false); setSaving(false); stageBusy.current = false; load(); return () => { generation.current += 1; }; }, [load]);
  const current = useMemo(() => {
    const stages = activity?.session?.stages ?? {};
    return ORDER.find((stage) => stages[stage] === false) ?? null;
  }, [activity?.session?.stages]);
  useEffect(() => setMediaComplete(false), [current]);
  const advance = async () => {
    if (!current || stageBusy.current) return;
    stageBusy.current = true; setSaving(true); const run = generation.current;
    try {
      const result = await languageReelsApi.stage(userId, reelId, current, reelGrant);
      if (run !== generation.current) return;
      if (!result.ok || result.data?.stages?.[current] !== true) { schoolLog.answerError('reel-stage-unrecorded', { reelId, stage: current, status: result.status }); setError({ message: 'That step did not save. Try again.', terminal: [401, 403, 404].includes(result.status), operation: 'stage' }); return; }
      setActivity((value) => ({ ...value, session: result.data })); setError(null);
    } catch { if (run === generation.current) setError({ message: 'That step did not save. Try again.', operation: 'stage' }); }
    finally { if (run === generation.current) { stageBusy.current = false; setSaving(false); } }
  };
  const exit = <SchoolButton variant="plain" type="button" className="lang-btn" onClick={onExit}>Exit reel</SchoolButton>;
  if (!activity) return <div className={`lang-program ${error ? 'lang-program--error' : 'lang-program--loading'}`}>{error ? <><p role="alert">{error.message}</p>{!error.terminal && <SchoolButton variant="plain" type="button" className="lang-btn" onClick={load}>Try again</SchoolButton>}</> : <p role="status">Loading reel…</p>}{exit}</div>;
  const reel = activity.reel; const cards = asList(reel.vocabulary);
  const recordAttempt = async (attempt) => {
    const run = generation.current;
    const result = await languageReelsApi.attempt(userId, reelId, reelGrant, attempt);
    if (run !== generation.current) throw new Error('Reel closed');
    if ([401, 403, 404].includes(result.status)) setError({ message: 'This reel needs a current assignment. Exit and open it again from your assignment.', terminal: true, operation: 'attempt' });
    const saved = result.data?.attempts?.at(-1);
    if (!result.ok || !saved || saved.type !== attempt.type || String(saved.itemId) !== String(attempt.itemId) || saved.answer !== attempt.answer || typeof saved.correct !== 'boolean') { schoolLog.answerError('reel-attempt-unrecorded', { reelId, type: attempt.type, itemId: attempt.itemId, status: result.status }); throw new Error('Answer was not acknowledged'); }
    return saved;
  };
  let body;
  if (current === 'flashcards') { const item = cards[card]; body = <section className="language-reels__stage"><p className="language-reels__counter">Card {card + 1} of {cards.length}</p><h3 className="language-reels__term">{item.term}</h3>{revealed && <><p>{item.definition}</p><p className="language-reels__example">{item.example_ko}</p><p className="language-reels__hint">{item.example_en}</p></>}{!revealed ? <SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" onClick={() => setRevealed(true)}>Reveal</SchoolButton> : <SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" onClick={() => card + 1 === cards.length ? advance() : (setCard((n) => n + 1), setRevealed(false))}>{card + 1 === cards.length ? 'Start listening' : 'Next card'}</SchoolButton>}</section>; }
  else if (current === 'listen' || current === 'watch') body = <section className="language-reels__stage"><p>{current === 'listen' ? 'Listen all the way through without looking at the video or transcript.' : 'Now watch the full scene.'}</p><Media src={activity.mediaUrl} video={current === 'watch'} onEnded={() => setMediaComplete(true)} /><SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" disabled={!mediaComplete || saving} onClick={advance}>{mediaComplete ? 'Continue' : 'Finish the reel to continue'}</SchoolButton></section>;
  else if (current === 'cloze') body = <Assessment key={current} type="cloze" reel={reel} mediaUrl={activity.mediaUrl} onDone={advance} onAttempt={recordAttempt} disabled={saving || error?.terminal} />;
  else if (current === 'comprehension') body = <Assessment key={current} type="comprehension" reel={reel} onDone={advance} onAttempt={recordAttempt} disabled={saving || error?.terminal} />;
  else if (current === 'speaking') body = <Speaking reel={reel} mediaUrl={activity.mediaUrl} onDone={advance} />;
  else body = <section className="language-reels__stage"><p>Reel complete.</p><SchoolButton variant="plain" type="button" className="lang-btn lang-btn--primary" onClick={onExit}>Done</SchoolButton></section>;
  return <div className="lang-program language-reels-program"><header className="lang-program__header"><div><span className="lang-program__eyebrow">Language Reel · {LABELS[current] ?? 'Complete'}</span><h2 className="lang-program__day">{reel.title}</h2></div>{exit}</header>{error && <div role="alert"><p>{error.message}</p>{!error.terminal && error.operation === 'stage' && <SchoolButton variant="plain" type="button" className="lang-btn" disabled={saving} onClick={advance}>Retry step</SchoolButton>}</div>}{saving && <p role="status">Saving step…</p>}{body}</div>;
}
