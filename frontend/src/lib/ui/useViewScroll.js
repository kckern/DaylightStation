import { useLayoutEffect, useRef } from 'react';

export function useViewScroll({ mainRef, viewKey, owner, ready = true }) {
  const positions = useRef(new Map());
  const previousScope = useRef(null);

  useLayoutEffect(() => {
    const previous = previousScope.current;
    const ownerChanged = previous?.owner !== owner;
    const scopeChanged = !previous || ownerChanged || previous.viewKey !== viewKey;
    if (ownerChanged) positions.current.clear();
    previousScope.current = { owner, viewKey };

    const main = mainRef.current;
    if (!main) return;
    if (!ready) {
      if (scopeChanged) main.scrollTop = 0;
      return;
    }
    main.scrollTop = positions.current.get(viewKey) ?? 0;
    const remember = () => positions.current.set(viewKey, main.scrollTop);
    main.addEventListener('scroll', remember);
    return () => main.removeEventListener('scroll', remember);
  }, [mainRef, viewKey, owner, ready]);
}
