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
import { languageName } from './languageNames.js';
import ReadingPips from '../../reading/ReadingPips.jsx';
import './SentenceLadder.scss';

const RUNG_LABELS = {
  repetition: 'Repetition',
  dictation: 'Dictation',
  recording: 'Recording',
  interpretation: 'Interpretation',
};
/** The order a sentence climbs; the ladder is drawn in it whatever the chain omits. */
const RUNG_ORDER = ['repetition', 'dictation', 'recording', 'interpretation'];

/**
 * What a rung this device cannot climb is actually short of — the text under a
 * dimmed rung. It used to be one hardcoded line, "Needs a microphone", printed
 * whatever the rung wanted: the yellow-room tablet has a mic and an
 * English-only keyboard, so the rung it blocks is DICTATION, and the card sent
 * the child hunting for a microphone already in their hands. The server now
 * says which capability is missing (`missingCreditNeeds`), because the ladder
 * domain is the one place that mapping lives.
 */
function needNote(need) {
  if (need?.kind === 'microphone') return 'Needs a microphone — on another device';
  // A textInput requirement can arrive naming no language: `resolveRole` yields
  // null when the corpus's languages map has no entry for the rung's role, and
  // the wrapper object around that null is still truthy, so it survives every
  // check upstream and reaches here intact. Fall through rather than print it —
  // a child must never be shown a card reading "Needs a null keyboard".
  //
  // No matching server-side warning, deliberately: a corpus that cannot name
  // both its languages is refused outright by `validateCorpus`, so this shape
  // cannot come from a validated corpus. What it CAN come from is the payload —
  // an older server, a truncated response — which is exactly why the guard
  // belongs on this side and not there.
  if (need?.kind === 'textInput' && need.language) {
    return `Needs a ${languageName(need.language)} keyboard — on another device`;
  }
  // A rung the server could not explain still says something true: it is out of
  // reach here. Silence would leave a dimmed rung with no reason at all.
  return 'Not available on this device';
}

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
  const missingCreditNeeds = day?.missingCreditNeeds ?? {};
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
          <h2 className="lang-program__day">{preview ? `${day?.corpus?.label ?? 'Sentence Ladder'}, day ${day?.day}` : `Day ${day?.day}`}</h2>
          {/* ONE statement of the day's progress, beside its name. It used to
              be three — this line, a "15 left" on the right, and a bar between
              them — and the ladder below now carries it per rung besides. */}
          <p
            className="lang-program__steps"
            role="progressbar"
            aria-label={`${summary.done} of ${summary.total} session steps complete`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {preview ? 'Guest preview, nothing is saved · ' : ''}{summary.done} of {summary.total} steps
          </p>
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

      {notice && <p className="lang-program__notice" role="alert">{notice}</p>}

      <div className="lang-program__split">
        {/* THE LADDER. The rungs are a SEQUENCE a sentence climbs — hear it,
            write it, say it, translate it — and the first pass drew them as a
            row of peer tabs, which said "pick one". Drawn as a ladder they
            read top to bottom as the order they happen in, each rung wearing
            its own pips (one per sentence, filled as done — the same notation
            the reading shelf and the living-room rail use), the rung in hand
            lit. It is navigation and progress in one object; a rung this
            device cannot climb says so in a quiet line rather than a banner.
            The Review shelf sits below the ladder: it is not a rung. */}
        <nav className="lang-ladder" aria-label="Session modes">
          <ol className="lang-ladder__rungs">
            {/* Every rung the day has, in climbing order — including one this
                device cannot climb. The server's chain omits an unsupported
                rung, so it never has a group; drawing it anyway, dimmed, is
                what tells a child on the Portal that the ladder has a rung
                their device skips, rather than a banner shouting it. */}
            {RUNG_ORDER.filter((rung) => groups.some((g) => g.rung === rung) || missingCreditRungs.includes(rung)).map((rung) => {
              const g = groups.find((x) => x.rung === rung) ?? null;
              const label = RUNG_LABELS[rung] || rung;
              const blocked = missingCreditRungs.includes(rung);
              if (!g || blocked) {
                return (
                  <li key={rung} className="lang-ladder__rung">
                    <div className="lang-ladder__step is-blocked" role="button" aria-disabled="true" aria-label={label}>
                      <span className="lang-ladder__label">{label}</span>
                      <span className="lang-ladder__note">{needNote(missingCreditNeeds[rung])}</span>
                    </div>
                  </li>
                );
              }
              const done = g.items.filter((i) => i.done).length;
              const active = g.rung === activeRung && tab === 'study';
              return (
                <li key={rung} className="lang-ladder__rung">
                  <button
                    type="button"
                    className={`lang-ladder__step${active ? ' is-active' : ''}${done === g.items.length ? ' is-done' : ''}`}
                    aria-pressed={active}
                    onClick={() => { setTab('study'); setActiveRung(g.rung); }}
                  >
                    <span className="lang-ladder__label">{label}</span>
                    {/* The lit rung's next pip is the sentence in hand — held
                        still: a wall panel does not pulse. */}
                    <ReadingPips
                      count={done}
                      target={g.items.length}
                      label={`${done} of ${g.items.length} ${label.toLowerCase()} sentences`}
                      className="lang-ladder__pips"
                      testId={`ladder-pips-${rung}`}
                      live={active && !allDone}
                      moving={false}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
          {!preview && (
            <button
              type="button"
              className={`lang-ladder__review${tab === 'review' ? ' is-active' : ''}`}
              aria-pressed={tab === 'review'}
              onClick={() => setTab('review')}
            >
              Review
            </button>
          )}
        </nav>

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

        {/* While the ladder is still filling up, a day is topped up with extra
            passes over its own new sentences. Say so: the same sentence
            arriving at three rungs in one sitting reads as a bug without it. */}
        {tab === 'study' && !allDone && entry?.practice && (
          <p className="lang-program__practice" role="status">Extra practice — this one doesn’t move up yet</p>
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
    </div>
  );
}
