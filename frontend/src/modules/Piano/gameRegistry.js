/**
 * Game Registry — maps game IDs to their component/hook lazy loaders and layout mode.
 *
 * layout modes:
 *   'waterfall' — game overlays on top of the existing waterfall view
 *   'replace'   — game takes over the entire PianoVisualizer viewport
 */

const GAME_REGISTRY = {
  rhythm: {
    component: () => import('./components/GameOverlay'),
    hook: () => import('./useGameMode'),
    layout: 'waterfall',
  },
  tetris: {
    component: () => import('./PianoTetris/PianoTetris'),
    hook: () => import('./PianoTetris/useTetrisGame'),
    layout: 'replace',
  },
  flashcards: {
    component: () => import('./PianoFlashcards/PianoFlashcards'),
    hook: () => import('./PianoFlashcards/useFlashcardGame'),
    layout: 'replace',
  },
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
