import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AbcRenderer } from '../../../MusicNotation/renderers/AbcRenderer.jsx';
import { generateScaleAbc } from '../../../MusicNotation/renderers/abc.js';
import { evaluateChordMatch } from '../../PianoFlashcards/flashcardEngine.js';
import { advanceScaleProgress } from './scaleProgress.js';
import { WrongNoteGhost } from './WrongNoteGhost.jsx';
import { scaleClefType } from './wrongNoteGhost.js';

const EMPTY_NOTES = new Map();
const EMPTY_HISTORY = [];
const useAlwaysConnected = () => ({ connected: true, status: 'connected' });
const PROVIDER_VERSION = '3-midi-canonical-piano';
const SCALE_NOTE_CLASSES = [
  'piano-scale-note--complete',
  'piano-scale-note--next',
  'piano-scale-note--wrong',
];

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
      { kind: 'scale', modes: ['untimed', 'ordered'] },
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
      let timeoutHandle = null;

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
      });

      const recordInput = () => {
        if (firstInputAt == null) firstInputAt = clock();
        notesPlayed += 1;
      };

      const settle = async (status, score, metrics) => {
        if (settled || !resolveAttempt) return;
        settled = true;
        clearDeadline();
        publish({ status: status === 'completed' ? 'complete' : status });
        const result = {
          status, score, metrics: timedMetrics(metrics),
          provider_version: PROVIDER_VERSION,
          attempt_id: makeAttemptId(),
        };
        const persistenceStartedAt = clock();
        try {
          const saved = await api.recordPianoAttempt(userId, {
            ...result,
            challenge_id: snapshot.prepared.challenge_id,
            grading_policy_version: snapshot.prepared.grading_policy_version,
            prompt: snapshot.prepared.prompt,
          });
          result.attempt_id = saved.attempt_id;
        } catch (error) {
          logger.warn('piano-challenge-attempt-save-failed', { error: error.message });
          result.attempt_id = null;
          result.metrics = { ...result.metrics, persistenceError: true };
        }
        result.metrics.persistenceDurationMs = Math.max(0, clock() - persistenceStartedAt);
        resolveAttempt(result);
        resolveAttempt = null;
      };

      const finish = (score, metrics) => settle('completed', score, metrics);

      function Surface() {
        const view = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
        const notes = useNotes();
        const connection = useConnection();
        const activeNotes = notes?.activeNotes || EMPTY_NOTES;
        const noteHistory = notes?.noteHistory || EMPTY_HISTORY;
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

        useEffect(() => {
          historyCursor.current = noteHistory.length;
          // Baseline once per challenge; adding noteHistory would erase every
          // fresh note before the processing effect below can consume it.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [challengeId]);

        useEffect(() => {
          if (view.status === 'running' && connection?.connected === false) {
            settle('error', null, {
              reason: 'midi_disconnected',
              connectionStatus: connection.status || 'disconnected',
            });
          }
        }, [connection?.connected, connection?.status, view.status]);

        useEffect(() => {
          if (view.status !== 'running' || !view.prepared) return;
          const { kind, prompt } = view.prepared;
          if (kind === 'scale') {
            if (historyCursor.current === null) historyCursor.current = noteHistory.length;
            const freshNotes = noteHistory.slice(historyCursor.current).map((entry) => entry.note);
            historyCursor.current = noteHistory.length;
            if (freshNotes.length === 0) return;
            let progress = snapshot.progress;
            let hadWrong = snapshot.hadWrong;
            let lastInput = snapshot.lastInput;
            for (const note of freshNotes) {
              recordInput();
              const previousProgress = progress;
              const advanced = advanceScaleProgress(prompt.expected_midi, progress, note);
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
                if (previousProgress > 0) restarts += 1;
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
              if (advanced.complete) {
                const firstTry = !hadWrong;
                publish({ progress, hadWrong, lastInput });
                finish(firstTry ? 1 : 0.5, {
                  firstTry,
                  wrongAttemptSeen: !firstTry,
                  notesRequired: prompt.expected_midi.length,
                });
                return;
              }
            }
            publish({ progress, hadWrong, lastInput });
            return;
          }

          if (!view.armed) {
            if (activeNotes.size === 0) publish({ armed: true });
            return;
          }
          const card = { root: prompt.root, pitchClasses: new Set(prompt.pitch_classes) };
          const match = evaluateChordMatch(activeNotes, card);
          if (activeNotes.size > 0 && firstInputAt == null) {
            firstInputAt = clock();
            notesPlayed = activeNotes.size;
          }
          if (match === 'wrong') {
            if (!snapshot.hadWrong) wrongNotes += 1;
            publish({ hadWrong: true });
          }
          if (match === 'correct') {
            const firstTry = !snapshot.hadWrong;
            finish(firstTry ? 1 : 0.5, { firstTry, wrongAttemptSeen: !firstTry });
          }
        }, [activeNotes, noteHistory, view.status, view.prepared, view.armed]);

        const prompt = view.prepared?.prompt;
        const expectedCount = prompt?.expected_midi?.length || 0;
        if (view.prepared?.kind === 'scale') {
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
            <section className="piano-challenge piano-scale-challenge">
              <header className="piano-scale-challenge__heading">
                <span>
                  Play from left to right
                  {prompt.max_mistakes ? ` · ${prompt.max_mistakes} misses fizzles the card` : ''}
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
                    ? 'Wrong note — start again at the highlighted note'
                    : view.progress > 0
                      ? 'Correct — keep going'
                      : 'Play the highlighted first note'}
                </span>
              </div>
            </section>
          );
        }
        return (
          <section className="piano-challenge">
            <div>Play this chord</div>
            <div className="piano-challenge__chord">{prompt?.label || '…'}</div>
            <div>{view.status === 'running' ? 'Listening to the piano' : 'Getting ready'}</div>
            {view.hadWrong && <div>Release and try again</div>}
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
            grading_policy_version: request.kind === 'scale' ? 'untimed-ordered-scale-v1' : 'untimed-chord-first-try-v1',
            provider_version: PROVIDER_VERSION,
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
            resolveAttempt({ status: 'aborted', score: null, metrics: timedMetrics({ reason: 'disposed' }), provider_version: PROVIDER_VERSION, attempt_id: null });
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
