import React, { useCallback, Suspense, lazy } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext';
import { TVMenu } from './Menu';
import { PlayerOverlayLoading } from '../Player/Player';

// Lazy load components that may be rendered from the stack
const Player = lazy(() => import('../Player/Player').then(m => ({ default: m.default || m.Player })));
const AppContainer = lazy(() => import('../AppContainer/AppContainer').then(m => ({ default: m.default || m.AppContainer })));

/**
 * Loading fallback for lazy-loaded components
 */
function LoadingFallback() {
  return <PlayerOverlayLoading shouldRender isVisible />;
}

/**
 * Renders the current menu level from the navigation stack.
 * Only the topmost item is rendered (stack-based navigation).
 * 
 * @param {Object} props
 * @param {Object|string} props.rootMenu - The root menu configuration (list name or menu object)
 */
export function MenuStack({ rootMenu }) {
  const { currentContent, depth, push, pop } = useMenuNavigationContext();

  /**
   * Handle selection from any menu level.
   * Maps selection to appropriate action (push menu, play content, open app).
   */
  const handleSelect = useCallback((selection) => {
    if (!selection) return;

    // Determine content type and push to stack
    if (selection.list || selection.menu) {
      push({ type: 'menu', props: selection });
    } else if (selection.play || selection.queue) {
      push({ type: 'player', props: selection });
    } else if (selection.open) {
      push({ type: 'app', props: selection });
    }
    // If none of the above, it might be a leaf action - let parent handle
  }, [push]);

  /**
   * Clear function for Player/AppContainer to pop back
   */
  const clear = useCallback(() => {
    pop();
  }, [pop]);

  // If stack is empty, render root menu
  if (!currentContent) {
    return (
      <TVMenu
        list={rootMenu}
        depth={0}
        onSelect={handleSelect}
        onEscape={() => {}} // At root, escape does nothing
      />
    );
  }

  // Render based on content type
  const { type, props } = currentContent;

  switch (type) {
    case 'menu':
      return (
        <TVMenu
          list={props.list || props.menu || props}
          depth={depth}
          onSelect={handleSelect}
          onEscape={clear}
        />
      );

    case 'player':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <Player {...props} clear={clear} />
        </Suspense>
      );

    case 'app':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AppContainer open={props.open} clear={clear} />
        </Suspense>
      );

    default:
      console.warn(`MenuStack: Unknown content type "${type}"`, props);
      return (
        <div className="menu-stack-error">
          Unknown content type: {type}
        </div>
      );
  }
}

export default MenuStack;
