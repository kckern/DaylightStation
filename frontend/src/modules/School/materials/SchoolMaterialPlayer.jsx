/**
 * Real material player (Task 7). Wraps the shared Player the same way
 * PianoVideoPlayer does (lazy import, error boundary, a single `clear`
 * signal as "the Player wants out" — see
 * frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx).
 * Deliberately imports NOTHING from modules/Piano — School wraps the shared
 * Player directly (project rule: fix in consumer, a module is not an export
 * surface).
 *
 * Unlike the piano exemplar, we don't suppress the Player's own overlay
 * (`focused` shader) — School has no custom transport chrome of its own, so
 * the default shader is what leaves the native progress bar/title visible
 * for the student. `play={{contentId}}` alone is medium-agnostic: the
 * shared Player's own renderer decides audio vs video from the resolved
 * Plex metadata, so one code path here plays both.
 *
 * Progress: the Player's `onProgress` prop (fired every timeupdate tick —
 * see hooks/useCommonMediaController.js) throttled to <=1 write per 10s via
 * a ref (no interval polling), gated on a real userId (guests never write).
 * A final write flushes on unmount — which covers both the visible exit row
 * (tapping it calls onExit, which unmounts this component) and any
 * unmount that happens some other way (e.g. the header's own Back).
 *
 * On natural end (Player's `clear` — for a single, non-queue `play`,
 * useQueueController's advance() calls `clear()` once the one-item queue is
 * exhausted, exactly the signal PianoVideoPlayer treats as "done"): flush
 * progress, then either hand off to QuizRunner (unit.quiz.bankId) or return
 * to the detail view with {refetch: true} so lock state re-evaluates. A
 * bank-fetch failure never stands the child up on a dead screen — it falls
 * back to the same return-to-detail exit.
 */
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import QuizRunner from '../quiz/QuizRunner.jsx';

// Player is heavy — code-split it so the grid/detail views don't pay for it.
const Player = lazy(() => import('../../Player/Player.jsx'));

const PROGRESS_THROTTLE_MS = 10000;

/** Error boundary so a Player crash drops back to the detail view, not a blank panel. */
class SchoolPlayerBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    schoolLog.materialsError('player-crash', { error: error?.message });
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="school-material-player__placeholder">
          Playback failed.
          <button type="button" onClick={this.props.onBack}>Back</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SchoolMaterialPlayer({ material, unit, userId, onExit }) {
  const materialId = material?.id;
  const unitId = unit?.id;
  const contentId = unitId || null; // unit.id IS the plex:<key> content id (spec §2b)

  const [quizBank, setQuizBank] = useState(null); // fetched bank once end-with-quiz resolves

  const lastWriteAtRef = useRef(0);
  const latestProgressRef = useRef(null); // {percent, playhead, durationMs}
  const endedRef = useRef(false); // guards against clear() firing more than once

  useEffect(() => {
    schoolLog.materials('player-start', { materialId, unitId, medium: material?.medium });
  }, [materialId, unitId, material?.medium]);

  // The one write path both the throttled progress tick and the final
  // unmount/exit flush share — "same guard" (userId truthy, something to send).
  const commitProgress = useCallback(() => {
    if (!userId) return;
    const p = latestProgressRef.current;
    if (!p) return;
    schoolApi.unitProgress(materialId, unitId, {
      userId, percent: p.percent, playhead: p.playhead, durationMs: p.durationMs,
    });
  }, [userId, materialId, unitId]);

  // Final write on unmount. Exiting (manual back row, or the header's own
  // Back navigating away) always unmounts this component, so this single
  // effect covers every exit path except the quiz handoff, which stays
  // mounted (see handleEnded's own explicit commitProgress() below).
  useEffect(() => () => commitProgress(), [commitProgress]);

  const handleProgress = useCallback((payload) => {
    latestProgressRef.current = {
      percent: Number(payload?.percent) || 0,
      playhead: payload?.currentTime || 0,
      durationMs: payload?.duration ? Math.round(payload.duration * 1000) : null,
    };
    if (!userId) return;
    const now = Date.now();
    if (now - lastWriteAtRef.current < PROGRESS_THROTTLE_MS) return;
    lastWriteAtRef.current = now;
    commitProgress();
  }, [userId, commitProgress]);

  // Shared by the manual exit row, the no-quiz end path, and the post-quiz
  // exit — every road back to the detail view logs the same event and asks
  // for a refetch (lock state may have changed).
  const exitToDetail = useCallback(() => {
    schoolLog.materials('player-end', { materialId, unitId });
    onExit({ refetch: true });
  }, [materialId, unitId, onExit]);

  const handleEnded = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Explicit here (not just the unmount effect): the quiz branch below
    // keeps this component mounted, so unmount-triggered flush never fires.
    commitProgress();
    const bankId = unit?.quiz?.bankId;
    if (!bankId) { exitToDetail(); return; }
    schoolLog.materials('quiz-handoff', { bankId });
    const { ok, data } = await schoolApi.bank(bankId);
    if (!ok || !data) {
      schoolLog.materialsError('quiz-bank-load-failed', { bankId });
      exitToDetail();
      return;
    }
    setQuizBank(data);
  }, [commitProgress, unit, exitToDetail]);

  if (quizBank) {
    return <QuizRunner bank={quizBank} onExit={exitToDetail} />;
  }

  if (!contentId) {
    return (
      <div className="school-material-player">
        {/* Navigation is the header breadcrumb (…› material › unit). */}
        <p className="school-material-player__placeholder">This item can&apos;t be played.</p>
      </div>
    );
  }

  return (
    <div className="school-material-player">
      <div className="school-material-player__stage">
        <SchoolPlayerBoundary onBack={exitToDetail}>
          <Suspense fallback={<p className="school-material-player__loading">Loading player…</p>}>
            <Player play={{ contentId }} clear={handleEnded} onProgress={handleProgress} />
          </Suspense>
        </SchoolPlayerBoundary>
      </div>
    </div>
  );
}
