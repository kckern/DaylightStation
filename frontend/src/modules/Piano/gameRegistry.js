/**
 * Game Registry — maps game IDs to their component/hook lazy loaders and layout mode.
 *
 * layout modes:
 *   'replace'   — game takes over the entire PianoVisualizer viewport
 */
import { lazy } from 'react';

const GAME_REGISTRY = {
  'space-invaders': {
    component: () => import('./PianoSpaceInvaders/SpaceInvadersGame'),
    hook: () => import('./PianoSpaceInvaders/useSpaceInvadersGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoSpaceInvaders/SpaceInvadersGame')),
  },
  tetris: {
    component: () => import('./PianoTetris/PianoTetris'),
    hook: () => import('./PianoTetris/useTetrisGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoTetris/PianoTetris')),
  },
  flashcards: {
    component: () => import('./PianoFlashcards/PianoFlashcards'),
    hook: () => import('./PianoFlashcards/useFlashcardGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoFlashcards/PianoFlashcards')),
  },
  hero: {
    component: () => import('./PianoHeroGame/PianoHeroGame'),
    hook: () => import('./PianoHeroGame/PianoHeroGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoHeroGame/PianoHeroGame')),
  },
  'side-scroller': {
    component: () => import('./SideScrollerGame/SideScrollerGame'),
    hook: () => import('./SideScrollerGame/useSideScrollerGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./SideScrollerGame/SideScrollerGame')),
  },
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
