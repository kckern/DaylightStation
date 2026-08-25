import { useEffect, useMemo, useRef, useState } from 'react';
import { assignmentSatisfied, cardFace, learnPrompt, MODES, RATINGS, recallMatchesAny, resolvePolicy } from './flashcardEngine.js';
import './FlashcardProgram.scss';

/**
 * Reusable, course-neutral flashcard player. Its host owns authorization and
 * persistence through `onEvent`; this keeps Language Reels and future programs
 * from inventing a second flashcard progress store.
 */
export default function FlashcardProgram({ descriptor, onEvent = async () => ({ ok: true }), studyApi = null, onExit = () => {}, resolveAssetUrl = (assetId) => assetId }) {
  const deck = descriptor?.deck;
  const policy = useMemo(() => resolvePolicy(descriptor?.policy), [descriptor?.policy]);
  const [mode, setMode] = useState(descriptor?.initialMode || policy.modes[0] || 'cards');
  const [queue, setQueue] = useState(() => deck?.cards || []);
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false);
  const [direction, setDirection] = useState('front_to_back'); const [activeSeconds, setActiveSeconds] = useState(0);
  const [reviews, setReviews] = useState(0); const [answer, setAnswer] = useState(null); const [sessionId, setSessionId] = useState(null); const [autoplay, setAutoplay] = useState(false); const started = useRef(Date.now());
  const [summary, setSummary] = useState(null); const [intervals, setIntervals] = useState([]); const [learnStage, setLearnStage] = useState('recognition');
  const card = queue[index];

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setActiveSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!studyApi || !descriptor?.userId || !deck?.id) return undefined;
    let live = true;
    studyApi.open({ userId: descriptor.userId, deckId: deck.id, learning: descriptor.learning ?? null }).then(({ ok, data }) => {
      if (!live || !ok || !data?.session) return;
      setSessionId(data.session.sessionId); setReviews(data.session.reviews || 0);
      const selected = new Set(data.session.cardIds || []); setQueue(deck.cards.filter((candidate) => selected.has(candidate.cardId)));
      studyApi.summary?.(deck.id, descriptor.userId).then(({ ok: summaryOk, data: nextSummary }) => {
        if (live && summaryOk) setSummary(nextSummary);
      });
    });
    return () => { live = false; };
  }, [studyApi, descriptor?.userId, deck, policy]);
  useEffect(() => {
    if (!sessionId || !studyApi || !descriptor?.userId) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') studyApi.heartbeat(sessionId, { userId: descriptor.userId, seconds: 30 });
    }, 30000);
    return () => window.clearInterval(interval);
  }, [sessionId, studyApi, descriptor?.userId]);
  useEffect(() => {
    if (!sessionId || !card?.cardId || !studyApi?.preview || !descriptor?.userId || mode === 'cards') { setIntervals([]); return undefined; }
    let live = true;
    studyApi.preview(sessionId, { userId: descriptor.userId, cardId: card.cardId }).then(({ ok, data }) => { if (live && ok) setIntervals(data?.intervals ?? []); });
    return () => { live = false; };
  }, [sessionId, studyApi, descriptor?.userId, card?.cardId, mode]);
  useEffect(() => () => { onEvent({ type: 'active_time', seconds: Math.floor((Date.now() - started.current) / 1000) }); }, [onEvent]);
  useEffect(() => { setIndex(0); setRevealed(false); setAnswer(null); setLearnStage('recognition'); }, [mode, direction, card?.cardId]);
  useEffect(() => {
    const enabled = Array.isArray(card?.directions) && card.directions.length ? card.directions : ['front_to_back', 'back_to_front'];
    if (!enabled.includes(direction)) setDirection(enabled[0]);
  }, [card?.cardId, card?.directions, direction]);
  useEffect(() => {
    if (!autoplay || mode !== 'cards' || !card) return undefined;
    const timer = window.setTimeout(() => {
      if (revealed) { setRevealed(false); setQueue((cards) => cards.length > 1 ? [...cards.slice(1), cards[0]] : cards); }
      else setRevealed(true);
    }, revealed ? 5000 : 3500);
    return () => window.clearTimeout(timer);
  }, [autoplay, mode, card, revealed]);

  if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) return <section className="flashcard-program flashcard-program--error"><p>This deck has no cards yet.</p><button type="button" onClick={onExit}>Back</button></section>;
  if (queue.length === 0) return <section className="flashcard-program flashcard-program--summary"><h2>Review complete</h2><p>You reviewed {reviews} cards in this session.</p><button type="button" onClick={onExit}>Done</button></section>;
  const complete = assignmentSatisfied({ policy, progress: { activeSeconds, reviews, masteryPercent: descriptor?.masteryPercent, quizRequired: descriptor?.quizRequired, quizPassed: descriptor?.quizPassed } });
  const advance = () => { setRevealed(false); setAnswer(null); setQueue((cards) => cards.length > 1 ? [...cards.slice(1), cards[0]] : cards); setIndex(0); };
  const rate = async (rating) => {
    const result = sessionId && studyApi ? await studyApi.review(sessionId, { userId: descriptor.userId, cardId: card.cardId, rating, mode, direction }) : await onEvent({ type: 'review', deckId: deck.id, cardId: card.cardId, rating, mode, direction });
    if (result?.ok === false) return;
    setReviews((value) => value + 1); setRevealed(false); setAnswer(null);
    if (mode === 'review' || mode === 'learn') setQueue((cards) => rating === 'again' ? [...cards.slice(1), cards[0]] : cards.slice(1));
    else advance();
  };
  const face = cardFace(card, direction, revealed);
  const prompt = learnPrompt(card, direction);
  const activePrompt = prompt.kind === 'recognition' && learnStage === 'recall' ? { ...prompt, kind: 'recall' } : prompt;
  const directions = Array.isArray(card?.directions) && card.directions.length ? card.directions : ['front_to_back', 'back_to_front'];

  return <section className="flashcard-program" aria-label={deck.title}>
    <header><div><p>Flashcards</p><h2>{deck.title}</h2></div><button type="button" onClick={onExit}>Leave for now</button></header>
    <nav aria-label="Study mode">{policy.modes.map((candidate) => <button key={candidate} type="button" className={mode === candidate ? 'is-active' : ''} onClick={() => setMode(candidate)}>{candidate}</button>)}</nav>
    {summary?.counts && <p className="flashcard-program__summary" aria-label="Deck progress">{summary.counts.due} due · {summary.counts.new} new · {summary.counts.mastered} mastered</p>}
    {mode === 'test' ? <TestNotice deck={deck} bank={descriptor?.bank} onEvent={onEvent} /> : <>
      <p className="flashcard-program__progress">{index + 1} of {queue.length} · {reviews} reviewed · {Math.floor(activeSeconds / 60)} min active</p>
      {mode === 'learn' ? (activePrompt.kind === 'reveal' && revealed
        ? <CardFace face={face} resolveAssetUrl={resolveAssetUrl} />
        : <LearnCard prompt={activePrompt} answer={answer} setAnswer={setAnswer} onRecognized={() => { setLearnStage('recall'); setAnswer(null); }} onCorrect={() => rate('good')} onWrong={() => rate('again')} />)
        : <CardFace face={face} resolveAssetUrl={resolveAssetUrl} />}
      {mode === 'cards' && <div className="flashcard-program__controls"><button type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? 'Hide answer' : 'Show answer'}</button>{directions.length > 1 && <button type="button" onClick={() => setDirection((value) => value === 'front_to_back' ? 'back_to_front' : 'front_to_back')}>Reverse</button>}<button type="button" onClick={() => setQueue((cards) => [...cards].sort(() => Math.random() - 0.5))}>Shuffle</button><button type="button" aria-pressed={autoplay} onClick={() => setAutoplay((value) => !value)}>{autoplay ? 'Stop autoplay' : 'Autoplay'}</button>{revealed && <button type="button" onClick={() => { onEvent({ type: 'self_check', deckId: deck.id, cardId: card.cardId, result: 'again' }); advance(); }}>Show me again</button>}<button type="button" onClick={advance}>Next</button></div>}
      {(mode === 'review' || (mode === 'learn' && prompt.kind === 'reveal')) && revealed && <div className="flashcard-program__ratings">{RATINGS.map((rating) => <button type="button" key={rating} onClick={() => rate(rating)}>{rating}{intervals.find((item) => item.rating === rating)?.intervalDays ? ` · ${intervals.find((item) => item.rating === rating).intervalDays}d` : ''}</button>)}</div>}
      {mode === 'learn' && directions.length > 1 && <button type="button" onClick={() => setDirection((value) => value === 'front_to_back' ? 'back_to_front' : 'front_to_back')}>Study other direction</button>}
      {(mode === 'review' || (mode === 'learn' && prompt.kind === 'reveal')) && !revealed && <button type="button" className="flashcard-program__primary" onClick={() => setRevealed(true)}>Show answer</button>}
    </>}
    {complete && <p className="flashcard-program__complete">Assignment target reached.</p>}
  </section>;
}

function CardFace({ face, resolveAssetUrl }) { return <article className="flashcard-program__card">{(face?.blocks || []).map((block, index) => <Block key={`${block.type}-${index}`} block={block} resolveAssetUrl={resolveAssetUrl} />)}</article>; }
function Block({ block, resolveAssetUrl }) {
  if (block.type === 'text') return <p>{block.text}</p>;
  if (block.type === 'image') return <img src={resolveAssetUrl(block.assetId)} alt={block.alt} />;
  if (block.type === 'audio') return <><audio controls src={resolveAssetUrl(block.assetId)} /><details><summary>Transcript</summary><p>{block.transcript}</p></details></>;
  if (block.type === 'video') return <><video controls playsInline poster={resolveAssetUrl(block.posterAssetId)} src={resolveAssetUrl(block.assetId)} /><details><summary>Transcript</summary><p>{block.transcript}</p></details></>;
  if (block.type === 'tts') return <button type="button" onClick={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(block.text))}>Listen</button>;
  return null;
}
function LearnCard({ prompt, answer, setAnswer, onRecognized, onCorrect, onWrong }) {
  const [recognitionFeedback, setRecognitionFeedback] = useState(null);
  if (prompt.kind === 'reveal') return <article className="flashcard-program__card"><p>{prompt.prompt || 'Study this association.'}</p><p>This card has no text answer to type. Reveal it, then choose a confidence rating.</p></article>;
  if (prompt.kind === 'recognition') return <article className="flashcard-program__card"><p>{prompt.prompt}</p><p>Choose the matching association.</p><div className="flashcard-program__choices">{prompt.recognitionChoices.map((choice) => <button type="button" key={choice} onClick={() => { if (recallMatchesAny(choice, prompt.acceptedAnswers)) onRecognized(); else setRecognitionFeedback('Not quite — try another association.'); }}>{choice}</button>)}</div>{recognitionFeedback && <p role="status">{recognitionFeedback}</p>}</article>;
  const correct = answer !== null && recallMatchesAny(answer, prompt.acceptedAnswers);
  return <article className="flashcard-program__card"><p>{prompt.prompt}</p><label>Type your answer<input value={answer ?? ''} onChange={(event) => setAnswer(event.target.value)} /></label>{answer !== null && !correct && <p>Not quite. One accepted answer is: {prompt.acceptedAnswers[0]}</p>}<button type="button" onClick={() => { if (correct) onCorrect(); else onWrong(); }}>Check answer</button></article>;
}
function TestNotice({ deck, bank, onEvent }) {
  const forms = [...new Set(bank?.items?.map((item) => item.type).filter(Boolean) ?? [])];
  const [count, setCount] = useState(() => Math.min(10, bank?.items?.length ?? 0));
  const [types, setTypes] = useState(forms);
  if (!bank || !forms.length) return <div className="flashcard-program__test"><p>This deck needs a linked graded question bank before it can offer a Test.</p></div>;
  const toggle = (type) => setTypes((selected) => selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type]);
  const eligible = bank.items.filter((item) => types.includes(item.type)).length;
  const safeCount = Math.max(1, Math.min(Number(count) || 1, eligible));
  return <div className="flashcard-program__test"><p>Test uses the course’s graded question bank and its normal review path.</p><label>Questions <input type="number" min="1" max={eligible} value={count} onChange={(event) => setCount(event.target.value)} /></label><fieldset><legend>Question forms</legend>{forms.map((type) => <label key={type}><input type="checkbox" checked={types.includes(type)} onChange={() => toggle(type)} />{type.replaceAll('_', ' ')}</label>)}</fieldset><button type="button" disabled={!types.length} onClick={() => onEvent({ type: 'start_test', deckId: deck.id, testPlan: { count: safeCount, types } })}>Start graded test</button></div>;
}
export { MODES };
