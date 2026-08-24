import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AbcRenderer } from '../../../MusicNotation/renderers/AbcRenderer.jsx';
import { generateScaleAbc } from '../../../MusicNotation/renderers/abc.js';
import { PianoKeyboard } from '../../components/PianoKeyboard.jsx';
import { WrongNoteGhost } from './WrongNoteGhost.jsx';
import { scaleClefType } from './wrongNoteGhost.js';
import {
  assessmentProgress,
  createAssessmentAttempt,
  createAssessmentRuntime,
  prepareExerciseAssessment,
} from '../../performance/assessmentSession.js';
import { buildPianoAttemptEvidence, pianoAssessmentTelemetry, pianoPersistenceOutcome } from '../../performance/attemptEvidence.js';
import { createPianoChallengeApi } from './pianoChallengeApi.js';
import './PianoChallengeSurface.scss';

const EMPTY_NOTES = new Map();
const EMPTY_HISTORY = [];
const useAlwaysConnected = () => ({ connected: true, status: 'connected' });
const PROVIDER_VERSION = '9-canonical-assessment-evidence';
// A key struck between prepare() and start() — while the card animates and the
// authority round-trips — is noodling, not this attempt's performance. The
// history cursor baselines at prepare, so those note-ons are still pending when
// the attempt opens and would otherwise be graded instantly (a four-note pattern
// "played" in 1ms, timed against targets it never aimed at).
//
// Only timestamps within this window of the start are treated as pre-start
// input. Every note transport stamps Date.now(), so anything older cannot be
// from our clock at all; those are graded rather than risk a clock-domain change
// silently deafening the surface.
const PRE_START_WINDOW_MS = 5 * 60_000;
const SCALE_NOTE_CLASSES = [
  'piano-scale-note--complete',
  'piano-scale-note--next',
  'piano-scale-note--wrong',
];

/** Project the authoritative event structure for engraving and held-note display. */
function promptSequence(prompt = {}) {
  if (!Array.isArray(prompt.expected_events)) return [];
  return prompt.expected_events.flatMap((event) => (
    (event.notes || []).map((note) => note.midi).filter(Number.isFinite)
  ));
}

function assessmentConfig(prepared) {
  const prompt = prepared.prompt || {};
  const assessment = prepared.assessment || {};
  if (!Array.isArray(prompt.expected_events) || prompt.expected_events.length === 0) {
    throw new Error('Piano challenge prompt requires expected_events');
  }
  const instance = {
    id: prompt.exercise_id || prepared.challenge_id,
    revision: prompt.revision ?? null,
    ordering: prepared.kind === 'chord' ? 'any' : 'strict',
    events: prompt.expected_events,
    tempo: { start_bpm: assessment.tempo_bpm },
  };
  const mode = assessment.mode;
  if (!['free', 'metronome', 'cued'].includes(mode)) throw new Error('Piano challenge requires canonical assessment.mode');
  if (prepared.requirement?.mode && prepared.requirement.mode !== mode) {
    throw new Error(`Piano challenge assessment mode ${mode} does not match requirement mode ${prepared.requirement.mode}`);
  }
  const assessmentBpm = Number(assessment.tempo_bpm);
  const requiredBpm = Number(prepared.requirement?.gates?.pace?.target_bpm);
  if (mode === 'cued' && requiredBpm > 0 && assessmentBpm !== requiredBpm) {
    throw new Error(`Piano challenge assessment tempo ${assessmentBpm || 'missing'} does not match requirement tempo ${requiredBpm}`);
  }
  const configured = prepareExerciseAssessment({ instance, mode, purpose: 'challenge', requirement: prepared.requirement });
  return createAssessmentAttempt({ ...configured, clock: 'piano-challenge' });
}

function scaleNoteElements(staffNotes) {
  return (staffNotes || []).flatMap((staff) => (
    (staff || []).map((note) => note.els || [])
  ));
}

function heldProjection(activeNotes, expectedMidi) {
  if (!activeNotes?.size) return 'empty';
  const actual = new Set(activeNotes.keys());
  const expected = new Set(expectedMidi);
  return actual.size === expected.size && [...actual].every((midi) => expected.has(midi)) ? 'correct' : 'wrong';
}

export function clearScaleNoteFeedback(staffNotes) {
  for (const elements of scaleNoteElements(staffNotes)) {
    for (const element of elements) element.classList?.remove(...SCALE_NOTE_CLASSES);
  }
}

/** Apply the scale's progress directly to abcjs's engraved note elements. */
export function applyScaleNoteFeedback(staffNotes, progress, lastInput = null) {
  const notes = scaleNoteElements(staffNotes);
  clearScaleNoteFeedback(staffNotes);
  notes.forEach((elements, index) => {
    let className = null;
    if (index < progress) className = 'piano-scale-note--complete';
    else if (index === progress) {
      className = lastInput?.status === 'wrong'
        ? 'piano-scale-note--wrong'
        : 'piano-scale-note--next';
    }
    if (!className) return;
    for (const element of elements) element.classList?.add(className);
  });
}

function makeAttemptId() {
  return `attempt-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/**
 * Piano challenge adapter for the generic gaming runtime. Semantic game
 * requests are materialized by Piano's backend policy into canonical events;
 * this adapter translates live MIDI into a scored result.
 * The legacy export name remains stable for the existing standalone route.
 */
export function createPianoChordProvider({
  useNotes,
  useConnection = useAlwaysConnected,
  clock = () => Date.now(),
  services = createPianoChallengeApi(),
}) {
  if (typeof useNotes !== 'function') throw new Error('createPianoChordProvider requires a useNotes hook');
  if (typeof useConnection !== 'function') throw new Error('createPianoChordProvider useConnection must be a hook');
  return {
    id: 'piano',
    version: PROVIDER_VERSION,
    capabilities: () => [
      { kind: 'chord', modes: ['untimed'] },
      { kind: 'scale', modes: ['untimed', 'ordered', 'paced'] },
      { kind: 'arpeggio', modes: ['untimed', 'ordered', 'paced'] },
      { kind: 'timed-pattern', modes: ['untimed', 'ordered', 'paced'] },
    ],
    async createRuntime({ userId, logger, services: runtimeServices = services }) {
      const listeners = new Set();
      let snapshot = {
        status: 'idle', prepared: null, armed: false, hadWrong: false, progress: 0, lastInput: null,
      };
      let resolveAttempt = null;
      let settled = false;
      let attemptStartedAt = null;
      let firstInputAt = null;
      let notesPlayed = 0;
      let wrongNotes = 0;
      let wrongInputs = [];
      let restarts = 0;
      let timeoutHandle = null;
      let chordReleasedSinceStart = false;
      let staleInputsIgnored = 0;
      let assessmentRuntime = null;
      let lastOnsetSpanMs = null;
      let terminalMetrics = {};

      const clearDeadline = () => {
        if (timeoutHandle !== null) globalThis.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      };

      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) listener();
      };
      const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

      const timedMetrics = (metrics = {}) => ({
        ...metrics,
        durationMs: attemptStartedAt == null ? null : Math.max(0, clock() - attemptStartedAt),
        timeToFirstInputMs: attemptStartedAt == null || firstInputAt == null ? null : Math.max(0, firstInputAt - attemptStartedAt),
        notesPlayed,
        wrongNotes,
        wrongInputs,
        restarts,
        staleInputsIgnored,
      });

      const recordInput = () => {
        if (firstInputAt == null) firstInputAt = clock();
        notesPlayed += 1;
      };

      /** True for a note-on stamped before this attempt opened. See PRE_START_WINDOW_MS. */
      const isPreStartInput = (entry) => {
        if (attemptStartedAt == null || !Number.isFinite(entry?.startTime)) return false;
        const age = attemptStartedAt - entry.startTime;
        return age > 0 && age <= PRE_START_WINDOW_MS;
      };

      /**
       * Write the attempt to the piano ledger. Mutates `result` with the stored
       * id and persistence timings, and never throws — a lost network call must
       * not swallow the player's turn.
       */
      const persistAttempt = async (result, prepared, { keepalive = false } = {}) => {
        const persistenceStartedAt = clock();
        const evidence = buildPianoAttemptEvidence({
          result,
          attemptId: result.attempt_id,
          challengeId: prepared.challenge_id,
          kind: prepared.kind,
          purpose: 'challenge',
          prompt: prepared.prompt,
          context: {
            ...(result.context || {}),
            surface: result.context?.surface ?? 'piano-challenge',
            matcher: assessmentRuntime?.getSnapshot()?.matcher ?? null,
            mode: prepared.assessment?.mode ?? null,
          },
          gradingPolicyVersion: prepared.grading_policy_version,
          providerVersion: PROVIDER_VERSION,
          extra: { assessment: prepared.assessment },
        });
        try {
          const savedOutcome = await runtimeServices.recordAttempt(userId, evidence, { keepalive });
          const saved = savedOutcome?.data ?? savedOutcome;
          const persistenceStatus = Number.isFinite(Number(savedOutcome?.status))
            ? Number(savedOutcome.status)
            : 201;
          result.attempt_id = saved?.attempt_id ?? result.attempt_id;
          logger?.info?.('piano.challenge-assessment', pianoAssessmentTelemetry(evidence, {
            outcome: savedOutcome?.ok === false ? pianoPersistenceOutcome(savedOutcome) : 'saved',
            status: persistenceStatus,
            durationMs: Math.max(0, clock() - persistenceStartedAt),
          }));
        } catch (error) {
          logger?.warn?.('piano.challenge-assessment', pianoAssessmentTelemetry(evidence, {
            outcome: pianoPersistenceOutcome({ ok: false, status: error?.status ?? 0 }),
            status: error?.status ?? 0,
            error: error.message,
            durationMs: Math.max(0, clock() - persistenceStartedAt),
          }));
          result.attempt_id = null;
          result.metrics = { ...result.metrics, persistenceError: true };
        }
        result.metrics.persistenceDurationMs = Math.max(0, clock() - persistenceStartedAt);
        return result;
      };

      const settle = async (canonicalResult, state, metrics = {}) => {
        if (settled || !resolveAttempt) return;
        settled = true;
        clearDeadline();
        const status = canonicalResult?.status || state?.status || 'error';
        publish({ status: status === 'completed' ? 'complete' : status });
        const { keepalive = false, ...terminalDetails } = terminalMetrics;
        const finalMetrics = timedMetrics({
          firstTry: wrongNotes === 0,
          wrongAttemptSeen: wrongNotes > 0,
          notesRequired: canonicalResult?.diagnostics?.expected_notes,
          pitchAccuracy: canonicalResult?.criteria?.cleanliness,
          pitchSetAccuracy: snapshot.prepared?.kind === 'chord' ? canonicalResult?.criteria?.completeness : undefined,
          timingAccuracy: canonicalResult?.criteria?.placement,
          continuity: canonicalResult?.criteria?.cleanliness,
          tempoBpm: snapshot.prepared?.assessment?.tempo_bpm || null,
          ...(Number.isFinite(lastOnsetSpanMs) ? { onsetSpanMs: lastOnsetSpanMs } : {}),
          ...terminalDetails,
          ...metrics,
        });
        const result = {
          ...canonicalResult,
          status,
          metrics: finalMetrics,
          provider_version: PROVIDER_VERSION,
          attempt_id: makeAttemptId(),
          context: snapshot.prepared?.context ?? null,
          purpose: 'challenge',
        };
        if (status === 'completed' || state?.musicalInput) await persistAttempt(result, snapshot.prepared, { keepalive });
        resolveAttempt(result);
        resolveAttempt = null;
      };

      const installAssessment = (prepared) => {
        assessmentRuntime?.dispose();
        assessmentRuntime = createAssessmentRuntime({
          attempt: assessmentConfig(prepared),
          now: clock,
          tickMs: 20,
          onEvent(event, state) {
            const progress = assessmentProgress(state).matchedNotes;
            if (event.type === 'wrong') {
              wrongNotes = state.wrong.length;
              const expected = state.expectation.events[state.cursor]?.notes?.[0]?.midi ?? null;
              if (wrongInputs.length < 3) wrongInputs.push({ played: event.midi ?? null, expected, progress: snapshot.progress });
              publish({ progress, hadWrong: true, lastInput: { note: event.midi ?? null, status: 'wrong' } });
            } else if (['hit', 'onset_complete'].includes(event.type)) {
              const noteId = event.noteIds?.[0];
              const midi = state.expectation.events.flatMap((item) => item.notes).find((note) => note.id === noteId)?.midi ?? null;
              publish({ progress, lastInput: { note: midi, status: 'correct' } });
            } else if (event.type === 'miss') {
              publish({ progress });
            }
          },
          onTerminal(result, state) { void settle(result, state); },
        });
      };

      function Surface({ compact = false, headerContext = null } = {}) {
        const view = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
        const notes = useNotes();
        const connection = useConnection();
        const [virtualActiveNotes, setVirtualActiveNotes] = useState(EMPTY_NOTES);
        const [virtualNoteHistory, setVirtualNoteHistory] = useState(EMPTY_HISTORY);
        const virtualActiveNotesRef = useRef(EMPTY_NOTES);
        const assessmentRuntimeRef = useRef(assessmentRuntime);
        assessmentRuntimeRef.current = assessmentRuntime;
        const usingVirtualKeyboard = connection?.connected === false;
        const inputSource = usingVirtualKeyboard ? 'virtual' : 'midi';
        const activeNotes = usingVirtualKeyboard
          ? virtualActiveNotes
          : notes?.activeNotes || EMPTY_NOTES;
        const noteHistory = usingVirtualKeyboard
          ? virtualNoteHistory
          : notes?.noteHistory || EMPTY_HISTORY;
        const liveChordMatch = view.prepared?.kind === 'chord'
          ? heldProjection(activeNotes, promptSequence(view.prepared.prompt))
          : 'empty';
        const historyCursor = useRef(null);
        const [inputReady, setInputReady] = useState(false);
        const staffNotesRef = useRef([]);
        const challengeId = view.prepared?.challenge_id;
        // The staff box as a callback ref rather than a plain one: the ghost
        // overlay needs the element during RENDER, and a ref is still null on
        // the pass that mounts it.
        const [staffBox, setStaffBox] = useState(null);
        // Bumped on every abcjs paint. abcjs re-engraves on resize, which
        // replaces every note element and moves the staff lines, so the ghost
        // must re-read the geometry — and this render is also what refreshes
        // the anchor element it is measured against.
        const [engraving, setEngraving] = useState({ nonce: 0, clefType: null });

        const handleVirtualNoteOn = useCallback((note, velocity = 90) => {
          if (virtualActiveNotesRef.current.has(note)) return;
          const timestamp = clock();
          const next = new Map(virtualActiveNotesRef.current);
          next.set(note, { velocity, timestamp });
          virtualActiveNotesRef.current = next;
          setVirtualActiveNotes(next);
          setVirtualNoteHistory((history) => [
            ...history,
            { note, velocity, timestamp, startTime: timestamp },
          ]);
          if (['scale', 'arpeggio', 'timed-pattern'].includes(snapshot.prepared?.kind)) {
            recordInput();
            assessmentRuntimeRef.current?.observe({ midi: note, time: timestamp, clock: 'piano-challenge' });
          }
        }, []);

        const handleVirtualNoteOff = useCallback((note) => {
          if (!virtualActiveNotesRef.current.has(note)) return;
          const next = new Map(virtualActiveNotesRef.current);
          next.delete(note);
          virtualActiveNotesRef.current = next;
          setVirtualActiveNotes(next);
        }, []);

        const handleScaleRender = useCallback((tune, staffNotes) => {
          clearScaleNoteFeedback(staffNotesRef.current);
          staffNotesRef.current = staffNotes;
          applyScaleNoteFeedback(staffNotes, snapshot.progress, snapshot.lastInput);
          setEngraving((prev) => ({ nonce: prev.nonce + 1, clefType: scaleClefType(tune) }));
        }, []);

        useLayoutEffect(() => {
          applyScaleNoteFeedback(staffNotesRef.current, view.progress, view.lastInput);
          return () => clearScaleNoteFeedback(staffNotesRef.current);
        }, [view.progress, view.lastInput]);

        // Arm chord listening before the challenge panel is painted whenever
        // the keyboard is already released. A fast player can otherwise press
        // the first chord between paint and the normal effect and remain
        // permanently unarmed until releasing it.
        useLayoutEffect(() => {
          if (view.status === 'running'
            && view.prepared?.kind === 'chord'
            && activeNotes.size === 0) {
            chordReleasedSinceStart = true;
            if (!view.armed) publish({ armed: true });
          }
        }, [activeNotes, view.armed, view.prepared?.kind, view.status]);

        useLayoutEffect(() => {
          if (view.status !== 'running'
            || view.prepared?.kind !== 'chord'
            || (!view.armed && !chordReleasedSinceStart)) return;
          if (activeNotes.size > 0) {
            if (firstInputAt == null) firstInputAt = clock();
            notesPlayed = Math.max(notesPlayed, activeNotes.size);
            const timestamps = [...activeNotes.values()].map((value) => value.timestamp).filter(Number.isFinite);
            lastOnsetSpanMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
          }
          assessmentRuntime?.observe({ held: activeNotes, time: clock(), clock: 'piano-challenge' });
        }, [activeNotes, liveChordMatch, view.armed, view.prepared, view.status]);

        useLayoutEffect(() => {
          historyCursor.current = noteHistory.length;
          setInputReady(true);
          // Baseline once per challenge or input-source switch. Depending on
          // noteHistory itself would erase every fresh note before the
          // processing effect below can consume it.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [challengeId, inputSource]);

        useEffect(() => {
          if (usingVirtualKeyboard || view.status !== 'running' || !view.prepared) return;
          const { kind, prompt } = view.prepared;
          if (['scale', 'arpeggio', 'timed-pattern'].includes(kind)) {
            if (historyCursor.current === null) historyCursor.current = noteHistory.length;
            const pending = noteHistory.slice(historyCursor.current);
            historyCursor.current = noteHistory.length;
            if (pending.length === 0) return;
            const freshNotes = pending.filter((entry) => !isPreStartInput(entry));
            if (freshNotes.length < pending.length) {
              const ignored = pending.filter(isPreStartInput);
              staleInputsIgnored += ignored.length;
              logger?.warn?.('piano.challenge.pre-start-input-ignored', {
                challengeId: view.prepared.challenge_id,
                kind,
                exerciseId: prompt.exercise_id || null,
                ignored: ignored.length,
                oldestAgeMs: Math.round(Math.max(...ignored.map((entry) => attemptStartedAt - entry.startTime))),
                staleInputsIgnored,
              });
            }
            if (freshNotes.length === 0) return;
            for (const entry of freshNotes) {
              recordInput();
              assessmentRuntime?.observe({
                midi: entry.note,
                time: Number.isFinite(entry.startTime) ? entry.startTime : clock(),
                clock: 'piano-challenge',
              });
            }
            return;
          }

        }, [activeNotes, noteHistory, usingVirtualKeyboard, view.status, view.prepared, view.armed]);

        const prompt = view.prepared?.prompt;
        const expectedMidi = promptSequence(prompt);
        const expectedCount = expectedMidi.length;
        const lowestExpected = expectedMidi.length > 0 ? Math.min(...expectedMidi) : 60;
        const highestExpected = expectedMidi.length > 0 ? Math.max(...expectedMidi) : 72;
        const keyboardStart = Math.max(21, lowestExpected - 5);
        const keyboardEnd = Math.min(108, Math.max(highestExpected + 5, keyboardStart + 19));
        const virtualKeyboard = usingVirtualKeyboard ? (
          <div className="piano-challenge__virtual-input" role="group" aria-label="On-screen piano keyboard">
            <span>No piano connected — tap the keys below.</span>
            <PianoKeyboard
              activeNotes={virtualActiveNotes}
              startNote={keyboardStart}
              endNote={keyboardEnd}
              showLabels
              onNoteOn={handleVirtualNoteOn}
              onNoteOff={handleVirtualNoteOff}
            />
          </div>
        ) : null;
        if (['scale', 'arpeggio', 'timed-pattern'].includes(view.prepared?.kind)) {
          const abc = generateScaleAbc(expectedMidi, prompt.key_signature || 'C');
          // The ghost shows only for a wrong note, and only until the next input
          // resolves it. It hangs off the note the player OWED — which after a
          // wrong note is wherever the scale restarted, the same element wearing
          // the red mark — so the two always read as one comparison.
          const wrongMidi = view.lastInput?.status === 'wrong' ? view.lastInput.note : null;
          const anchor = wrongMidi == null
            ? null
            : (staffNotesRef.current?.[0]?.[view.progress]?.els?.[0] ?? null);
          return (
            <section
              className={`piano-challenge piano-scale-challenge${usingVirtualKeyboard ? ' has-virtual-keyboard' : ''}`}
              data-challenge-status={view.status}
              data-input-ready={inputReady && view.status === 'running' ? 'true' : 'false'}
              data-assessment-started-at={attemptStartedAt ?? ''}
            >
              <header className="piano-scale-challenge__heading">
                <span>
                  {headerContext ? `${headerContext}${view.prepared.assessment?.tempo_bpm ? ` · ${view.prepared.assessment.tempo_bpm} BPM` : ''}`
                    : view.prepared.assessment?.tempo_bpm ? `Play with the pulse · ${view.prepared.assessment.tempo_bpm} BPM` : 'Play from left to right'}
                </span>
                <strong>{prompt.label}</strong>
              </header>
              <div className="piano-scale-challenge__staff" ref={setStaffBox}>
                <AbcRenderer abc={abc} scale={1} singleLine fitContent onRender={handleScaleRender} />
                <WrongNoteGhost
                  container={staffBox}
                  anchor={anchor}
                  midi={wrongMidi}
                  clefType={engraving.clefType}
                  keyName={prompt.key_signature}
                  engraving={engraving.nonce}
                />
              </div>
              <div
                className={`piano-scale-challenge__feedback${view.lastInput?.status === 'wrong' ? ' is-wrong' : ''}`}
                aria-live="polite"
              >
                <strong>{view.progress} / {expectedCount}</strong>
                <span>
                  {view.lastInput?.status === 'wrong'
                    ? 'Not that one — correct the highlighted note and keep going'
                    : view.progress > 0
                      ? 'Correct — keep going'
                      : 'Play the highlighted first note'}
                </span>
              </div>
              {virtualKeyboard}
            </section>
          );
        }
        return (
          <section
            className={`piano-challenge${usingVirtualKeyboard ? ' has-virtual-keyboard' : ''}`}
            data-challenge-status={view.status}
            data-chord-armed={view.armed ? 'true' : 'false'}
            data-active-notes={[...activeNotes.keys()].join(',')}
            data-chord-match={liveChordMatch}
            data-assessment-started-at={attemptStartedAt ?? ''}
          >
            <div>{compact && headerContext ? headerContext : 'Play this chord'}</div>
            <div className="piano-challenge__chord">{prompt?.label || '…'}</div>
            <div>{view.status === 'running'
              ? usingVirtualKeyboard ? 'Listening to the on-screen keys' : 'Listening to the piano'
              : 'Getting ready'}</div>
            {view.hadWrong && <div>Release and try again</div>}
            {virtualKeyboard}
          </section>
        );
      }

      return {
        Surface,
        ready: Promise.resolve(),
        async prepare(request) {
          const selected = request.prompt
            ? {
              prompt: structuredClone(request.prompt),
              assessment: structuredClone(request.assessment || { mode: 'free', tempo_bpm: null, lead_in_ms: 0 }),
              requirement: request.requirement ? structuredClone(request.requirement) : null,
              timeout_ms: request.timeout_ms ?? null,
            }
            : await runtimeServices.prepareChallenge(userId, {
              challenge_id: request.challenge_id,
              kind: request.kind,
              requirements: request.requirements,
              context: request.context,
            });
          const prepared = {
            challenge_id: request.challenge_id,
            kind: request.kind,
            prompt: structuredClone(selected.prompt),
            assessment: structuredClone(selected.assessment),
            timeout_ms: selected.timeout_ms ?? request.timeout_ms ?? null,
            pedagogy_policy_version: selected.pedagogy_policy_version || null,
            selection: selected.selection ? structuredClone(selected.selection) : null,
            grading_policy_version: selected.grading_policy_version
              || selected.requirement?.rubric?.id
              || (request.kind === 'chord'
                ? 'pitch-set-simultaneity-v1'
                : selected.assessment?.mode === 'cued'
                  ? 'paced-pitch-timing-continuity-v1'
                  : 'untimed-pitch-continuity-v1'),
            provider_version: PROVIDER_VERSION,
            requirement: selected.requirement ? structuredClone(selected.requirement) : null,
            context: request.context ? structuredClone(request.context) : null,
          };
          installAssessment(prepared);
          publish({ status: 'prepared', prepared, armed: false, hadWrong: false, progress: 0, lastInput: null });
          return prepared;
        },
        async restore(prepared) {
          installAssessment(prepared);
          publish({ status: 'prepared', prepared: structuredClone(prepared), armed: false, hadWrong: false, progress: 0, lastInput: null });
          return prepared;
        },
        async start(prepared) {
          clearDeadline();
          // prepare()/restore() own construction; start transitions that same
          // attempt so already-mounted input callbacks cannot retain a stale
          // prepared runtime while a replacement is running elsewhere.
          if (!assessmentRuntime) installAssessment(prepared);
          settled = false;
          attemptStartedAt = clock();
          firstInputAt = null;
          notesPlayed = 0;
          wrongNotes = 0;
          wrongInputs = [];
          restarts = 0;
          chordReleasedSinceStart = false;
          staleInputsIgnored = 0;
          lastOnsetSpanMs = null;
          terminalMetrics = {};
          const promise = new Promise((resolve) => { resolveAttempt = resolve; });
          assessmentRuntime.start({
            time: attemptStartedAt,
            leadInMs: prepared.assessment?.lead_in_ms || 0,
            clock: 'piano-challenge',
          });
          // The assessment must be running before the surface advertises that
          // it accepts input. React external-store subscribers may render and
          // dispatch a fast virtual/MIDI note during publish().
          publish({ status: 'running', prepared, armed: false, hadWrong: false, progress: 0, lastInput: null });
          const timeoutMs = Number(prepared.timeout_ms);
          if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeoutHandle = globalThis.setTimeout(() => {
              terminalMetrics = { reason: 'challenge_timeout', timeoutMs };
              assessmentRuntime?.timeout();
            }, timeoutMs);
          }
          return promise;
        },
        cancel(reason = 'aborted') {
          terminalMetrics = { reason };
          assessmentRuntime?.abort();
        },
        dispose() {
          clearDeadline();
          if (!settled && resolveAttempt) {
            terminalMetrics = { reason: 'disposed', keepalive: true };
            assessmentRuntime?.abort();
          }
          assessmentRuntime?.dispose();
          listeners.clear();
        },
      };
    },
  };
}

export default createPianoChordProvider;
