import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { clientStudyDate } from '../../clientStudyDate.js';

const initial = () => ({ studyDate: clientStudyDate(), completedGames: 0, loading: true });

export default function useBoardGameDay(learnerId, logger = null) {
  const [day, setDay] = useState(initial);
  const pendingRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!learnerId) { setDay({ ...initial(), loading: false }); return () => {}; }
    setDay((value) => ({ ...value, loading: true }));
    Promise.resolve(DaylightAPI(`api/v1/piano/users/${encodeURIComponent(learnerId)}/board-game-day`))
      .then((value) => {
        if (cancelled) return;
        if (value && Number.isInteger(value.completedGames)) setDay({ ...value, loading: false });
        else setDay((current) => ({ ...current, loading: false }));
      })
      .catch((error) => {
        logger?.warn?.('piano.board-game-day.read-failed', { learnerId, error: error?.message });
        if (!cancelled) setDay((value) => ({ ...value, loading: false }));
      });
    return () => { cancelled = true; };
  }, [learnerId, logger]);

  const registerCompletion = useCallback((request) => {
    setDay((value) => ({ ...value, completedGames: value.completedGames + 1 }));
    const settled = Promise.resolve(request).then((response) => {
      const receipt = response?.boardGameDay;
      if (receipt && Number.isInteger(receipt.completedGames)) {
        setDay({ ...receipt, loading: false });
      } else {
        setDay((value) => ({ ...value, completedGames: Math.max(0, value.completedGames - 1) }));
      }
      return response;
    }).catch((error) => {
      logger?.warn?.('piano.board-game-day.write-failed', { learnerId, error: error?.message });
      setDay((value) => ({ ...value, completedGames: Math.max(0, value.completedGames - 1) }));
      throw error;
    });
    pendingRef.current = settled.catch(() => null);
    return settled;
  }, [learnerId, logger]);

  const waitForCompletion = useCallback(() => pendingRef.current, []);
  return { ...day, registerCompletion, waitForCompletion };
}
