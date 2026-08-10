import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { AbcRenderer } from '../../../MusicNotation/renderers/AbcRenderer.jsx';
import { evaluateChordMatch } from '../../PianoFlashcards/flashcardEngine.js';
import { advanceScaleProgress } from './scaleProgress.js';

const EMPTY_NOTES = new Map();
const EMPTY_HISTORY = [];
const PROVIDER_VERSION = '2-untimed-piano';
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
 * Piano challenge adapter for the generic gaming runtime. Challenge content is
 * definition-owned; this adapter only translates live MIDI into a scored result.
 * The legacy export name remains stable for the existing standalone route.
 */
export function createPianoChordProvider({ useNotes, clock = () => Date.now() }) {
  if (typeof useNotes !== 'function') throw new Error('createPianoChordProvider requires a useNotes hook');
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
      let restarts = 0;

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
        restarts,
      });

      const recordInput = () => {
        if (firstInputAt == null) firstInputAt = clock();
        notesPlayed += 1;
      };

      const finish = async (score, metrics) => {
        if (settled || !resolveAttempt) return;
        settled = true;
        publish({ status: 'complete' });
        const result = {
          status: 'completed', score, metrics: timedMetrics(metrics),
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

      function Surface() {
        const view = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
        const notes = useNotes();
        const activeNotes = notes?.activeNotes || EMPTY_NOTES;
        const noteHistory = notes?.noteHistory || EMPTY_HISTORY;
        const historyCursor = useRef(null);
        const staffNotesRef = useRef([]);
        const challengeId = view.prepared?.challenge_id;

        const handleScaleRender = useCallback((_tune, staffNotes) => {
          clearScaleNoteFeedback(staffNotesRef.current);
          staffNotesRef.current = staffNotes;
          applyScaleNoteFeedback(staffNotes, snapshot.progress, snapshot.lastInput);
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
          const abc = `X:1\nL:1/4\nK:${prompt.key_signature || 'C'}\n${prompt.abc} |]`;
          return (
            <section className="piano-challenge piano-scale-challenge">
              <header className="piano-scale-challenge__heading">
                <span>
                  Play from left to right
                  {prompt.max_mistakes ? ` · ${prompt.max_mistakes} misses fizzles the card` : ''}
                </span>
                <strong>{prompt.label}</strong>
              </header>
              <div className="piano-scale-challenge__staff">
                <AbcRenderer abc={abc} scale={1} singleLine fitContent onRender={handleScaleRender} />
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
          const prepared = {
            challenge_id: request.challenge_id,
            kind: request.kind,
            prompt: structuredClone(request.prompt),
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
          settled = false;
          attemptStartedAt = clock();
          firstInputAt = null;
          notesPlayed = 0;
          wrongNotes = 0;
          restarts = 0;
          publish({ status: 'running', prepared, armed: false, hadWrong: false, progress: 0, lastInput: null });
          return new Promise((resolve) => { resolveAttempt = resolve; });
        },
        cancel(reason = 'aborted') {
          if (!settled && resolveAttempt) {
            settled = true;
            resolveAttempt({ status: 'aborted', score: null, metrics: timedMetrics({ reason }), provider_version: PROVIDER_VERSION, attempt_id: null });
            resolveAttempt = null;
          }
          publish({ status: 'cancelled' });
        },
        dispose() {
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
