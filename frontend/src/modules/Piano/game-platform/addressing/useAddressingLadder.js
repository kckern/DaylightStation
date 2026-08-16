import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAddressingProgress, evaluateAddressing, recordAddress,
} from './addressingProgress.js';
import { activeRung } from './resolveAddressing.js';

/**
 * The addressing ladder, live: it watches how the player addresses, and moves.
 *
 * This is the half that was missing. The signal and its thresholds existed and
 * were tested, but nothing called them, so the rung only ever changed if
 * somebody edited YAML — which is a ladder in name only.
 *
 * What it does NOT watch is whether the player won. A child can lose every game
 * while addressing every square first time, and that child should climb this
 * ladder while staying on a gentle opponent; the opponent ladder is a separate
 * thing and stays that way.
 *
 * `pinned` short-circuits everything: a player being held at a rung is held,
 * attempts are still recorded (so the operator can see how they are doing) but
 * the verdict is never applied.
 */
export function useAddressingLadder({
  client = null,
  gameId,
  userId = null,
  config = null,
  promotion: promotionProp = undefined,
  logger = null,
} = {}) {
  // The thresholds are first guesses and want weeks of real play before anyone
  // trusts them — so they are CONFIG, not constants. Tuning is a YAML edit at
  // `addressing.promotion` in the household or the player's own layer, not a
  // release.
  const promotion = promotionProp ?? ((config?.addressing && typeof config.addressing === 'object')
    ? config.addressing.promotion : undefined);
  const ladderConfig = (config?.addressing && typeof config.addressing === 'object')
    ? config.addressing.ladder ?? null : null;
  const pinned = Number.isFinite(ladderConfig?.pinned);
  const configuredRung = activeRung(ladderConfig);

  const [progress, setProgress] = useState(() => createAddressingProgress(configuredRung ?? 1));
  // The turn's clock. Time-to-first-correct-address is measured from when it
  // became the player's turn, so a player who reads the rim, thinks, then plays
  // correctly is recorded as slow AND correct rather than as two separate events.
  const turnStarted = useRef(null);
  // The ref is AUTHORITATIVE, not a mirror. Two addresses inside one React batch
  // both read `progressRef.current` before either re-render lands, so a mirror
  // assigned during render makes the second attempt overwrite the first instead
  // of accumulating — the window never fills and the ladder never moves.
  const progressRef = useRef(progress);

  // Adopt the configured rung when it resolves, but never walk backwards over
  // what this session has already earned.
  useEffect(() => {
    if (configuredRung === null) return;
    setProgress((current) => {
      if (current.rung === configuredRung) return current;
      const adopted = { ...current, rung: configuredRung };
      progressRef.current = adopted;
      return adopted;
    });
  }, [configuredRung]);

  const startTurn = useCallback(() => { turnStarted.current = Date.now(); }, []);

  const record = useCallback(({ ok, railRead = false }) => {
    const started = turnStarted.current;
    const ms = ok && Number.isFinite(started) ? Date.now() - started : null;
    if (ok) turnStarted.current = null;

    const next = recordAddress(progressRef.current, { ok, ms, railRead }, promotion);
    const verdict = evaluateAddressing(next, promotion);

    if (pinned || verdict.verdict === 'hold') {
      progressRef.current = next;
      setProgress(next);
      return verdict;
    }

    // A verdict resets the window: the next judgement should be about how the
    // player copes with the rung they are on NOW, not half-full of evidence
    // gathered on a different one.
    const moved = { rung: verdict.rung, samples: [] };
    progressRef.current = moved;
    setProgress(moved);
    logger?.info?.('addressing.rung-changed', {
      gameId, from: next.rung, to: verdict.rung, verdict: verdict.verdict, reason: verdict.reason,
    });
    // Persisted beside the opponent ladder, through the same deep-merged config
    // write every other setting uses — so a rung earned on Tuesday is still
    // there on Wednesday.
    if (userId && client?.writeConfig) {
      client.writeConfig(userId, { addressing: { ladder: { unlocked_through: verdict.rung } } });
    }
    return verdict;
  }, [client, gameId, logger, pinned, promotion, userId]);

  return {
    rung: progress.rung,
    pinned,
    samples: progress.samples.length,
    startTurn,
    record,
  };
}

export default useAddressingLadder;
