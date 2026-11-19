import { useEffect, useState } from 'react';
import { DaylightAPI } from '../../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { pieceGemOffered } from './passageRail.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'piano-passage-board' }));

/**
 * Whether finishing a piece really earns this player a gem, asked of the Gem
 * Board the first time the passage board opens. Until it answers, and whenever
 * it cannot, the answer is no: the board never promises a gem it cannot see.
 */
export default function usePieceGemOffer({ userId, enabled }) {
  const [offer, setOffer] = useState({ userId: null, offered: false });
  useEffect(() => {
    if (!enabled || !userId || userId === 'guest' || offer.userId === userId) return undefined;
    let live = true;
    DaylightAPI('api/v1/earnings/gems').then((board) => {
      if (!live) return;
      const offered = pieceGemOffered(board, userId);
      logger().info('piano.learn.gem-offer', { userId, offered, mode: board?.mode ?? null });
      setOffer({ userId, offered });
    }).catch((error) => {
      if (!live) return;
      logger().warn('piano.learn.gem-offer', { userId, offered: false, error: error?.message ?? String(error) });
      setOffer({ userId, offered: false });
    });
    return () => { live = false; };
  }, [enabled, userId, offer.userId]);
  return offer.userId === userId && offer.offered;
}
