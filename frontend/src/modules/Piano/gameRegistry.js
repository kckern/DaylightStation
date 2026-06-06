/**
 * Game Registry — maps game IDs to their component/hook lazy loaders and layout mode.
 *
 * layout modes:
 *   'replace'   — game takes over the entire PianoVisualizer viewport
 */
import { importWithReload, lazyWithReload } from '../../lib/chunkReload.js';

// All game code is code-split into lazy chunks. Wrap every dynamic import with
// stale-chunk reload recovery so a deploy that rotates asset hashes can never
// leave a game DOA on a long-lived tab — it hard-reloads to the fresh shell
// instead of failing into a blank Suspense. See lib/chunkReload.js.
const GAME_REGISTRY = {
  'space-invaders': {
    component: () => importWithReload(() => import('./PianoSpaceInvaders/SpaceInvadersGame')),
    hook: () => importWithReload(() => import('./PianoSpaceInvaders/useSpaceInvadersGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoSpaceInvaders/SpaceInvadersGame')),
  },
  tetris: {
    component: () => importWithReload(() => import('./PianoTetris/PianoTetris')),
    hook: () => importWithReload(() => import('./PianoTetris/useTetrisGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoTetris/PianoTetris')),
  },
  flashcards: {
    component: () => importWithReload(() => import('./PianoFlashcards/PianoFlashcards')),
    hook: () => importWithReload(() => import('./PianoFlashcards/useFlashcardGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoFlashcards/PianoFlashcards')),
  },
  hero: {
    component: () => importWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
    hook: () => importWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
  },
  'side-scroller': {
    component: () => importWithReload(() => import('./SideScrollerGame/SideScrollerGame')),
    hook: () => importWithReload(() => import('./SideScrollerGame/useSideScrollerGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./SideScrollerGame/SideScrollerGame')),
  },
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
