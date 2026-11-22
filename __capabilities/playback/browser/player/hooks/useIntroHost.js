/**
 * useIntroHost — SinglePlayer's side of an installed intro (the Media app's
 * provenance scene): it starts the scene from the play request, so the scene,
 * not a spinner, covers the play-info fetch that comes before VideoPlayer.
 *
 * SinglePlayer owns the intro and draws the scene layer, so the scene is not
 * remounted when VideoPlayer appears. VideoPlayer keeps the gate (useIntroGate:
 * hold the first frame, step aside) and reports its stage back through
 * `onStage`. Until it reports a decision, the host covers early when it can
 * already tell the title starts from the top:
 *
 *   - the intro is ready (a confirmed service, logo loaded),
 *   - the start is known ahead (`knownStartSec`: an explicit start on the
 *     request, or the intro's own read of where a play would start), and is
 *     inside INTRO_START_WINDOW_SEC,
 *   - this is not a recovery remount.
 *
 * Without a known start it never covers early (a resume would flash a logo).
 * The first final stage the gate reports (`off` or `playing`) is kept for the
 * title, so a later remount of VideoPlayer cannot bring the scene back. A
 * restart the gate replays (`onReplay`) clears it.
 *
 * While the intro is still deciding, the spinner is held back for
 * INTRO_WAIT_COVER_MS from the request, as the gate does after mount.
 *
 * Returns the stage to draw and the `introHost` prop for VideoPlayer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLogger } from '../../../../../frontend/src/lib/logging/Logger.js';
import { setIntroCovering } from '../../player-support/introCover.js';
import { INTRO_START_WINDOW_SEC, INTRO_WAIT_COVER_MS } from './useIntroGate.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'intro-host' }));

const FINAL = new Set(['off', 'playing']);
const COVERING = new Set(['covering', 'holding']);
const COVER_OWNER = 'host';

export function useIntroHost({ intro, knownStartSec = null, recovery = false, resetKey }) {
  const [reported, setReported] = useState({ key: resetKey, stage: null, final: null });
  const coverStartedAtRef = useRef({ key: resetKey, at: null });

  const onStage = useCallback((stage) => {
    setReported((prev) => {
      const base = prev.key === resetKey ? prev : { key: resetKey, stage: null, final: null };
      const final = base.final || (FINAL.has(stage) ? stage : null);
      if (base.stage === stage && base.final === final && base === prev) return prev;
      return { key: resetKey, stage, final };
    });
  }, [resetKey]);

  // A restart replays the intro: forget the decision kept for the title.
  const onReplay = useCallback(() => {
    coverStartedAtRef.current = { key: resetKey, at: null };
    setReported({ key: resetKey, stage: null, final: null });
  }, [resetKey]);

  const current = reported.key === resetKey ? reported : { stage: null, final: null };
  const status = intro ? intro.status : null;
  const start = Number(knownStartSec);
  // A long absence (intro.resumeOk) lets a resume open with the scene too.
  const early = !recovery && status === 'ready'
    && knownStartSec != null && Number.isFinite(start) && (start <= INTRO_START_WINDOW_SEC || intro?.resumeOk === true);

  let stage;
  if (current.final) stage = current.final;
  else if (current.stage && current.stage !== 'waiting') stage = current.stage;
  else if (early) stage = 'covering';
  else stage = current.stage;

  if (coverStartedAtRef.current.key !== resetKey) coverStartedAtRef.current = { key: resetKey, at: null };
  if (COVERING.has(stage) && coverStartedAtRef.current.at == null) coverStartedAtRef.current.at = Date.now();
  const coverStartedAt = coverStartedAtRef.current.at;

  const earlyCover = early && !current.stage;
  useEffect(() => {
    if (earlyCover) logger().info('intro.early-cover', { knownStartSec: start });
  }, [earlyCover, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The spinner: hidden while the scene covers; held back briefly while the
  // intro is still deciding, before VideoPlayer's gate has a say.
  const pending = !current.stage && !current.final && status === 'pending' && !recovery;
  useEffect(() => {
    if (COVERING.has(stage)) { setIntroCovering(true, COVER_OWNER); return undefined; }
    if (!pending) { setIntroCovering(false, COVER_OWNER); return undefined; }
    setIntroCovering(true, COVER_OWNER);
    const t = setTimeout(() => setIntroCovering(false, COVER_OWNER), INTRO_WAIT_COVER_MS);
    return () => clearTimeout(t);
  }, [stage, pending, resetKey]);
  useEffect(() => () => setIntroCovering(false, COVER_OWNER), []);

  const introHost = useMemo(
    () => (intro ? { intro, coverStartedAt, onStage, onReplay } : null),
    [intro, coverStartedAt, onStage, onReplay],
  );
  return { stage, introHost };
}
