import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AbcRenderer } from '../../../MusicNotation/renderers/AbcRenderer.jsx';
import { generateScaleAbc } from '../../../MusicNotation/renderers/abc.js';
import { matchHeldSet } from '../../performance/heldSet.js';
import { PianoKeyboard } from '../../components/PianoKeyboard.jsx';
import { advanceScaleProgress } from './scaleProgress.js';
import { WrongNoteGhost } from './WrongNoteGhost.jsx';
import { scaleClefType } from './wrongNoteGhost.js';
import { gradeChordPerformance, gradeOrderedPerformance, timingQuality } from '../../performance/grading.js';

const EMPTY_NOTES = new Map();
const EMPTY_HISTORY = [];
const useAlwaysConnected = () => ({ connected: true, status: 'connected' });
const PROVIDER_VERSION = '7-pre-start-input-guard';
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

function assessmentFor(prepared, status, score, metrics) {
  if (status !== 'completed' || !Number.isFinite(score) || !prepared?.prompt?.exercise_id) return {};
  const criteria = {
    completeness: metrics.failed ? 0 : 1,
    cleanliness: Number.isFinite(metrics.pitchSetAccuracy)
      ? metrics.pitchSetAccuracy
      : Number.isFinite(metrics.pitchAccuracy) ? metrics.pitchAccuracy : score,
    ...(Number.isFinite(metrics.timingAccuracy) ? { placement: metrics.timingAccuracy } : {}),
  };
  const targetBpm = prepared.requirement?.gates?.pace?.target_bpm;
  const actualBpm = Number.isFinite(metrics.tempoBpm) ? metrics.tempoBpm : null;
  const gates = Number.isFinite(targetBpm) ? {
    pace: { passed: Number.isFinite(actualBpm) && actualBpm >= targetBpm, actual: actualBpm, target: targetBpm },
  } : undefined;
  const thresholds = prepared.requirement?.rubric?.criteria ?? {};
  const thresholdEntries = Object.entries(thresholds);
  const criteriaPassed = thresholdEntries.length
    ? thresholdEntries.every(([name, threshold]) => (
      Number.isFinite(criteria[name]) && criteria[name] >= threshold
    ))
    : score >= 0.6;
  const passed = criteriaPassed && (!gates || Object.values(gates).every((gate) => gate.passed));
  const diagnosticEntries = {
    achieved_bpm: actualBpm,
    wrong_notes: metrics.wrongNotes,
    onset_spread_ms: metrics.onsetSpanMs,
    duration_ms: metrics.durationMs,
  };
  return {
    purpose: 'challenge',
    criteria,
    ...(gates ? { gates } : {}),
    diagnostics: Object.fromEntries(Object.entries(diagnosticEntries).filter(([, value]) => Number.isFinite(value))),
    rubric: {
      id: prepared.requirement?.rubric?.id ?? prepared.grading_policy_version,
      version: String(prepared.requirement?.rubric?.version ?? '1'),
    },
    verdict: { score, passed },
  };
}

function scaleNoteElements(staffNotes) {
  return (staffNotes || []).flatMap((staff) => (
    (staff || []).map((note) => note.els || [])
  ));
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
 * Piano challenge adapter for the generic gaming runtime. Authored legacy prompts
 * remain supported, while semantic game requests are materialized by Piano's
 * backend policy. This adapter translates live MIDI into a scored result.
 * The legacy export name remains stable for the existing standalone route.
 */
export function createPianoChordProvider({ useNotes, useConnection = useAlwaysConnected, clock = () => Date.now() }) {
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
    async createRuntime({ userId, api, logger }) {
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
      let timingQualities = [];
      let timeoutHandle = null;
      let chordReleasedSinceStart = false;
      let staleInputsIgnored = 0;

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
        try {
          const saved = await api.recordPianoAttempt(userId, {
            ...result,
            challenge_id: prepared.challenge_id,
            kind: prepared.kind,
            grading_policy_version: prepared.grading_policy_version,
            prompt: prepared.prompt,
          }, { keepalive });
          result.attempt_id = saved.attempt_id;
        } catch (error) {
          logger?.warn?.('piano-challenge-attempt-save-failed', { error: error.message });
          result.attempt_id = null;
          result.metrics = { ...result.metrics, persistenceError: true };
        }
        result.metrics.persistenceDurationMs = Math.max(0, clock() - persistenceStartedAt);
        return result;
      };

      const settle = async (status, score, metrics) => {
        if (settled || !resolveAttempt) return;
        settled = true;
        clearDeadline();
        publish({ status: status === 'completed' ? 'complete' : status });
        const finalMetrics = timedMetrics(metrics);
        const result = {
          status, score, metrics: finalMetrics,
          provider_version: PROVIDER_VERSION,
          attempt_id: makeAttemptId(),
          context: snapshot.prepared?.context ?? null,
          ...assessmentFor(snapshot.prepared, status, score, finalMetrics),
        };
        await persistAttempt(result, snapshot.prepared);
        resolveAttempt(result);
        resolveAttempt = null;
      };

      const finish = (score, metrics) => settle('completed', score, metrics);

      const finishChord = (prompt, heldNotes) => {
        if (heldNotes.size > 0) {
          if (firstInputAt == null) firstInputAt = clock();
          notesPlayed = Math.max(notesPlayed, heldNotes.size);
        }
        const firstTry = !snapshot.hadWrong;
        if (!prompt.exercise_id) {
          finish(firstTry ? 1 : 0.5, { firstTry, wrongAttemptSeen: !firstTry });
          return;
        }
        const timestamps = [...heldNotes.values()].map((value) => value.timestamp).filter(Number.isFinite);
        const onsetSpanMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
        const grading = gradeChordPerformance({
          targetNotes: prompt.pitch_classes.length,
          wrongAttempts: wrongNotes,
          onsetSpanMs,
        });
        finish(grading.score, {
          firstTry,
          wrongAttemptSeen: !firstTry,
          pitchSetAccuracy: grading.pitchSetAccuracy,
          simultaneity: grading.simultaneity,
          onsetSpanMs,
        });
      };

      function Surface({ compact = false, headerContext = null } = {}) {
        const view = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
        const notes = useNotes();
        const connection = useConnection();
        const [virtualActiveNotes, setVirtualActiveNotes] = useState(EMPTY_NOTES);
        const [virtualNoteHistory, setVirtualNoteHistory] = useState(EMPTY_HISTORY);
        const virtualActiveNotesRef = useRef(EMPTY_NOTES);
        const usingVirtualKeyboard = connection?.connected === false;
        const inputSource = usingVirtualKeyboard ? 'virtual' : 'midi';
        const activeNotes = usingVirtualKeyboard
          ? virtualActiveNotes
          : notes?.activeNotes || EMPTY_NOTES;
        const noteHistory = usingVirtualKeyboard
          ? virtualNoteHistory
          : notes?.noteHistory || EMPTY_HISTORY;
        const liveChordCard = view.prepared?.kind === 'chord'
          ? { root: view.prepared.prompt.root, pitchClasses: new Set(view.prepared.prompt.pitch_classes || []) }
          : null;
        const liveChordMatch = matchHeldSet(activeNotes, liveChordCard);
        const historyCursor = useRef(null);
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

        // Callback refs run at the exact DOM commit represented by the chord
        // diagnostics below. Keep this idempotent completion path alongside the
        // effects so rapid external-store updates cannot paint "correct" while
        // React defers the effect that settles the attempt.
        const handleChordCommit = useCallback((node) => {
          if (!node
            || settled
            || view.status !== 'running'
            || view.prepared?.kind !== 'chord'
            || (!view.armed && !chordReleasedSinceStart)
            || liveChordMatch !== 'correct') return;
          finishChord(view.prepared.prompt, new Map(activeNotes));
        }, [activeNotes, liveChordMatch, view.armed, view.prepared, view.status]);

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
          const prompt = view.prepared.prompt;
          if (activeNotes.size > 0) {
            if (firstInputAt == null) firstInputAt = clock();
            notesPlayed = Math.max(notesPlayed, activeNotes.size);
          }
          if (liveChordMatch === 'wrong') {
            if (!snapshot.hadWrong) wrongNotes += 1;
            publish({ hadWrong: true });
          }
          if (liveChordMatch !== 'correct') return;
          finishChord(prompt, activeNotes);
        }, [activeNotes, liveChordMatch, view.armed, view.prepared, view.status]);

        // External MIDI stores can commit several note-on snapshots inside one
        // browser task. The layout path above is immediate; this task fallback
        // guarantees the final complete pitch set is also observed after React
        // finishes a concurrent commit. settle() is idempotent.
        useEffect(() => {
          if (view.status !== 'running'
            || view.prepared?.kind !== 'chord'
            || (!view.armed && !chordReleasedSinceStart)
            || liveChordMatch !== 'correct') return undefined;
          const prompt = view.prepared.prompt;
          const heldNotes = new Map(activeNotes);
          const handle = globalThis.setTimeout(() => finishChord(prompt, heldNotes), 0);
          return () => globalThis.clearTimeout(handle);
        }, [activeNotes, liveChordMatch, view.armed, view.prepared, view.status]);

        useEffect(() => {
          historyCursor.current = noteHistory.length;
          // Baseline once per challenge or input-source switch. Depending on
          // noteHistory itself would erase every fresh note before the
          // processing effect below can consume it.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [challengeId, inputSource]);

        useEffect(() => {
          if (view.status !== 'running' || !view.prepared) return;
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
                notes: ignored.map((entry) => entry.note),
                staleInputsIgnored,
              });
            }
            if (freshNotes.length === 0) return;
            let progress = snapshot.progress;
            let hadWrong = snapshot.hadWrong;
            let lastInput = snapshot.lastInput;
            for (const entry of freshNotes) {
              const note = entry.note;
              recordInput();
              const previousProgress = progress;
              const legacyRestart = kind === 'scale' && Boolean(prompt.max_mistakes);
              const advanced = legacyRestart
                ? advanceScaleProgress(prompt.expected_midi, progress, note)
                : note === prompt.expected_midi[progress]
                  ? { progress: progress + 1, wrong: false, complete: progress + 1 === prompt.expected_midi.length }
                  : { progress, wrong: true, complete: false };
              progress = advanced.progress;
              hadWrong ||= advanced.wrong;
              lastInput = {
                note,
                status: advanced.wrong ? 'wrong' : 'correct',
              };
              if (advanced.wrong) {
                wrongNotes += 1;
                if (wrongInputs.length < 3) {
                  wrongInputs.push({
                    played: note,
                    expected: prompt.expected_midi[previousProgress] ?? prompt.expected_midi[0],
                    progress: previousProgress,
                  });
                }
                if (legacyRestart && previousProgress > 0) restarts += 1;
                if (prompt.max_mistakes && wrongNotes >= prompt.max_mistakes) {
                  publish({ progress, hadWrong, lastInput });
                  finish(0, {
                    firstTry: false,
                    failed: true,
                    wrongAttemptSeen: true,
                    notesRequired: prompt.expected_midi.length,
                  });
                  return;
                }
              }
              if (!advanced.wrong && prompt.tempo_bpm) {
                const beatMs = 60_000 / prompt.tempo_bpm;
                const offset = prompt.target_offsets_ms?.[previousProgress] ?? previousProgress * beatMs;
                const targetAt = attemptStartedAt + (prompt.lead_in_ms || 0) + offset;
                const quality = timingQuality(entry.startTime, targetAt, beatMs);
                if (quality !== null) timingQualities.push(quality);
              }
              if (advanced.complete) {
                const firstTry = !hadWrong;
                publish({ progress, hadWrong, lastInput });
                const grading = legacyRestart
                  ? { score: firstTry ? 1 : 0.5, pitchAccuracy: firstTry ? 1 : 0.5, timingAccuracy: null, continuity: firstTry ? 1 : 0.5 }
                  : gradeOrderedPerformance({
                    expectedCount: prompt.expected_midi.length,
                    wrongNotes,
                    timingQualities,
                    paced: Boolean(prompt.tempo_bpm),
                  });
                finish(grading.score, {
                  firstTry,
                  wrongAttemptSeen: !firstTry,
                  notesRequired: prompt.expected_midi.length,
                  pitchAccuracy: grading.pitchAccuracy,
                  timingAccuracy: grading.timingAccuracy,
                  continuity: grading.continuity,
                  tempoBpm: prompt.tempo_bpm || null,
                });
                return;
              }
            }
            publish({ progress, hadWrong, lastInput });
            return;
          }

        }, [activeNotes, noteHistory, view.status, view.prepared, view.armed]);

        const prompt = view.prepared?.prompt;
        const expectedCount = prompt?.expected_midi?.length || 0;
        const expectedMidi = (prompt?.expected_midi || []).filter(Number.isFinite);
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
          const abc = generateScaleAbc(prompt.expected_midi, prompt.key_signature || 'C');
          // The ghost shows only for a wrong note, and only until the next input
          // resolves it. It hangs off the note the player OWED — which after a
          // wrong note is wherever the scale restarted, the same element wearing
          // the red mark — so the two always read as one comparison.
          const wrongMidi = view.lastInput?.status === 'wrong' ? view.lastInput.note : null;
          const anchor = wrongMidi == null
            ? null
            : (staffNotesRef.current?.[0]?.[view.progress]?.els?.[0] ?? null);
          return (
            <section className={`piano-challenge piano-scale-challenge${usingVirtualKeyboard ? ' has-virtual-keyboard' : ''}`}>
              <header className="piano-scale-challenge__heading">
                <span>
                  {headerContext ? `${headerContext}${prompt.tempo_bpm ? ` · ${prompt.tempo_bpm} BPM` : ''}`
                    : prompt.tempo_bpm ? `Play with the pulse · ${prompt.tempo_bpm} BPM` : 'Play from left to right'}
                  {prompt.max_mistakes ? ` · ${prompt.max_mistakes} misses ends this legacy challenge` : ''}
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
                    ? prompt.max_mistakes
                      ? 'Wrong note — start again at the highlighted note'
                      : 'Not that one — correct the highlighted note and keep going'
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
            ref={handleChordCommit}
            data-challenge-status={view.status}
            data-chord-armed={view.armed ? 'true' : 'false'}
            data-active-notes={[...activeNotes.keys()].join(',')}
            data-chord-match={liveChordMatch}
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
            ? { prompt: structuredClone(request.prompt), timeout_ms: request.timeout_ms ?? null }
            : await api.preparePianoChallenge(userId, {
              challenge_id: request.challenge_id,
              kind: request.kind,
              requirements: request.requirements,
              context: request.context,
            });
          const prepared = {
            challenge_id: request.challenge_id,
            kind: request.kind,
            prompt: structuredClone(selected.prompt),
            timeout_ms: selected.timeout_ms ?? request.timeout_ms ?? null,
            pedagogy_policy_version: selected.pedagogy_policy_version || null,
            selection: selected.selection ? structuredClone(selected.selection) : null,
            grading_policy_version: request.kind === 'chord'
              ? 'pitch-set-simultaneity-v1'
              : selected.prompt?.tempo_bpm
                ? 'paced-pitch-timing-continuity-v1'
                : 'untimed-pitch-continuity-v1',
            provider_version: PROVIDER_VERSION,
            requirement: selected.requirement ? structuredClone(selected.requirement) : null,
            context: request.context ? structuredClone(request.context) : null,
          };
          publish({ status: 'prepared', prepared, armed: false, hadWrong: false, progress: 0, lastInput: null });
          return prepared;
        },
        async restore(prepared) {
          publish({ status: 'prepared', prepared: structuredClone(prepared), armed: false, hadWrong: false, progress: 0, lastInput: null });
          return prepared;
        },
        async start(prepared) {
          clearDeadline();
          settled = false;
          attemptStartedAt = clock();
          firstInputAt = null;
          notesPlayed = 0;
          wrongNotes = 0;
          wrongInputs = [];
          restarts = 0;
          timingQualities = [];
          chordReleasedSinceStart = false;
          staleInputsIgnored = 0;
          publish({ status: 'running', prepared, armed: false, hadWrong: false, progress: 0, lastInput: null });
          const promise = new Promise((resolve) => { resolveAttempt = resolve; });
          const timeoutMs = Number(prepared.timeout_ms);
          if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeoutHandle = globalThis.setTimeout(() => {
              settle('timeout', null, { reason: 'challenge_timeout', timeoutMs });
            }, timeoutMs);
          }
          return promise;
        },
        cancel(reason = 'aborted') {
          settle('aborted', null, { reason });
        },
        dispose() {
          clearDeadline();
          if (!settled && resolveAttempt) {
            const prepared = snapshot.prepared;
            const started = attemptStartedAt != null;
            const result = {
              status: 'aborted',
              score: null,
              metrics: timedMetrics({ reason: 'disposed' }),
              provider_version: PROVIDER_VERSION,
              attempt_id: started && prepared ? makeAttemptId() : null,
            };
            // The runtime is being torn down, so resolve the caller immediately
            // and let the ledger write finish on its own. `keepalive` keeps the
            // request alive if the surface is going away with the page — an
            // abandoned attempt is the evidence that a player walked away
            // mid-exercise, which is exactly what the practice record loses today.
            if (started && prepared) {
              persistAttempt({ ...result }, prepared, { keepalive: true }).then((saved) => {
                logger?.info?.('piano.challenge.abandoned', {
                  challengeId: prepared.challenge_id,
                  kind: prepared.kind,
                  exerciseId: prepared.prompt?.exercise_id || null,
                  label: prepared.prompt?.label || null,
                  progress: snapshot.progress,
                  notesRequired: prepared.prompt?.expected_midi?.length ?? null,
                  notesPlayed: saved.metrics.notesPlayed,
                  wrongNotes: saved.metrics.wrongNotes,
                  staleInputsIgnored: saved.metrics.staleInputsIgnored,
                  durationMs: saved.metrics.durationMs,
                  attemptId: saved.attempt_id,
                  persisted: Boolean(saved.attempt_id),
                });
              });
            }
            resolveAttempt(result);
          }
          settled = true;
          resolveAttempt = null;
          listeners.clear();
        },
      };
    },
  };
}

export default createPianoChordProvider;
