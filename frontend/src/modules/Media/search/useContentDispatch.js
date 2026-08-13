// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface. Precedence:
//   1. `peek` (remote-control) view → cast to the peeked device, mode:'fork'
//      (a remote control must never stop the device it is driving),
//   2. a cast target configured in the dock's chip → cast there in the chip's
//      mode — the chip is a promise about where content goes, and the search
//      bar sits beside it,
//   3. a CONTAINER with no device aimed at it → open the full browse view.
//      Picking "Tuttle Twins" in a search box means "show me the show", not
//      "queue all 24 episodes"; the seasons/episodes belong on the canvas,
//      not in a dropdown that dies on blur (2026-08-12 session review).
//      Note this is deliberately BELOW the two cast branches: with a device
//      aimed, "cast the album/playlist" is still the right read.
//   4. otherwise → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
import { useCallback } from 'react';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/DispatchProvider.jsx';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { contentIdToBrowsePath } from '../browse/browsePath.js';

export function useContentDispatch() {
  const { view, params, push } = useNav();
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
    if (item && isContainer(item)) {
      push('browse', { path: contentIdToBrowsePath(id), label: title ?? id });
      return 'browse';
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
    return 'local';
  }, [view, params, push, dispatchToTarget, targetIds, mode, queue]);
}

export default useContentDispatch;
