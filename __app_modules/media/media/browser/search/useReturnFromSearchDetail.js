// useReturnFromSearchDetail.js — calls `onReturn` once when the person comes
// BACK from an info view that the search opened (nav params `from: 'search'`):
// the top of the nav stack leaves that `detail` entry by going down a level.
// Used to put the person back in the search they came from (the box focused,
// the list open on the row they picked).
import { useEffect, useRef } from 'react';
import { useNav } from "../shell/NavProvider.jsx";

export function useReturnFromSearchDetail(onReturn) {
  const { view, params, depth } = useNav();
  const previousRef = useRef({ view, params, depth });
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { view, params, depth };
    if (previous.view === 'detail' && previous.params?.from === 'search'
      && typeof depth === 'number' && depth < previous.depth) {
      onReturnRef.current?.({ contentId: previous.params?.contentId ?? null });
    }
  }, [view, params, depth]);
}

export default useReturnFromSearchDetail;
