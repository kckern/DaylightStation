import { useEffect, useMemo, useRef, useState } from 'react';
import { assignmentSatisfied, cardFace, learnPrompt, MODES, RATINGS, resolvePolicy } from './flashcardEngine.js';
import './FlashcardProgram.scss';

/**
 * Reusable, course-neutral flashcard player. Its host owns authorization and
 * persistence through `onEvent`; this keeps Language Reels and future programs
 * from inventing a second flashcard progress store.
 */
export default function FlashcardProgram({ descriptor, onEvent = async () => ({ ok: true }), onExit = () => {}, resolveAssetUrl = (assetId) => assetId }) {
  const deck = descriptor?.deck;
  const policy = useMemo(() => resolvePolicy(descriptor?.policy), [descriptor?.policy]);
  const [mode, setMode] = useState(descriptor?.initialMode || policy.modes[0] || 'cards');
  const [queue, setQueue] = useState(() => deck?.cards || []);
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false);
  const [direction, setDirection] = useState('front_to_back'); const [activeSeconds, setActiveSeconds] = useState(0);
  const [reviews, setReviews] = useState(0); const [answer, setAnswer] = useState(null); const started = useRef(Date.now());
  const card = queue[index];

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setActiveSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => () => { onEvent({ type: 'active_time', seconds: Math.floor((Date.now() - started.current) / 1000) }); }, [onEvent]);
  useEffect(() => { setIndex(0); setRevealed(false); setAnswer(null); }, [mode, direction]);

  if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) return <section className="flashcard-program flashcard-program--error"><p>This deck has no cards yet.</p><button type="button" onClick={onExit}>Back</button></section>;
  const complete = assignmentSatisfied({ policy, progress: { activeSeconds, reviews, masteryPercent: descriptor?.masteryPercent, quizRequired: descriptor?.quizRequired, quizPassed: descriptor?.quizPassed } });
  const advance = () => { setRevealed(false); setAnswer(null); setIndex((value) => value + 1 >= queue.length ? 0 : value + 1); };
  const rate = async (rating) => { await onEvent({ type: 'review', deckId: deck.id, cardId: card.cardId, rating, mode, direction }); setReviews((value) => value + 1); advance(); };
  const face = cardFace(card, direction, revealed);
  const prompt = learnPrompt(card, descriptor?.bankItems?.find((item) => item.id === card.cardId));

  return <section className="flashcard-program" aria-label={deck.title}>
    <header><div><p>Flashcards</p><h2>{deck.title}</h2></div><button type="button" onClick={onExit}>Leave for now</button></header>
    <nav aria-label="Study mode">{policy.modes.map((candidate) => <button key={candidate} type="button" className={mode === candidate ? 'is-active' : ''} onClick={() => setMode(candidate)}>{candidate}</button>)}</nav>
    {mode === 'test' ? <TestNotice deck={deck} onEvent={onEvent} /> : <>
      <p className="flashcard-program__progress">{index + 1} of {queue.length} · {reviews} reviewed · {Math.floor(activeSeconds / 60)} min active</p>
      {mode === 'learn' ? <LearnCard prompt={prompt} answer={answer} setAnswer={setAnswer} onCorrect={() => rate('good')} /> : <CardFace face={face} resolveAssetUrl={resolveAssetUrl} />}
      {mode === 'cards' && <div className="flashcard-program__controls"><button type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? 'Hide answer' : 'Show answer'}</button><button type="button" onClick={() => setDirection((value) => value === 'front_to_back' ? 'back_to_front' : 'front_to_back')}>Reverse</button>{revealed && <button type="button" onClick={() => { onEvent({ type: 'self_check', deckId: deck.id, cardId: card.cardId, result: 'again' }); advance(); }}>Show me again</button>}<button type="button" onClick={advance}>Next</button></div>}
      {mode === 'review' && revealed && <div className="flashcard-program__ratings">{RATINGS.map((rating) => <button type="button" key={rating} onClick={() => rate(rating)}>{rating}</button>)}</div>}
      {(mode === 'review' || mode === 'learn') && !revealed && <button type="button" className="flashcard-program__primary" onClick={() => setRevealed(true)}>Show answer</button>}
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
function LearnCard({ prompt, answer, setAnswer, onCorrect }) { if (prompt.kind === 'choice') return <article className="flashcard-program__card"><p>{prompt.prompt}</p>{prompt.choices.map((choice) => <button key={choice} type="button" className={answer === choice ? (choice === prompt.answer ? 'is-correct' : 'is-wrong') : ''} onClick={() => { setAnswer(choice); if (choice === prompt.answer) window.setTimeout(onCorrect, 400); }}>{choice}</button>)}</article>; return <article className="flashcard-program__card"><p>{prompt.prompt}</p><p>{prompt.answer}</p></article>; }
function TestNotice({ deck, onEvent }) { return <div className="flashcard-program__test"><p>Test uses the course’s graded question bank and its normal review path.</p><button type="button" onClick={() => onEvent({ type: 'start_test', deckId: deck.id })}>Configure test</button></div>; }
export { MODES };
