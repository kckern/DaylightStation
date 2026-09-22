import { useCallback, useEffect, useRef, useState } from 'react';
import { useCapabilities } from '../../SentenceLadder/useCapabilities.js';
import CheckCard from './CheckCard.jsx';
import StudyCard from './StudyCard.jsx';
import { wordLadderApi } from './wordLadderApi.js';
import { playClip } from './wordLadderAudio.js';
import { wordLadderLog } from './wordLadderLog.js';
import './WordLadder.scss';

const LANGUAGES = Object.freeze({ source: 'en', target: 'ko' });
const CAPABILITY_KEY = 'korean-vocab';
const NOT_SAVED = "That didn't save — try again";
/** Upload failures on one card before the card falls back to flip-and-mark. */
const UPLOAD_FAILURES_BEFORE_FALLBACK = 2;

/** Checks, then study (including today's misses), then the review quiz. */
export function nextStep(plan) {
  const check = plan.checks.find((item) => !item.done);
  if (check) return { type: 'check', item: check };
  const study = plan.study.find((item) => !item.done);
  if (study) return { type: 'study', item: study };
  const quiz = plan.review.find((item) => !item.done);
  if (quiz) return { type: 'check', item: quiz };
  return { type: 'done' };
}

/**
 * The Korean word ladder (flashcards `policy.mode: word-ladder`). The server
 * owns the day: it freezes the plan, grades every check and decides credit.
 * A finished day lands on the review run (design rev 3): every deck card,
 * flip only, as many times as the child wants.
 */
export default function WordLadderProgram({ descriptor, api = wordLadderApi, resolveAssetUrl = (id) => id, onExit = () => {} }) {
  const userId = descriptor?.userId ?? null;
  const deckId = descriptor?.deckId ?? null;
  const { capabilities, ready } = useCapabilities(CAPABILITY_KEY, LANGUAGES);
  const [sessionId, setSessionId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [micReason, setMicReason] = useState(null);
  const [reviewRun, setReviewRun] = useState(null);
  const [notice, setNotice] = useState(null);
  const doneLogged = useRef(false);
  const uploadFailures = useRef({});

  useEffect(() => {
    wordLadderLog.mounted({ userId, deckId });
    return () => wordLadderLog.unmounted({ userId, deckId });
  }, [userId, deckId]);

  useEffect(() => {
    if (!userId || !deckId) return undefined;
    let live = true;
    api.open({ userId, deckId }).then(({ ok, status, data }) => {
      if (!live) return;
      if (!ok || !data?.plan) {
        setError('This word list is not ready right now.');
        wordLadderLog.planFailed({ userId, deckId, status });
        return;
      }
      setSessionId(data.sessionId);
      setPlan(data.plan);
      wordLadderLog.planLoaded({
        userId, deckId, day: data.day, folded: data.folded ?? 0, doneToday: data.plan.doneToday,
        checks: data.plan.checks.length, study: data.plan.study.length, review: data.plan.review.length,
      });
      if (data.plan.doneToday) {
        setReviewRun({ index: 0 });
        wordLadderLog.reviewStarted({ userId, deckId, from: 'open' });
      }
    });
    return () => { live = false; };
  }, [api, userId, deckId]);

  const deviceMic = ready && capabilities.microphone === true;
  const micAvailable = deviceMic && !micReason;
  const unavailableReason = micReason ?? (ready && !deviceMic ? 'no-device' : null);
  useEffect(() => {
    if (ready && !deviceMic) wordLadderLog.micUnavailable({ userId, reason: 'no-device' });
  }, [ready, deviceMic, userId]);

  useEffect(() => {
    if (plan?.doneToday && !doneLogged.current) {
      doneLogged.current = true;
      wordLadderLog.done({ userId, deckId });
    }
  }, [plan?.doneToday, userId, deckId]);

  const reviewCard = reviewRun && plan ? plan.deckCards?.[reviewRun.index] ?? null : null;
  useEffect(() => {
    if (!reviewCard || !sessionId) return;
    wordLadderLog.reviewViewed({ userId, wordId: reviewCard.wordId });
    api.viewReview(sessionId, { userId, wordId: reviewCard.wordId });
  }, [reviewRun, reviewCard, sessionId, userId, api]);

  /**
   * A write that did not come back ok may still have landed (a lost
   * response). Re-reading the plan heals that: the step the server already
   * recorded disappears instead of 400-ing on every retap forever.
   */
  const notSaved = useCallback(async (what, details) => {
    setNotice(NOT_SAVED);
    wordLadderLog.writeFailed({ userId, what, ...details });
    if (!sessionId) return;
    const { ok, data } = await api.plan(sessionId, userId);
    if (ok && data?.plan) {
      setPlan(data.plan);
      wordLadderLog.planRefetched({ userId, what });
    }
  }, [api, sessionId, userId]);

  const onMicUnavailable = useCallback((reason) => {
    setMicReason(reason);
    wordLadderLog.micUnavailable({ userId, reason });
  }, [userId]);

  const answer = useCallback(async (item, choice) => {
    const { ok, status, data } = await api.answer(sessionId, { userId, wordId: item.wordId, choice });
    if (!ok || !data) {
      await notSaved('answer', { wordId: item.wordId, status });
      return;
    }
    setNotice(null);
    wordLadderLog.checkAnswered({ userId, wordId: item.wordId, phase: item.phase, direction: item.direction, correct: data.correct });
    if (!data.correct && data.card?.media?.audio) playClip(resolveAssetUrl(data.card.media.audio));
    setFeedback({ item, result: { correct: data.correct, answer: data.answer, card: data.card } });
    setPlan(data.plan);
  }, [api, sessionId, userId, resolveAssetUrl, notSaved]);

  const record = useCallback(async (wordId, blob) => {
    const { ok, status, data } = await api.uploadRecording(sessionId, { userId, wordId, blob });
    if (!ok || !data) {
      const failures = (uploadFailures.current[wordId] ?? 0) + 1;
      uploadFailures.current[wordId] = failures;
      wordLadderLog.recordingFailed({ userId, wordId, status, failures, bytes: blob?.size ?? null });
      // A server that cannot take the audio must not wall the card: after
      // repeated failures (or any server error) the card becomes flip-and-mark.
      if (status >= 500 || failures >= UPLOAD_FAILURES_BEFORE_FALLBACK) onMicUnavailable('upload-failed');
      await notSaved('recording', { wordId, status });
      return false;
    }
    setNotice(null);
    wordLadderLog.recordingUploaded({ userId, wordId, take: data.take, bytes: blob?.size ?? null });
    setPlan(data.plan);
    return true;
  }, [api, sessionId, userId, onMicUnavailable, notSaved]);

  const mark = useCallback(async (item, value) => {
    const recording = item.studied ? null : { status: 'unavailable', reason: unavailableReason ?? 'unknown' };
    const { ok, status, data } = await api.mark(sessionId, { userId, wordId: item.wordId, mark: value, recording });
    if (!ok || !data) {
      await notSaved('mark', { wordId: item.wordId, status });
      return;
    }
    setNotice(null);
    wordLadderLog.cardMarked({ userId, wordId: item.wordId, mark: value, recording: recording ? 'unavailable' : 'taken' });
    setPlan(data.plan);
  }, [api, sessionId, userId, unavailableReason, notSaved]);

  const startReview = () => {
    setReviewRun({ index: 0 });
    wordLadderLog.reviewStarted({ userId, deckId, from: 'done' });
  };

  if (error) {
    return (
      <div className="word-ladder" role="alert">
        <p>{error}</p>
        <button type="button" onClick={onExit}>Back</button>
      </div>
    );
  }
  if (!plan || !ready) return <div className="word-ladder"><p>Loading…</p></div>;

  const header = <header className="word-ladder-header"><p aria-label="Today">{plan.progressLabel}</p></header>;
  const working = (
    <header className="word-ladder-header">
      <button type="button" className="word-ladder-leave" onClick={onExit}>Leave for now</button>
      <p aria-label="Today">{plan.progressLabel}</p>
      {notice && <p className="word-ladder-notice" role="status">{notice}</p>}
    </header>
  );

  if (reviewRun) {
    if (!reviewCard) {
      return (
        <div className="word-ladder word-ladder-done">
          {header}
          <h2>That&apos;s every card</h2>
          <button type="button" onClick={startReview}>Review again</button>
          <button type="button" onClick={onExit}>Done</button>
        </div>
      );
    }
    return (
      <div className="word-ladder">
        {header}
        <StudyCard
          key={`review:${reviewRun.index}:${reviewCard.wordId}`}
          card={reviewCard}
          reviewOnly
          resolveAssetUrl={resolveAssetUrl}
          onNext={() => setReviewRun({ index: reviewRun.index + 1 })}
        />
      </div>
    );
  }

  if (feedback) {
    return (
      <div className="word-ladder">
        {working}
        <CheckCard item={feedback.item} result={feedback.result} resolveAssetUrl={resolveAssetUrl} onContinue={() => setFeedback(null)} />
      </div>
    );
  }

  const step = nextStep(plan);
  if (step.type === 'done') {
    return (
      <div className="word-ladder word-ladder-done">
        {header}
        <h2>All done for today</h2>
        <button type="button" onClick={startReview}>Review the cards</button>
        <button type="button" onClick={onExit}>Done</button>
      </div>
    );
  }
  return (
    <div className="word-ladder">
      {working}
      {step.type === 'check' ? (
        <CheckCard key={`${step.item.phase}:${step.item.wordId}`} item={step.item} resolveAssetUrl={resolveAssetUrl} onAnswer={answer} />
      ) : (
        <StudyCard
          key={`study:${step.item.wordId}`}
          card={step.item.card}
          needsRecording={micAvailable && !step.item.studied}
          resolveAssetUrl={resolveAssetUrl}
          onRecorded={(blob) => record(step.item.wordId, blob)}
          onMark={(value) => mark(step.item, value)}
          onMicUnavailable={onMicUnavailable}
        />
      )}
    </div>
  );
}
