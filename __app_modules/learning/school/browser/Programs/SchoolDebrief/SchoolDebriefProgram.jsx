import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSchoolDebriefApi } from "./schoolDebriefApi.js";
import { schoolDebriefLog } from "./schoolDebriefLog.js";
import { useInputStall } from "../shared/useInputStall.js";
import SchoolDebriefStartCard from "./SchoolDebriefStartCard.jsx";
import SchoolDebriefHeader from "./SchoolDebriefHeader.jsx";
import PromptItem from "./items/PromptItem.jsx";
import ChoiceItem from "./items/ChoiceItem.jsx";
import ShortAnswerItem from "./items/ShortAnswerItem.jsx";
import RetryButton from "./RetryButton.jsx";
import SummaryItem from "./items/SummaryItem.jsx";
import { schoolApi } from "../../schoolApi.js";
import "./SchoolDebrief.scss";

const PROMPTS = [
  { id: 'classes', text: 'What classes or subjects did you have today?', required: false },
  { id: 'learned', text: 'Tell me one thing you learned.', required: true },
  { id: 'notable', text: 'What was hard, funny, or interesting?', required: false },
];
const EXIT_AFTER_MS = 5 * 60 * 1000;
const QUOTE_LIMIT_MS = 2000;
const withLimit = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), QUOTE_LIMIT_MS))]);

export default function SchoolDebriefProgram({ learnerId, debriefGrant, lateDay = null, today: todayProp = null, onExit }) {
  const api = useMemo(() => createSchoolDebriefApi({ learnerId, grant: debriefGrant }), [learnerId, debriefGrant]);
  const [todayView, setTodayView] = useState(null);
  const [day, setDay] = useState(null);       // the study day being worked on (null = start card)
  const [view, setView] = useState(null);
  const [promptIdx, setPromptIdx] = useState(0);
  const [result, setResult] = useState(null);  // the current question's grade, shown before Next
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [nudge, setNudge] = useState(false);
  const [earned, setEarned] = useState(null);
  const [weekBefore, setWeekBefore] = useState(null);
  const [retry, setRetry] = useState(0);
  const [failedStart, setFailedStart] = useState(null);
  const [currentQid, setCurrentQid] = useState(null); // the question on screen; the server's `next` moves on once it is answered

  useEffect(() => { schoolDebriefLog.mounted({ learnerId, lateDay }); return () => schoolDebriefLog.unmounted({ learnerId }); }, [learnerId, lateDay]);
  useEffect(() => {
    if (!debriefGrant || !todayProp) return;
    (async () => {
      const r = await api.day(todayProp);
      if (r.ok) { setTodayView(r.data); setError(null); } else setError('The debrief could not load. Try again.');
    })();
  }, [api, debriefGrant, todayProp, retry]);
  useInputStall(day ? `${day}:${view?.next?.kind}:${view?.next?.id}:${promptIdx}` : 'start', (ms) => {
    schoolDebriefLog.stall({ ms, day });
    if (ms >= 120_000) setNudge(true);
  }, { enabled: Boolean(day) });
  useEffect(() => { if (!nudge) return undefined; const t = setTimeout(() => onExit?.(), EXIT_AFTER_MS - 120_000); return () => clearTimeout(t); }, [nudge, onExit]);
  useEffect(() => {
    const clear = () => setNudge(false);
    window.addEventListener('keydown', clear); window.addEventListener('pointerdown', clear);
    return () => { window.removeEventListener('keydown', clear); window.removeEventListener('pointerdown', clear); };
  }, []);

  const apply = (r) => { if (r.ok) { setView(r.data); setError(null); } else setError(r.data?.error ?? 'Something went wrong. Try again.'); return r.ok; };
  // Coins are shown only when the bank is live (house rule: no silver figure
  // before then). Every read is bounded and a failure reads as "no data".
  const [coinsLive, setCoinsLive] = useState(false);
  const weekSilver = async () => {
    const bank = await withLimit(Promise.resolve().then(() => schoolApi.economyBank(learnerId)).catch(() => null));
    const live = Boolean(bank?.ok && bank.data?.mode === 'live');
    setCoinsLive(live);
    if (!live) return null;
    const r = await withLimit(Promise.resolve().then(() => schoolApi.earningsPreview(learnerId)).catch(() => null));
    return r?.ok ? { total: r.data?.totals?.silver ?? 0, lines: r.data?.lines ?? [] } : null;
  };

  const start = useCallback(async (d) => {
    setBusy(true);
    const r = await api.open(d);
    setBusy(false);
    if (!apply(r)) { setFailedStart(d); return; }
    setFailedStart(null);
    setDay(d);
    const firstMissing = PROMPTS.findIndex((p) => !(p.id in (r.data.entries ?? {})));
    setPromptIdx(firstMissing < 0 ? PROMPTS.length : firstMissing);
    schoolDebriefLog.resume({ day: d, phase: r.data.phase });
    setWeekBefore(await weekSilver());
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeFor = useCallback(async (blob) => { const r = await api.take(day, blob); return r.ok ? r.data : null; }, [api, day]);

  const submitPrompt = async (promptId, body) => {
    setBusy(true);
    const r = await api.entry(day, { promptId, ...body });
    if (apply(r)) {
      const next = PROMPTS.findIndex((p, i) => i > promptIdx && !(p.id in r.data.entries));
      if (next >= 0) setPromptIdx(next);
      else setPromptIdx(PROMPTS.length); // the submit effect below takes it from here
    }
    setBusy(false);
  };
  const answering = useRef(false);
  const answer = async (question, response) => {
    if (answering.current) return;
    answering.current = true;
    setBusy(true);
    setCurrentQid(question.id);
    const r = await api.answer(day, { questionId: question.id, response });
    setBusy(false);
    answering.current = false;
    if (r.ok) setResult(r.data); else setError(r.data?.error ?? 'Try again.');
  };
  // Fetch first, then swap view and clear the grade together: the answered
  // question must never re-render as answerable during the round trip.
  const advance = async () => {
    if (busy) return;
    setBusy(true);
    const r = await api.day(day);
    if (r.ok) { setView(r.data); setResult(null); setError(null); } else setError(r.data?.error ?? 'Something went wrong. Try again.');
    setBusy(false);
  };
  // After the last prompt the server wants a submit. Re-entry with all three
  // entries saved lands here too. Ref-guarded like complete.
  const submitting = useRef(false);
  const readyToSubmit = Boolean(day) && Boolean(view) && promptIdx >= PROMPTS.length && !view.questions
    && !['clarify', 'completed', 'excused'].includes(view.phase) && !busy;
  useEffect(() => {
    if (!readyToSubmit || submitting.current) return;
    submitting.current = true;
    (async () => {
      setBusy(true);
      apply(await api.submit(day));
      setBusy(false);
      submitting.current = false;
    })();
  }, [readyToSubmit, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  // Completing is an effect of the server saying "complete is next", never a
  // side effect of rendering. The ref keeps a re-render from completing twice.
  const completing = useRef(false);
  const readyToComplete = Boolean(day) && view?.next?.kind === 'complete' && !result && !['completed', 'excused'].includes(view?.phase);
  useEffect(() => {
    if (!readyToComplete || completing.current) return;
    completing.current = true;
    (async () => {
      setBusy(true);
      const done = await api.complete(day);
      setBusy(false);
      if (apply(done)) {
        const after = await weekSilver();
        if (after && weekBefore) {
          const before = new Map(weekBefore.lines.map((l) => [l.ruleId, l.amount?.silver ?? 0]));
          const lines = after.lines.filter((l) => (l.amount?.silver ?? 0) > (before.get(l.ruleId) ?? 0))
            .map((l) => ({ ruleId: l.ruleId, label: l.label, silver: (l.amount?.silver ?? 0) - (before.get(l.ruleId) ?? 0), gems: 0 }));
          setEarned({ lines, weekSilver: after.total });
        }
      }
      completing.current = false;
    })();
  }, [readyToComplete, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryAgain = () => { setError(null); if (!day && failedStart) start(failedStart); else setRetry((n) => n + 1); };
  const waiting = (text) => (
    <>
      <p className="sd-thinking" role="status">{text}</p>
      {error && <RetryButton onRetry={tryAgain} />}
    </>
  );

  let body;
  if (!debriefGrant) body = <p className="sd-notice">Open your debrief with the code on your agenda.</p>;
  else if (error && !view && !todayView) body = <><p className="sd-notice">{error}</p><RetryButton onRetry={tryAgain} /></>;
  else if (!day && todayView && !lateDay && ['completed', 'excused'].includes(todayView.phase)) body = <SummaryItem view={todayView} earned={null} coinsLive onFinish={onExit} />;
  else if (!day && error && failedStart) body = <RetryButton onRetry={tryAgain} />;
  else if (!day) body = todayView ? <SchoolDebriefStartCard today={todayView} lateDay={lateDay} onStart={start} /> : <p className="sd-notice">Loading…</p>;
  else if (!view) body = <p className="sd-notice">Loading…</p>;
  else if (['completed', 'excused'].includes(view.phase)) body = <SummaryItem view={view} earned={earned} coinsLive={coinsLive} onFinish={onExit} />;
  else if (promptIdx < PROMPTS.length && !view.questions && view.phase !== 'clarify') {
    const p = PROMPTS[promptIdx];
    body = <PromptItem prompt={p} initial={view.entries?.[p.id]?.text ?? ''} busy={busy} onTake={takeFor} onBack={promptIdx > 0 ? () => setPromptIdx(promptIdx - 1) : null} onSubmit={(b) => submitPrompt(p.id, b)} />;
  } else if (view.phase === 'clarify') {
    body = <PromptItem prompt={{ id: 'clarify', text: view.clarify.prompt, required: true }} initial="" busy={busy} onTake={takeFor} onSubmit={async (b) => { setBusy(true); apply(await api.clarify(day, b)); setBusy(false); }} />;
  } else if (!view.questions) body = waiting('Reading your answer…');
  else if (view.next?.kind === 'question' || result) {
    const q = view.questions.find((x) => x.id === (result ? currentQid : view.next.id));
    body = q.kind === 'choice'
      ? <ChoiceItem question={q} result={result} busy={busy} onAnswer={(o) => answer(q, o)} onContinue={advance} />
      : <ShortAnswerItem question={q} result={result} onTake={takeFor} busy={busy} onAnswer={(t) => answer(q, t)} onContinue={advance} />;
  } else if (view.next?.kind === 'complete') body = waiting('Saving…');
  else body = waiting('Reading your answer…');

  return (
    <div className="sd-program">
      <SchoolDebriefHeader view={view} late={view?.late ?? (day && day === lateDay)} promptIdx={promptIdx} promptCount={PROMPTS.length} />
      {nudge && <p className="sd-nudge" role="status">Still there? Press any key to keep going.</p>}
      {error && view && <p className="sd-notice" role="alert">{error}</p>}
      {body}
    </div>
  );
}
