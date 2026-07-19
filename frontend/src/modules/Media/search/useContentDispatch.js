// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface. Precedence:
//   1. `peek` (remote-control) view → cast to the peeked device, mode:'fork'
//      (a remote control must never stop the device it is driving),
//   2. a cast target configured in the dock's chip → cast there in the chip's
//      mode — the chip is a promise about where content goes, and the search
//      bar sits beside it,
//   3. otherwise → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
import { useCallback } from 'react';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/DispatchProvider.jsx';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';

export function useContentDispatch() {
  const { view, params } = useNav();
  const { dispatchToTarget } = useDispatch();
  const { targetIds, mode } = useCastTarget();
  const { queue } = useSessionController('local');

  return useCallback((id, item) => {
    const title = item?.title ?? null;
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({
        targetIds: [params.deviceId],
        play: id,
        mode: 'fork',
        title,
      });
      return 'peek';
    }
    if (targetIds.length > 0) {
      dispatchToTarget({ targetIds, play: id, mode, title });
      return 'cast';
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
    return 'local';
  }, [view, params, dispatchToTarget, targetIds, mode, queue]);
}

export default useContentDispatch;
