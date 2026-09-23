import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TouchButton } from '../../../../../lib/ui/index.js';
import { sidesFromOpen } from './targetScript.js';
import CardLadderStage from './CardLadderStage.jsx';
import FlashcardItem from './items/FlashcardItem.jsx';
import ChoiceItem from './items/ChoiceItem.jsx';
import TypedItem from './items/TypedItem.jsx';
import SummaryItem from './items/SummaryItem.jsx';
import SayItem from './items/SayItem.jsx';
import DrillItem from './items/DrillItem.jsx';
import DrillOfferItem from './items/DrillOfferItem.jsx';
import MatchItem from './items/MatchItem.jsx';
import ListenItem from './items/ListenItem.jsx';
import MenuItem from './items/MenuItem.jsx';
import { createCardLadderApi } from './cardLadderApi.js';
import { cardLadderLog, setTrace, clearTrace } from './cardLadderLog.js';
import { createTrace } from './createTrace.js';
import { useItemStall } from './useItemStall.js';
import { layoutForItem, mediaForItem } from './itemLayout.js';
import { stopAudio } from './cardLadderAudio.js';
import { useCardLadderKeys } from './useCardLadderKeys.js';
import { currentInput, noteInput, noteKeyEvent } from './inputVia.js';
import CardLadderStartCard from './CardLadderStartCard.jsx';
import CardLadderHeader from './CardLadderHeader.jsx';
import { STEP_HINTS, stepTrail } from './stepTrail.js';
import './CardLadder.scss';

/** Items whose answer the server grades: the verdict stays on screen until Next. */
const GRADED = new Set(['choice', 'typed']);
/**
 * Drill steps whose verdict is also held until Next once the step advances
 * (type: the answer is shown; tiles and dictation: a match, or the third miss
 * — "It's X" must be seen before the next step replaces it).
 */
const HELD_DRILL_STEPS = new Set(['type', 'tiles', 'dictation']);
/** Items with a text field: a letter shortcut there is a jamo (on 두벌식 M is ㅡ), never a command. */
const TYPING_DRILL_STEPS = new Set(['copy', 'dictation', 'type']);
const isTyping = (item) => item?.type === 'copy' || item?.type === 'typed' || (item?.type === 'drill' && TYPING_DRILL_STEPS.has(item.step));
const holdsVerdict = (item) => GRADED.has(item.type) || (item.type === 'drill' && HELD_DRILL_STEPS.has(item.step));

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

/** How long a step's hint stays up if the child does nothing; and its fade-out (>= --ds-motion-base, 200ms). */
const HINT_MS = 6000;
const HINT_FADE_MS = 250;

function remainingLabel(progress) {
  const round = progress?.phase === 'round' ? progress.round : null;
  if (!round) return null;
  if (round.phase === 'stream') return `${round.remainingInStream} left`;
  if (round.phase === 'quiz') return `${round.quizLeft} left`;
  return null;
}

/**
 * The card ladder (mastery redesign rev 4, spec §6). The server owns the day:
 * it picks every item and grades every answer. This renders one item at a
 * time inside the config-sized stage. `descriptor.test` = a read-only test
 * sitting (banner, `/card-ladder/test/*` API, optional `scenario` seed).
 *
 * A graded answer comes back with the NEXT item; the verdict is shown on the
 * current item until Next. A copy mismatch keeps the item. A 404 means the
 * sitting is gone (the study day rolled, or a test sitting was evicted) — the
 * program reopens.
 *
 * Nothing is opened on mount: the child taps Start first (spec §6). That tap is
 * the page's user gesture, so every clip after it may autoplay.
 */
export default function CardLadderProgram({ descriptor, api: injected = null, resolveAssetUrl = (id) => id, onExit = () => {} }) {
  const { userId = null, deckId = null, test = false, scenario = null, title = null } = descriptor ?? {};
  const api = useMemo(() => injected ?? createCardLadderApi({ test }), [injected, test]);
  // One trace per mount (spec §8) — created once, bound to the cardLadderLog
  // facade for this component's lifetime so every event below (and every
  // item's facade call, via the ambient binding) is stamped with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => createTrace({ learnerId: userId, deckId, mode: test ? 'test' : 'live' }), []);
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
  // When the CURRENT item was shown, for item.answered's `ms`.
  const itemShownAtRef = useRef(null);
  // When the current verdict panel appeared, for result.dismissed's `ms`.
  const resultShownAtRef = useRef(null);
  // Per-round tallies for round.ended {quizzed, notYet} — reset whenever
  // progress.round.index changes (see the round-tracking effect below).
  const roundRef = useRef({ index: null, quizzed: 0, notYet: 0 });
  // Plain assignment on every render (mirrors TypedItem's fieldDisabledRef) —
  // the unmount effect below runs once at mount, so its cleanup closes over
  // whatever `progress`/`item` were on THAT render (always the initial
  // null/null) unless read through a ref that stays current instead.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const itemRef = useRef(item);
  itemRef.current = item;
  // item.layout {fontPx} (spec §8, follow-up to item.shown) — logged once per
  // item from the main FitText's first computed size, not on every resize.
  const layoutReportedForRef = useRef(null);
  const handleLayout = useCallback((fontPx) => {
    const current = itemRef.current;
    if (!current || layoutReportedForRef.current === current.id) return;
    layoutReportedForRef.current = current.id;
    cardLadderLog.itemLayout({ itemId: current.id, fontPx });
  }, []);

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
      cardLadderLog.planFailed({ userId, deckId, status, test });
      return;
    }
    setError(null);
    sittingRef.current = data.sittingId;
    closedRef.current = false;
    trace.setSitting(data.sittingId);
    trace.setPackage(data.package ?? null);
    setSession({ id: data.sittingId, langs: sidesFromOpen(data) });
    show(data.item, data.progress ?? null);
    cardLadderLog.sittingOpened({ package: data.package ?? null, first: data.item.type, phase: data.progress?.phase ?? null });
  }, [api, userId, deckId, scenario, test, show, trace]);

  useEffect(() => {
    live.current = true;
    setTrace(trace);
    cardLadderLog.mounted({ userId, deckId, test, scenario });
    const onVisibility = () => cardLadderLog.visibility({ state: document.visibilityState });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live.current = false;
      const openId = sittingRef.current;
      if (openId && !closedRef.current) {
        closedRef.current = true;
        const p = progressRef.current;
        const remaining = p?.capMs != null && p?.activeMs != null ? Math.max(0, p.capMs - p.activeMs) : null;
        cardLadderLog.sittingClosed({
          sittingId: openId, itemId: itemRef.current?.id ?? null, reason: 'unmount', activeMs: p?.activeMs ?? null, remaining,
        });
        // Fire-and-forget: the component is gone; the client never throws.
        api.close(openId, { userId, reason: 'unmount' });
      }
      sittingRef.current = null;
      // Leaving mid-clip must not leave a word talking over whatever is next.
      stopAudio();
      cardLadderLog.unmounted({ userId, deckId, test, sittingId: openId ?? null });
      document.removeEventListener('visibilitychange', onVisibility);
      clearTrace(trace);
    };
  }, [api, open, userId, deckId, test, scenario, trace]);

  // The start card's facts (read-only GET …/intro): nothing opens before Start.
  const [intro, setIntro] = useState(null);
  useEffect(() => {
    if (typeof api.intro !== 'function' || !userId || !deckId) return undefined;
    let alive = true;
    (async () => {
      const { ok, status, data } = await api.intro({ userId, deckId, scenario });
      if (!alive) return;
      if (!ok || !data) { cardLadderLog.introFailed({ status, test }); return; }
      setIntro(data);
      cardLadderLog.introShown({
        hasPoster: typeof data.poster === 'string' && data.poster.length > 0,
        newCount: data.today?.newCount ?? null, reviewCount: data.today?.reviewCount ?? null,
        learned: data.progress?.learned ?? null, recognised: data.progress?.recognised ?? null, total: data.progress?.total ?? null,
      });
    })();
    return () => { alive = false; };
  }, [api, userId, deckId, scenario, test]);
  const posterFailed = useCallback(() => {
    cardLadderLog.mediaFailed({ kind: 'poster', src: intro?.poster ?? null });
  }, [intro]);

  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    cardLadderLog.started({ userId, deckId, test, scenario });
    open();
  }, [started, open, userId, deckId, test, scenario]);
  useCardLadderKeys({ ' ': start, enter: start }, { enabled: !started });

  useEffect(() => {
    if (!item) return;
    itemShownAtRef.current = Date.now();
    const media = mediaForItem(item);
    // `itemMode`, not `mode`: createTrace's event() stamps the trace's own
    // live/test `mode` over any colliding payload key, so an item.shown that
    // sent `mode: item.mode` had its intro/sort/practice distinction
    // silently replaced by 'live'/'test' the moment a trace was bound.
    cardLadderLog.itemShown({
      itemId: item.id, type: item.type, task: item.task ?? null, itemMode: item.mode ?? null,
      wordId: item.wordId ?? item.word?.wordId ?? null, layout: layoutForItem(item), media, fontPx: null,
    });
    // A cue that asked for image/audio media but the server sent no asset for
    // it: the prompt fell back to plain text before the child ever saw a
    // picture or heard a sound (distinct from media.failed, which is an
    // asset that DID resolve but then failed to load in the browser).
    const assetMissing = ((item.cue?.type === 'image' || (item.cue?.type === 'anchor' && item.cue.image)) && !(item.assets?.image || item.word?.media?.image))
      || (item.cue?.type === 'audio' && !(item.assets?.audio || item.assets?.glossAudio || item.word?.media?.audio));
    if (assetMissing) cardLadderLog.promptFallback({ itemId: item.id, cue: item.cue.type });
  }, [item]);

  // spec §8 item.stalled — 45s / 120s of no input on the current item.
  // `visibility` tells a child gone quiet from a hidden tab (screen off, app
  // switched); `screen` says whether the item or a held verdict was up.
  useItemStall(item?.id ?? null, (ms) => {
    if (!item) return;
    cardLadderLog.itemStalled({
      itemId: item.id, ms, visibility: typeof document !== 'undefined' ? document.visibilityState : null, screen: pendingItem || result ? 'result' : 'item',
    });
  });

  // The header's step trail, and each step's hint — once per step per sitting,
  // gone on the first input or after HINT_MS (fade = opacity only).
  const trail = useMemo(() => stepTrail(progress, item), [progress, item]);
  const [hint, setHint] = useState(null);
  const hintsSeenRef = useRef(new Set());
  const lastStepRef = useRef(null);
  useEffect(() => {
    const step = trail.current;
    if (step === lastStepRef.current) return;
    lastStepRef.current = step;
    if (!step) return;
    cardLadderLog.stepEntered({ step, round: progress?.round?.index ?? null });
    if (hintsSeenRef.current.has(step)) { setHint(null); return; }
    hintsSeenRef.current.add(step);
    setHint({ step, text: STEP_HINTS[step], leaving: false });
    cardLadderLog.hintShown({ step });
  }, [trail.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismissHint = useCallback(() => setHint((h) => (h && !h.leaving ? { ...h, leaving: true } : h)), []);
  useEffect(() => {
    if (!hint) return undefined;
    if (hint.leaving) {
      const gone = setTimeout(() => setHint((h) => (h === hint ? null : h)), HINT_FADE_MS);
      return () => clearTimeout(gone);
    }
    const timer = setTimeout(dismissHint, HINT_MS);
    window.addEventListener('keydown', dismissHint, true);
    window.addEventListener('pointerdown', dismissHint, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', dismissHint, true);
      window.removeEventListener('pointerdown', dismissHint, true);
    };
  }, [hint, dismissHint]);

  /** After a refused write, ask the server what is on screen now (a 404 there reopens too). */
  const resync = useCallback(async () => {
    if (!session) return;
    const { ok, status, data } = await api.get(session.id, userId);
    if (!live.current) return;
    if (ok && data?.item) { show(data.item, data.progress ?? null); return; }
    if (status === 404) { cardLadderLog.sessionReopened({ userId, deckId, test, from: 'get' }); await open(); }
  }, [api, session, userId, deckId, test, open, show]);

  // `meta` rides on item.answered only (e.g. SayItem's `micOff`); the server sees `response`.
  const respond = useCallback(async (response, meta = null) => {
    if (!session || !item || busyRef.current) return;
    // Read now, before the round trip: how the child answered (spec §8 input).
    const input = currentInput();
    dismissHint();
    busyRef.current = true;
    setBusy(true);
    // The item's response goes to the server exactly as the item built it.
    const { ok, status, data } = await api.respond(session.id, { userId, itemId: item.id, response });
    busyRef.current = false;
    if (!live.current) return;
    setBusy(false);
    if (!ok) {
      if (status === 404) { cardLadderLog.sessionReopened({ userId, deckId, test, from: 'respond' }); await open(); return; }
      cardLadderLog.writeFailed({ userId, itemId: item.id, status, test });
      if (status !== 0) await resync();
      return;
    }
    cardLadderLog.itemAnswered({
      itemId: item.id, type: item.type, task: item.task ?? null, response,
      correct: data?.result?.correct ?? null, score: data?.result?.score ?? null,
      judge: data?.result?.judge ?? null, next: data?.item?.type ?? null,
      ms: itemShownAtRef.current != null ? Date.now() - itemShownAtRef.current : null, input,
      ...(meta && typeof meta === 'object' ? meta : {}),
    });
    // Best-effort per-round tally for round.ended {quizzed, notYet} — a
    // sorted-to-notYet flashcard, or a graded quiz answer (choice/typed,
    // which only ever carry a task once they're in a round's quiz phase).
    if (response?.sort === 'notYet') roundRef.current.notYet += 1;
    if ((item.type === 'choice' || item.type === 'typed') && item.task) roundRef.current.quizzed += 1;
    setProgress(data?.progress ?? null);
    // A retry: the server kept the same item (copy / dictation / tiles miss) — stay on it, say so.
    const showResult = (held) => {
      resultShownAtRef.current = Date.now();
      cardLadderLog.resultShown({
        itemId: item.id, correct: data.result.correct ?? null, score: data.result.score ?? null, judge: data.result.judge ?? null, held,
      });
    };
    if (data?.result?.correct === false && (data?.item?.id === item.id || (item.type === 'copy' && !data?.item))) {
      setResult(data.result); setPendingItem(null);
      showResult(false); // a retry: the item stays, with its miss shown
      return;
    }
    if (holdsVerdict(item) && data?.result && 'correct' in data.result) {
      setResult(data.result); setPendingItem(data.item ?? null);
      showResult(true); // held until Next
      return;
    }
    setResult(null); setPendingItem(null);
    if (data?.item) setItem(data.item);
  }, [api, session, item, userId, deckId, test, open, resync, dismissHint]);

  const next = useCallback(() => {
    if (!pendingItem) return;
    cardLadderLog.resultDismissed({
      itemId: item?.id ?? null, via: currentInput(), ms: resultShownAtRef.current != null ? Date.now() - resultShownAtRef.current : null,
    });
    setItem(pendingItem); setPendingItem(null); setResult(null);
  }, [pendingItem, item]);

  // round.started / round.ended (spec §8) — derived from progress.round.index
  // changing, since the server doesn't send a dedicated transition event to
  // the frontend. {quizzed, notYet} are the tallies `respond()` accumulated
  // above for the round that just ended.
  useEffect(() => {
    const round = progress?.round ?? null;
    const prevIndex = roundRef.current.index;
    if (round?.index === prevIndex) return;
    if (prevIndex != null) {
      cardLadderLog.roundEnded({ index: prevIndex, quizzed: roundRef.current.quizzed, notYet: roundRef.current.notYet });
    }
    roundRef.current = { index: round?.index ?? null, quizzed: 0, notYet: 0 };
    if (round) cardLadderLog.roundStarted({ index: round.index, size: round.size ?? null });
  }, [progress?.round?.index]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Leave (header) closes as 'leave'; Done (summary) as 'cap' when the time cap was hit, else 'goal'. */
  const closeAndExit = useCallback(async (reason) => {
    const remaining = progress?.capMs != null && progress?.activeMs != null
      ? Math.max(0, progress.capMs - progress.activeMs) : null;
    cardLadderLog.sittingClosed({ sittingId: session?.id ?? null, itemId: item?.id ?? null, reason, activeMs: progress?.activeMs ?? null, remaining });
    if (session && !closedRef.current) {
      closedRef.current = true;
      await api.close(session.id, { userId, reason });
    }
    onExit();
  }, [api, session, item, userId, test, onExit, progress]);
  const leave = useCallback(() => closeAndExit('leave'), [closeAndExit]);
  const done = useCallback(
    () => closeAndExit(progress?.capMs && progress.activeMs >= progress.capMs ? 'cap' : 'goal'),
    [closeAndExit, progress],
  );

  /** The menu started a practice run: show its first item, or recover like a refused write. */
  const practiceStarted = useCallback(async ({ ok, status, data }) => {
    if (!live.current) return;
    if (ok && data?.item) { show(data.item, data.progress ?? null); return; }
    cardLadderLog.practiceFailed({ userId, sittingId: session?.id ?? null, status, error: data?.error ?? null, test });
    if (status === 404) { cardLadderLog.sessionReopened({ userId, deckId, test, from: 'practice' }); await open(); return; }
    if (status !== 0) await resync();
  }, [show, userId, deckId, session, test, open, resync]);

  /** Learn more words (ruling 2026-09-23): one more guided round, from the menu or the summary. */
  const learnMore = useCallback(async (from) => {
    if (!session || !item || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    cardLadderLog.learnMoreStarted({ from, count: item.learnMore ?? null });
    const { ok, status, data } = await api.learnMore(session.id, { userId });
    busyRef.current = false;
    if (!live.current) return;
    setBusy(false);
    if (ok && data?.item) { show(data.item, data.progress ?? null); return; }
    cardLadderLog.learnMoreFailed({ userId, sittingId: session.id, status, error: data?.error ?? null, test });
    if (status === 404) { cardLadderLog.sessionReopened({ userId, deckId, test, from: 'learn-more' }); await open(); return; }
    if (status !== 0) await resync();
  }, [api, session, item, userId, deckId, test, show, open, resync]);

  /** Any practice item can end the run early: back to the menu. */
  const inPractice = item?.source === 'practice';
  // Not while a held verdict waits for Next: the server has already moved past that item.
  const toMenu = useCallback(() => { if (!pendingItem) respond({ menu: true }); }, [respond, pendingItem]);
  useCardLadderKeys({ m: toMenu }, { enabled: Boolean(inPractice) && !isTyping(item) });
  // The error screen's only way out has a key too.
  useCardLadderKeys({ ' ': onExit, enter: onExit }, { enabled: Boolean(started && error) });

  let body = <p className="wl-loading">Loading…</p>;
  if (!started) {
    body = <CardLadderStartCard intro={intro} fallbackTitle={title} onStart={start} onPosterFailed={posterFailed} />;
  } else if (error) {
    body = (
      <div className="wl-item wl-error" role="alert">
        <p>{error}</p>
        <TouchButton variant="primary" keyHint="Space" onClick={onExit}>Back</TouchButton>
      </div>
    );
  } else if (item && session) {
    // Item ids repeat across sittings: key by sitting too, so a reopen remounts the card.
    const key = `${session.id}:${item.id}`;
    const common = { item, langs: session.langs, resolveAssetUrl, onRespond: respond, busy, result, onContinue: next, onLayout: handleLayout };
    const speaking = { api, sittingId: session.id, userId };
    if (item.type === 'flashcard') body = <FlashcardItem key={key} {...common} />;
    else if (item.type === 'copy') body = <TypedItem key={key} {...common} mode="copy" />;
    else if (item.type === 'typed') body = <TypedItem key={key} {...common} mode="graded" stageRef={stageRef} />;
    else if (item.type === 'choice') body = <ChoiceItem key={key} {...common} />;
    else if (item.type === 'say') body = <SayItem key={key} {...common} {...speaking} mode={item.mode} />;
    else if (item.type === 'drill') body = <DrillItem key={key} {...common} {...speaking} pending={Boolean(pendingItem)} stageRef={stageRef} />;
    else if (item.type === 'drill-offer') body = <DrillOfferItem key={key} {...common} />;
    else if (item.type === 'match') body = <MatchItem key={key} {...common} />;
    else if (item.type === 'listen') body = <ListenItem key={key} {...common} />;
    else if (item.type === 'menu') {
      body = (
        <MenuItem
          key={key} item={item} api={api} sittingId={session.id} userId={userId} deckId={deckId}
          langs={session.langs} onPractice={practiceStarted} onLearnMore={learnMore} onExit={done}
        />
      );
    } else body = <SummaryItem key={key} item={item} onRespond={respond} onLearnMore={learnMore} busy={busy} onExit={done} />;
  }
  const pct = progress?.capMs ? Math.min(100, Math.round((progress.activeMs / progress.capMs) * 100)) : 0;
  const remaining = remainingLabel(progress);
  return (
    <CardLadderStage>
      {/* How the child acts, noted centrally (spec §8 input): a touch on any
          button, or an Enter that submits a field (which useCardLadderKeys
          never sees). Keys it maps note themselves. Nothing here logs. */}
      <div
        className="wl" ref={stageRef} tabIndex={-1}
        onPointerDownCapture={() => noteInput('touch')}
        onKeyDownCapture={(event) => { if (event.key === 'Enter') noteKeyEvent(event); }}
      >
        {test && <div className="wl-test-banner" role="note">TEST — nothing is saved</div>}
        <CardLadderHeader
          trail={trail}
          onExit={leave}
          timePct={pct}
          hint={hint}
          right={inPractice
            ? <TouchButton variant="secondary" keyHint="M" disabled={busy || Boolean(pendingItem)} onClick={toMenu}>Menu</TouchButton>
            : <p className="wl-header__piles">{remaining}</p>}
        />
        <main className="wl-main">{body}</main>
      </div>
    </CardLadderStage>
  );
}
