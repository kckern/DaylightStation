import React, { forwardRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useUnsavedGuardRegistry } from './useUnsavedGuardRegistry.js';

function modifiedClick(event, target) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    || (target && target !== '_self');
}

export function shouldGuardNavigation(event, target) {
  return !modifiedClick(event, target);
}

const GuardedLink = forwardRef(function GuardedLink({ to, onClick, target, ...props }, ref) {
  const registry = useUnsavedGuardRegistry();
  const handleClick = useCallback((event) => {
    onClick?.(event);
    if (event.defaultPrevented || !shouldGuardNavigation(event, target) || !registry) return;
    if (!registry.prepareNavigation(to)) event.preventDefault();
  }, [onClick, registry, target, to]);

  return <Link {...props} ref={ref} to={to} target={target} onClick={handleClick} />;
});

export default GuardedLink;
