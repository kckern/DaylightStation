import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TouchButton } from '../../../../../lib/ui/index.js';
import WordLadderStage from './WordLadderStage.jsx';
import FlashcardItem from './items/FlashcardItem.jsx';
import ChoiceItem from './items/ChoiceItem.jsx';
import TypedItem from './items/TypedItem.jsx';
import SummaryItem from './items/SummaryItem.jsx';
import { createWordLadderApi } from './wordLadderApi.js';
import { wordLadderLog } from './wordLadderLog.js';
import { useWordLadderKeys } from './useWordLadderKeys.js';
import './WordLadder.scss';

/** Items whose answer the server grades: the verdict stays on screen until Next. */
const GRADED = new Set(['choice', 'typed']);

/**
 * Whether THIS device can offer a microphone, detected fresh for every open.
 * A package-scoped `useCapabilities` (as Sentence Ladder has) needs the
 * package name, which is only known from the FIRST open's response — so the
 * very first open cannot wait for it; this mirrors that hook's own check
 * (`SentenceLadder/useCapabilities.js` `detectMicrophone`) instead.
 *
 * Existence, not permission: `enumerateDevices()` reports device `kind`
 * without ever prompting, so a device's mic can be found before the learner
 * has chosen to record anything (spec §6, "at most tapped Record"). Labels
 * are blank without permission, but `kind === 'audioinput'` is not.
 */
async function detectMicrophoneCapability() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return false;
  }
}

function roundLabel(progress) {
  if (!progress) return '';
  if (progress.phase === 'rechecks') return `Checking ${progress.rechecksLeft} ${progress.rechecksLeft === 1 ? 'word' : 'words'}`;
  if (progress.phase === 'summary' || !progress.round) return 'Done for today';
  const { index, phase } = progress.round;
  const what = phase === 'quiz' ? 'Quiz' : phase === 'intro' ? 'New words' : 'Cards';
  return `Round ${index} · ${what}`;
}

function remainingLabel(progress) {
  const round = progress?.phase === 'round' ? progress.round : null;
  if (!round) return null;
  if (round.phase === 'stream') return `${round.remainingInStream} left`;
  if (round.phase === 'quiz') return `${round.quizLeft} left`;
  return null;
}

/**
 * The word ladder (mastery redesign rev 4, spec §6). The server owns the day:
 * it picks every item and grades every answer. This renders one item at a
 * time inside the config-sized stage. `descriptor.test` = a read-only test
 * sitting (banner, `/word-ladder/test/*` API, optional `scenario` seed).
 *
 * A graded answer comes back with the NEXT item; the verdict is shown on the
 * current item until Next. A copy mismatch keeps the item. A 404 means the
 * sitting is gone (the study day rolled, or a test sitting was evicted) — the
 * program reopens.
 *
 * Nothing is opened on mount: the child taps Start first (spec §6). That tap is
 * the page's user gesture, so every clip after it may autoplay.
 */
export default function WordLadderProgram({ descriptor, api: injected = null, resolveAssetUrl = (id) => id, onExit = () => {} }) {
  const { userId = null, deckId = null, test = false, scenario = null, title = null } = descriptor ?? {};
  const api = useMemo(() => injected ?? createWordLadderApi({ test }), [injected, test]);
  const [session, setSession] = useState(null);
  const [item, setItem] = useState(null);
  const [pendingItem, setPendingItem] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(false);
  const stageRef = useRef(null);
  // Only the latest open may land (a reopen can overlap a slow first open).
  const generation = useRef(0);
  const live = useRef(true);
  const busyRef = useRef(false);
  // The open sitting, and whether Leave/Done already closed it — an unmount
  // closes anything still open (reason 'unmount').
  const sittingRef = useRef(null);
  const closedRef = useRef(false);

  const show = useCallback((nextItem, nextProgress) => {
    setItem(nextItem); setProgress(nextProgress); setResult(null); setPendingItem(null);
  }, []);

  const open = useCallback(async () => {
    const mine = ++generation.current;
    const capabilities = { microphone: await detectMicrophoneCapability() };
    const { ok, status, data } = await api.open({ userId, deckId, scenario, capabilities });
    if (!live.current || mine !== generation.current) return;
    if (!ok || !data?.item || !data?.sittingId) {
      setError('This word list is not ready right now.');
      wordLadderLog.planFailed({ userId, deckId, status, test });
      return;
    }
    setError(null);
    sittingRef.current = data.sittingId;
    closedRef.current = false;
    setSession({ id: data.sittingId, langs: { term: data.language?.code ?? null, gloss: data.gloss?.code ?? null } });
    show(data.item, data.progress ?? null);
    wordLadderLog.planLoaded({ userId, deckId, package: data.package ?? null, sittingId: data.sittingId, test, first: data.item.type, phase: data.progress?.phase ?? null });
  }, [api, userId, deckId, scenario, test, show]);

  useEffect(() => {
    live.current = true;
    wordLadderLog.mounted({ userId, deckId, test, scenario });
    return () => {
      live.current = false;
      const openId = sittingRef.current;
      if (openId && !closedRef.current) {
        closedRef.current = true;
        // Fire-and-forget: the component is gone; the client never throws.
        api.close(openId, { userId, reason: 'unmount' });
      }
      sittingRef.current = null;
      wordLadderLog.unmounted({ userId, deckId, test, sittingId: openId ?? null });
    };
  }, [api, open, userId, deckId, test, scenario]);

  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    wordLadderLog.started({ userId, deckId, test, scenario });
    open();
  }, [started, open, userId, deckId, test, scenario]);
  useWordLadderKeys({ ' ': start, enter: start }, { enabled: !started });

  useEffect(() => {
    if (item) wordLadderLog.itemShown({ itemId: item.id, type: item.type, task: item.task ?? null, mode: item.mode ?? null, wordId: item.wordId ?? item.word?.wordId ?? null, test });
  }, [item, test]);

  /** After a refused write, ask the server what is on screen now (a 404 there reopens too). */
  const resync = useCallback(async () => {
    if (!session) return;
    const { ok, status, data } = await api.get(session.id, userId);
    if (!live.current) return;
    if (ok && data?.item) { show(data.item, data.progress ?? null); return; }
    if (status === 404) { wordLadderLog.sessionReopened({ userId, deckId, test, from: 'get' }); await open(); }
  }, [api, session, userId, deckId, test, open, show]);

  const respond = useCallback(async (response) => {
    if (!session || !item || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // The item's response goes to the server exactly as the item built it.
    const { ok, status, data } = await api.respond(session.id, { userId, itemId: item.id, response });
    busyRef.current = false;
    if (!live.current) return;
    setBusy(false);
    if (!ok) {
      if (status === 404) { wordLadderLog.sessionReopened({ userId, deckId, test, from: 'respond' }); await open(); return; }
      wordLadderLog.writeFailed({ userId, itemId: item.id, status, test });
      if (status !== 0) await resync();
      return;
    }
    wordLadderLog.itemAnswered({ itemId: item.id, type: item.type, task: item.task ?? null, correct: data?.result?.correct ?? null, score: data?.result?.score ?? null, next: data?.item?.type ?? null, test });
    setProgress(data?.progress ?? null);
    if (GRADED.has(item.type) && data?.result && 'correct' in data.result) {
      setResult(data.result); setPendingItem(data.item ?? null);
      return;
    }
    if (item.type === 'copy' && data?.result?.correct === false) { setResult(data.result); return; }
    setResult(null); setPendingItem(null);
    if (data?.item) setItem(data.item);
  }, [api, session, item, userId, deckId, test, open, resync]);

  const next = useCallback(() => {
    if (!pendingItem) return;
    setItem(pendingItem); setPendingItem(null); setResult(null);
  }, [pendingItem]);

  /** Leave (header) closes as 'leave'; Done (summary) as 'cap' when the time cap was hit, else 'goal'. */
  const closeAndExit = useCallback(async (reason) => {
    wordLadderLog.sittingLeft({ userId, deckId, sittingId: session?.id ?? null, itemId: item?.id ?? null, reason, test });
    if (session && !closedRef.current) {
      closedRef.current = true;
      await api.close(session.id, { userId, reason });
    }
    onExit();
  }, [api, session, item, userId, deckId, test, onExit]);
  const leave = useCallback(() => closeAndExit('leave'), [closeAndExit]);
  const done = useCallback(
    () => closeAndExit(progress?.capMs && progress.activeMs >= progress.capMs ? 'cap' : 'goal'),
    [closeAndExit, progress],
  );

  let body = <p className="wl-loading">Loading…</p>;
  if (!started) {
    body = (
      <div className="wl-item wl-start">
        <h2 className="wl-start__title">{title || 'Words'}</h2>
        <TouchButton variant="primary" keyHint="Space" onClick={start}>Start</TouchButton>
      </div>
    );
  } else if (error) {
    body = (
      <div className="wl-item wl-error" role="alert">
        <p>{error}</p>
        <TouchButton variant="primary" onClick={onExit}>Back</TouchButton>
      </div>
    );
  } else if (item && session) {
    // Item ids repeat across sittings: key by sitting too, so a reopen remounts the card.
    const key = `${session.id}:${item.id}`;
    const common = { item, langs: session.langs, resolveAssetUrl, onRespond: respond, busy, result, onContinue: next };
    if (item.type === 'flashcard') body = <FlashcardItem key={key} {...common} />;
    else if (item.type === 'copy') body = <TypedItem key={key} {...common} mode="copy" />;
    else if (item.type === 'typed') body = <TypedItem key={key} {...common} mode="graded" stageRef={stageRef} />;
    else if (item.type === 'choice') body = <ChoiceItem key={key} {...common} />;
    else body = <SummaryItem key={key} item={item} onExit={done} />;
  }
  const pct = progress?.capMs ? Math.min(100, Math.round((progress.activeMs / progress.capMs) * 100)) : 0;
  const remaining = remainingLabel(progress);
  return (
    <WordLadderStage>
      <div className="wl" ref={stageRef} tabIndex={-1}>
        {test && <div className="wl-test-banner" role="note">TEST — nothing is saved</div>}
        <header className="wl-header">
          <TouchButton variant="secondary" onClick={leave}>Leave</TouchButton>
          <p className="wl-header__round" aria-label="Progress">{roundLabel(progress)}</p>
          <p className="wl-header__piles">{remaining}</p>
          <div className="wl-header__time" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
        </header>
        <main className="wl-main">{body}</main>
      </div>
    </WordLadderStage>
  );
}
