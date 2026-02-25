/**
 * Game Registry — maps game IDs to their component/hook lazy loaders and layout mode.
 *
 * layout modes:
 *   'waterfall' — game overlays on top of the existing waterfall view
 *   'replace'   — game takes over the entire PianoVisualizer viewport
 */
import { lazy } from 'react';

const GAME_REGISTRY = {
  rhythm: {
    component: () => import('./components/RhythmOverlay'),
    hook: () => import('./useRhythmGame'),
    layout: 'waterfall',
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
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
