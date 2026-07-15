// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface based on the
// active Media view. In `peek` (remote-control) view we cast to the peeked
// device with mode:'fork' (never touches the local session); everywhere else
// the selection plays locally, replacing the queue. This is the dispatch seam
// the transient content search (MediaContentSearch) hands selections to.
import { useCallback } from 'react';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/DispatchProvider.jsx';
import { useSessionController } from '../controller/useSessionController.js';

export function useContentDispatch() {
  const { view, params } = useNav();
  const { dispatchToTarget } = useDispatch();
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
      return;
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
  }, [view, params, dispatchToTarget, queue]);
}

export default useContentDispatch;
