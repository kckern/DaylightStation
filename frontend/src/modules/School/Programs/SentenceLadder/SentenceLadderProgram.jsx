import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { languageApi } from './languageApi.js';
import { languageLog } from './languageLog.js';
import { useCapabilities } from './useCapabilities.js';
import RepetitionRung from './rungs/RepetitionRung.jsx';
import TypedRung from './rungs/TypedRung.jsx';
import RecordingRung from './rungs/RecordingRung.jsx';
import ReviewPanel from './ReviewPanel.jsx';
import PacingControl from './PacingControl.jsx';
import DeviceSettings from './DeviceSettings.jsx';
import './SentenceLadder.scss';

const RUNG_LABELS = {
  repetition: 'Repetition',
  dictation: 'Dictation',
  recording: 'Recording',
  interpretation: 'Interpretation',
};

/**
 * The sentence-ladder program shell (design §5).
 *
 * Owns the day: fetches it, walks the learner rung by rung through the chain
 * the server says this device supports, and re-fetches after each save so the
 * queue stays derived rather than mirrored in component state. That re-fetch
 * is the whole point — the 2016 app kept a client-side copy of the queue and
 * that is precisely what desynchronised.
 *
 * Requires an identified learner. A guest produces no records, so the program
 * shows a sign-in prompt rather than a drill that silently discards work.
 */
export default function SentenceLadderProgram({
  userId, corpusId, studyGrant, onSignIn, onExit = null, locked = false, preview = false,
}) {
  const [day, setDay] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error | empty
  const [activeRung, setActiveRung] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('study'); // study | review
  // Sticky for the sitting: the first Play is what grants browser audio
  // activation, and everything after it can run hands-free.
  const [armed, setArmed] = useState(false);
  const loadGeneration = useRef(0);
  const loadController = useRef(null);
  const progressEmission = useRef(null);

  const languages = day?.corpus?.languages;
  const {
    capabilities, ready: capsReady, toggleLanguage, toggleMicrophone, hasHardwareKeyboard,
  } = useCapabilities(corpusId, languages);

  const load = useCallback(async () => {
    if (!corpusId || (!preview && (!userId || !studyGrant))) return;
    const generation = ++loadGeneration.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const { ok, status: httpStatus, data } = preview
      ? await languageApi.previewDay(corpusId, capabilities, controller.signal)
      : await languageApi.day(userId, corpusId, capabilities, studyGrant, controller.signal);
    if (generation !== loadGeneration.current) return;
    if (!ok) {
      languageLog.programError('day-failed', { corpus: corpusId, status: httpStatus });
      setStatus('error');
      return;
    }
    setDay(data);
    setStatus(data.queue.length === 0 ? 'empty' : 'ready');
    languageLog.program('day-loaded', {
      corpus: corpusId, day: data.day, total: data.summary.total, done: data.summary.done,
    });
  }, [userId, corpusId, capabilities, studyGrant, preview]);

  useEffect(() => {
    languageLog.program('mounted', { corpus: corpusId, userId });
    return () => {
      loadGeneration.current += 1;
      loadController.current?.abort();
      languageLog.program('unmounted', { corpus: corpusId });
    };
  }, [corpusId, userId]);

  useEffect(() => {
    if (!capsReady && day === null) {
      // First load runs without capabilities so we can learn the corpus's
      // languages; the hook needs them to pick a sensible text-input default.
      load();
      return;
    }
    if (capsReady) load();
  }, [capsReady, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!day) return;
    const current = day.summary || { total: 0, done: 0 };
    const settled = current.done === current.total;
    const empty = current.total === 0;
    const blocked = settled && (day.missingCreditRungs?.length ?? 0) > 0;
    const key = `${day.day}:${current.done}:${current.total}:${empty}:${blocked}`;
    if (progressEmission.current === key) return;
    progressEmission.current = key;
    languageLog.program('progress', {
      corpus: corpusId,
      day: day.day,
      done: current.done,
      total: current.total,
      complete: settled && !blocked,
      empty,
      blockedByDevice: blocked,
    });
  }, [corpusId, day]);

  // Group the queue by rung, in the order the server's chain reports. Rungs
  // absent from the chain never appear, so a blocked rung cannot be selected.
  const groups = useMemo(() => {
    if (!day) return [];
    return (day.chain || [])
      .map((rung) => ({
        rung,
        label: RUNG_LABELS[rung] || rung,
        items: day.queue.filter((e) => e.rung === rung),
      }))
      .filter((g) => g.items.length > 0);
  }, [day]);

  // Land on the first rung with work outstanding rather than always the first
  // rung — resuming mid-day should not replay finished work.
  useEffect(() => {
    if (!groups.length) { setActiveRung(null); return; }
    const stillValid = groups.some((g) => g.rung === activeRung && g.items.some((i) => !i.done));
    if (stillValid) return;
    const nextGroup = groups.find((g) => g.items.some((i) => !i.done)) || groups[0];
    setActiveRung(nextGroup.rung);
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const group = groups.find((g) => g.rung === activeRung) || null;
  const pending = group ? group.items.filter((i) => !i.done) : [];
  const entry = pending[0] || null;
  const nextEntry = pending[1] || null;

  const audioUrl = useCallback(
    (seq, lang) => languageApi.audioUrl(corpusId, seq, lang),
    [corpusId],
  );

  /**
   * Save one attempt, then re-derive the day from the server. A failure is
   * surfaced, never swallowed: an unrecorded attempt that looks recorded is
   * how a learner loses a session's work without knowing.
   */
  const onComplete = useCallback(async ({ seq, rung, given, blob }) => {
    if (preview) {
      // The preview has no identity, grant, or mutable endpoint.  Completion
      // is a browser-only affordance so a teacher can experience the ladder
      // without manufacturing learner evidence or retaining a recording.
      setDay((current) => {
        if (!current) return current;
        const queue = current.queue.map((item) => (
          item.seq === seq && item.rung === rung ? { ...item, done: true } : item
        ));
        const done = queue.filter((item) => item.done).length;
        return { ...current, queue, summary: { total: queue.length, done } };
      });
      return { ok: true, preview: true };
    }
    setSaving(true);
    setNotice(null);
    const result = blob
      ? await languageApi.recording(userId, corpusId, seq, blob, capabilities, studyGrant)
      : await languageApi.log(userId, { corpus: corpusId, seq, rung, given }, capabilities, studyGrant);
    setSaving(false);

    if (!result.ok) {
      languageLog.attemptError('record-failed', { corpus: corpusId, seq, rung, status: result.status });
      setNotice(
        result.status === 403
          ? 'Sign in to have your work saved.'
          : 'That answer was not saved — check the connection and try again.',
      );
      return result;
    }
    languageLog.attempt('saved', { corpus: corpusId, seq, rung });
    await load();
    return result;
  }, [userId, corpusId, capabilities, studyGrant, load, preview]);

  const onRoll = useCallback(async () => {
    const { ok, data } = await languageApi.roll(userId, corpusId, capabilities, studyGrant);
    if (ok && data?.rolled) {
      languageLog.pacing('rolled', { corpus: corpusId, day: data.day });
      await load();
    } else {
      setNotice(
        data?.reason === 'before-boundary'
          ? 'Come back tomorrow for the next set.'
          : 'Finish today\'s set first.',
      );
    }
  }, [userId, corpusId, capabilities, studyGrant, load]);

  const onPacing = useCallback(async (dailyLimit) => {
    const { ok } = await languageApi.pacing(userId, corpusId, dailyLimit, studyGrant);
    if (ok) {
      languageLog.pacing('changed', { corpus: corpusId, dailyLimit });
      await load();
    }
  }, [userId, corpusId, studyGrant, load]);

  // A guest is stopped, but never stranded: the picker lives one level up and
  // was previously reachable only by knowing the header chip was tappable.
  if (!preview && (!userId || !corpusId || !studyGrant)) {
    const needsLaunch = Boolean(userId) && (!corpusId || !studyGrant);
    return (
      <div className="lang-program lang-program--guest">
        <p className="lang-program__guest-copy">
          {needsLaunch
            ? 'Type your code or scan your agenda to start Sentence Ladder.'
            : 'Sign in to study — a guest\'s work isn\'t saved.'}
        </p>
        {onSignIn && (
          <button type="button" className="lang-btn lang-btn--primary" onClick={onSignIn}>
            {locked ? 'Type your code again' : 'Sign in'}
          </button>
        )}
      </div>
    );
  }
  if (status === 'loading') return <div className="lang-program lang-program--loading">Loading…</div>;
  if (status === 'error') {
    return (
      <div className="lang-program lang-program--error">
        <p>Could not load today&apos;s set.</p>
        <button type="button" className="lang-btn" onClick={load}>Try again</button>
      </div>
    );
  }

  const summary = day?.summary || { total: 0, done: 0 };
  const percent = summary.total ? Math.round((100 * summary.done) / summary.total) : 0;
  const noSteps = status === 'empty' || summary.total === 0;
  const settled = summary.done === summary.total;
  const allDone = summary.total > 0 && settled;
  const missingCreditRungs = day?.missingCreditRungs ?? [];
  const blockedByDevice = settled && missingCreditRungs.length > 0;
  const sessionFinished = settled && !blockedByDevice;
  const exitHandler = onExit ?? onSignIn;

  return (
    <div className="lang-program">
      {/* No back control and no course title here: the School shell already
          renders both above this component, and the first pass stacked a
          second chevron with the same destination directly beneath the
          first. */}
      <header className="lang-program__header">
        <div className="lang-program__identity">
          <span className="lang-program__eyebrow">{preview ? 'Sentence Ladder · guest preview — nothing is saved' : 'Today\'s session'}</span>
          <h2 className="lang-program__day">{preview ? `${day?.corpus?.label ?? 'Sentence Ladder'} · Day ${day?.day}` : `Day ${day?.day}`}</h2>
        </div>
        <div className="lang-program__actions">
          {!preview && !locked && <PacingControl value={day?.dailyLimit} onChange={onPacing} />}
          {!locked && <DeviceSettings
            languages={languages}
            capabilities={capabilities}
            onToggleLanguage={toggleLanguage}
            onToggleMic={toggleMicrophone}
          />}
          {locked && onExit && !sessionFinished && (
            <button
              type="button"
              className="lang-btn lang-btn--quiet"
              data-testid="selfservice-section-exit"
              onClick={onExit}
            >
              Leave for now
            </button>
          )}
        </div>
      </header>

      <div className="lang-program__progress-copy">
        <span>{summary.done} of {summary.total} steps</span>
        <span>{Math.max(0, summary.total - summary.done)} left</span>
      </div>
      <div
        className="lang-program__progress"
        role="progressbar"
        aria-label={`${summary.done} of ${summary.total} session steps complete`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="lang-program__progress-bar" style={{ width: `${percent}%` }} />
      </div>
      {missingCreditRungs.length > 0 && !settled && (
        <p className="lang-program__notice" role="alert">
          Finish {missingCreditRungs.map((rung) => RUNG_LABELS[rung] || rung).join(' and ')} on a device with the needed input.
        </p>
      )}

      <nav className="lang-program__tabs" aria-label="Session modes">
        {groups.map((g) => {
          const left = g.items.filter((i) => !i.done).length;
          return (
            <button
              key={g.rung}
              type="button"
              className={`lang-tab${g.rung === activeRung && tab === 'study' ? ' is-active' : ''}`}
              aria-pressed={g.rung === activeRung && tab === 'study'}
              onClick={() => { setTab('study'); setActiveRung(g.rung); }}
            >
              {g.label}
              {left > 0 && <span className="lang-tab__badge">{left}</span>}
            </button>
          );
        })}
        {!preview && <button
          type="button"
          className={`lang-tab${tab === 'review' ? ' is-active' : ''}`}
          aria-pressed={tab === 'review'}
          onClick={() => setTab('review')}
        >
          Review
        </button>}
      </nav>

      {notice && <p className="lang-program__notice" role="alert">{notice}</p>}

      <main className="lang-program__body">
        {tab === 'review' && !preview && <ReviewPanel userId={userId} corpusId={corpusId} studyGrant={studyGrant} />}

        {tab === 'study' && (allDone || noSteps) && (
          <div className="lang-program__complete">
            {blockedByDevice ? (
              <p role="status">
                Continue on a device that can complete {missingCreditRungs.map((rung) => RUNG_LABELS[rung] || rung).join(' and ')} before today can be credited.
              </p>
            ) : noSteps ? (
              <p role="status">Nothing is due in this course today.</p>
            ) : (
              <p role="status">
                {preview
                  ? `Preview complete. These ${summary.total} steps were only tried in this browser and were not saved.`
                  : `Day ${day?.day} complete. All ${summary.total} steps are saved and count toward today’s School progress.`}
              </p>
            )}
            {sessionFinished && locked && exitHandler && (
              <button type="button" className="lang-btn lang-btn--primary" onClick={exitHandler}>Done</button>
            )}
            {allDone && !preview && !blockedByDevice && !locked && (
              <button type="button" className="lang-btn lang-btn--primary" onClick={onRoll}>Start the next day</button>
            )}
          </div>
        )}

        {tab === 'study' && !allDone && entry && entry.rung === 'repetition' && (
          <RepetitionRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} nextEntry={nextEntry} audioUrl={audioUrl}
            onComplete={onComplete} saving={saving}
            autoStart={armed}
            onActivate={() => setArmed(true)}
          />
        )}
        {tab === 'study' && !allDone && entry && (entry.rung === 'dictation' || entry.rung === 'interpretation') && (
          <TypedRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} nextEntry={nextEntry} audioUrl={audioUrl}
            onComplete={onComplete} saving={saving}
            showShortcuts={hasHardwareKeyboard}
          />
        )}
        {tab === 'study' && !allDone && entry && entry.rung === 'recording' && (
          <RecordingRung
            key={`${entry.rung}-${entry.seq}`}
            entry={entry} audioUrl={audioUrl}
            onComplete={onComplete} saving={saving}
            onDisableMicrophone={toggleMicrophone}
          />
        )}
      </main>

    </div>
  );
}
