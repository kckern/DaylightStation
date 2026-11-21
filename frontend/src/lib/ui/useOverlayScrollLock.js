import { useEffect } from 'react';
import { useAppMainRef } from './AppFrame.jsx';

const locks = new WeakMap();

function lockScroll(element) {
  let lock = locks.get(element);
  if (!lock) {
    const { style } = element;
    // A single axis or mixed priorities can leave the shorthand empty.
    const properties = style.getPropertyValue('overflow') ? ['overflow'] : ['overflow-x', 'overflow-y'];
    const previous = properties.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
    lock = { count: 0, previous };
    locks.set(element, lock);
    style.setProperty('overflow', 'hidden');
  }
  lock.count += 1;
  return () => {
    lock.count -= 1;
    if (lock.count !== 0) return;
    element.style.removeProperty('overflow');
    lock.previous.forEach(([name, value, priority]) => element.style.setProperty(name, value, priority));
    locks.delete(element);
  };
}

/** A visible overlay locks the document and its nearest frame until dismissal. */
export function useOverlayScrollLock(active) {
  const mainRef = useAppMainRef();
  useEffect(() => {
    if (!active) return undefined;
    const unlockBody = lockScroll(document.body);
    const main = mainRef?.current;
    const unlockMain = main ? lockScroll(main) : null;
    return () => {
      unlockMain?.();
      unlockBody();
    };
  }, [active, mainRef]);
}
