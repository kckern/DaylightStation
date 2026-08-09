import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AbcRenderer } from '../../../MusicNotation/renderers/AbcRenderer.jsx';
import { evaluateChordMatch } from '../../PianoFlashcards/flashcardEngine.js';
import { advanceScaleProgress } from './scaleProgress.js';

const EMPTY_NOTES = new Map();
const EMPTY_HISTORY = [];
const PROVIDER_VERSION = '2-untimed-piano';

function makeAttemptId() {
  return `attempt-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/**
 * Piano challenge adapter for the generic gaming runtime. Challenge content is
 * definition-owned; this adapter only translates live MIDI into a scored result.
 * The legacy export name remains stable for the existing standalone route.
 */
export function createPianoChordProvider({ useNotes }) {
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
        status: 'idle', prepared: null, armed: false, hadWrong: false, progress: 0,
      };
      let resolveAttempt = null;
      let settled = false;

      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) listener();
      };
      const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

      const finish = async (score, metrics) => {
        if (settled || !resolveAttempt) return;
        settled = true;
        publish({ status: 'complete' });
        const result = {
          status: 'completed', score, metrics,
          provider_version: PROVIDER_VERSION,
          attempt_id: makeAttemptId(),
        };
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
          result.metrics = { ...metrics, persistence_error: true };
        }
        resolveAttempt(result);
        resolveAttempt = null;
      };

      function Surface() {
        const view = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
        const notes = useNotes();
        const activeNotes = notes?.activeNotes || EMPTY_NOTES;
        const noteHistory = notes?.noteHistory || EMPTY_HISTORY;
        const historyCursor = useRef(null);
        const challengeId = view.prepared?.challenge_id;

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
            for (const note of freshNotes) {
              const advanced = advanceScaleProgress(prompt.expected_midi, progress, note);
              progress = advanced.progress;
              hadWrong ||= advanced.wrong;
              if (advanced.complete) {
                const firstTry = !hadWrong;
                publish({ progress, hadWrong });
                finish(firstTry ? 1 : 0.5, {
                  first_try: firstTry,
                  wrong_attempt_seen: !firstTry,
                  notes_required: prompt.expected_midi.length,
                });
                return;
              }
            }
            publish({ progress, hadWrong });
            return;
          }

          if (!view.armed) {
            if (activeNotes.size === 0) publish({ armed: true });
            return;
          }
          const card = { root: prompt.root, pitchClasses: new Set(prompt.pitch_classes) };
          const match = evaluateChordMatch(activeNotes, card);
          if (match === 'wrong') publish({ hadWrong: true });
          if (match === 'correct') {
            const firstTry = !snapshot.hadWrong;
            finish(firstTry ? 1 : 0.5, { first_try: firstTry, wrong_attempt_seen: !firstTry });
          }
        }, [activeNotes, noteHistory, view.status, view.prepared, view.armed]);

        const prompt = view.prepared?.prompt;
        const expectedCount = prompt?.expected_midi?.length || 0;
        if (view.prepared?.kind === 'scale') {
          const abc = `X:1\nL:1/4\nK:${prompt.key_signature || 'C'}\n${prompt.abc} |]`;
          return (
            <section className="piano-challenge piano-scale-challenge">
              <div>Play the scale from left to right</div>
              <strong>{prompt.label}</strong>
              <div className="piano-scale-challenge__staff">
                <AbcRenderer abc={abc} scale={1.35} singleLine />
              </div>
              <div>{view.progress} / {expectedCount} notes</div>
              {view.hadWrong && <div>Start again from the first note</div>}
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
          publish({ status: 'prepared', prepared, armed: false, hadWrong: false, progress: 0 });
          return prepared;
        },
        async restore(prepared) {
          publish({ status: 'prepared', prepared: structuredClone(prepared), armed: false, hadWrong: false, progress: 0 });
          return prepared;
        },
        async start(prepared) {
          settled = false;
          publish({ status: 'running', prepared, armed: false, hadWrong: false, progress: 0 });
          return new Promise((resolve) => { resolveAttempt = resolve; });
        },
        cancel(reason = 'aborted') {
          if (!settled && resolveAttempt) {
            settled = true;
            resolveAttempt({ status: 'aborted', score: null, metrics: { reason }, provider_version: PROVIDER_VERSION, attempt_id: null });
            resolveAttempt = null;
          }
          publish({ status: 'cancelled' });
        },
        dispose() {
          if (!settled && resolveAttempt) {
            resolveAttempt({ status: 'aborted', score: null, metrics: { reason: 'disposed' }, provider_version: PROVIDER_VERSION, attempt_id: null });
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
