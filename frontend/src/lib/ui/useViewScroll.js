import { useLayoutEffect, useRef } from 'react';

export function useViewScroll({ mainRef, viewKey, owner, ready = true }) {
  const positions = useRef(new Map());
  const previousOwner = useRef(owner);

  useLayoutEffect(() => {
    if (previousOwner.current !== owner) {
      positions.current.clear();
      previousOwner.current = owner;
    }
    const main = mainRef.current;
    if (!main || !ready) return;
    main.scrollTop = positions.current.get(viewKey) ?? 0;
    const remember = () => positions.current.set(viewKey, main.scrollTop);
    main.addEventListener('scroll', remember);
    return () => main.removeEventListener('scroll', remember);
  }, [mainRef, viewKey, owner, ready]);
}
