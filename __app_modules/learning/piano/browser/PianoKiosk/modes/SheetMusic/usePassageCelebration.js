import { useCallback, useEffect, useRef, useState } from 'react';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { celebrationBetween, certificationSnapshot } from './passageRail.js';
import { playPassageChime } from './passageChime.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'piano-passage-celebration' }));

const FLIP_MS = 1600;
const PIECE_MS = 7000;

/**
 * Celebrates a passage, or the whole piece, turning Silver or Gold.
 *
 * It celebrates a CHANGE seen while the player is open, never a state: the
 * first snapshot after everything has loaded is the baseline, and a later one
 * counts only when a new take was recorded since. So opening a piece that is
 * already Silver, or legacy credit arriving late, celebrates nothing, and a
 * whole piece is celebrated once. A change earned inside Learn waits here until
 * the rail is back on screen (`visible`).
 */
export default function usePassageCelebration({ scopeKey, ready, projection, evidenceId = null, visible, scoreId = null }) {
  const baseline = useRef(null);
  const [flips, setFlips] = useState({});
  const [piece, setPiece] = useState(null);

  useEffect(() => {
    if (!ready) { baseline.current = null; return; }
    const snapshot = certificationSnapshot(projection);
    const held = baseline.current;
    if (!held || held.scopeKey !== scopeKey) { baseline.current = { scopeKey, snapshot, evidenceId }; return; }
    // No new take: whatever changed was re-derived (a late legacy merge, a policy edit).
    if (evidenceId === held.evidenceId) { baseline.current = { scopeKey, snapshot, evidenceId }; return; }
    if (!visible) return;
    const change = celebrationBetween(held.snapshot, snapshot);
    baseline.current = { scopeKey, snapshot, evidenceId };
    const ids = Object.keys(change.flips);
    if (!ids.length && !change.piece) return;
    const top = change.piece ?? (Object.values(change.flips).includes('gold') ? 'gold' : 'silver');
    const sounded = playPassageChime({ level: top, piece: Boolean(change.piece) });
    logger().info('piano.learn.celebrate', { scoreId, scope: change.piece ? 'piece' : 'passage', level: top, passages: ids, sounded });
    setFlips(change.piece ? Object.fromEntries(Object.keys(snapshot.levels).map((id) => [id, change.piece])) : change.flips);
    setPiece(change.piece);
  }, [scopeKey, ready, projection, evidenceId, visible, scoreId]);

  useEffect(() => {
    if (!Object.keys(flips).length) return undefined;
    const timer = setTimeout(() => setFlips({}), FLIP_MS);
    return () => clearTimeout(timer);
  }, [flips]);
  useEffect(() => {
    if (!piece) return undefined;
    const timer = setTimeout(() => setPiece(null), PIECE_MS);
    return () => clearTimeout(timer);
  }, [piece]);

  const dismissPiece = useCallback(() => setPiece(null), []);
  return { flips, piece, dismissPiece };
}
