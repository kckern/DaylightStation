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
  'card-game': {
    label: 'Battle Stadium', icon: 'game-battle-stadium', status: 'preview', family: 'external-runtime',
    component: () => importWithReload(() => import('./PianoCardGame/CardGame')),
    hook: () => importWithReload(() => import('./PianoCardGame/CardGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoCardGame/CardGame')),
  },
  'space-invaders': {
    label: 'Space Invaders', icon: 'game-space-invaders', status: 'released', family: 'note-stream',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoSpaceInvaders/SpaceInvadersGame')),
    hook: () => importWithReload(() => import('./PianoSpaceInvaders/useSpaceInvadersGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoSpaceInvaders/SpaceInvadersGame')),
  },
  tetris: {
    label: 'Tetris', icon: 'game-tetris', status: 'released', family: 'bound-action',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoTetris/PianoTetris')),
    hook: () => importWithReload(() => import('./PianoTetris/useTetrisGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoTetris/PianoTetris')),
  },
  flashcards: {
    label: 'Flashcards', icon: 'game-flashcards', status: 'released', family: 'prompt-response',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoFlashcards/PianoFlashcards')),
    hook: () => importWithReload(() => import('./PianoFlashcards/useFlashcardGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoFlashcards/PianoFlashcards')),
  },
  hero: {
    label: 'Piano Hero', icon: 'game-hero', status: 'released', family: 'note-stream',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
    hook: () => importWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoHeroGame/PianoHeroGame')),
  },
  'side-scroller': {
    label: 'Side Scroller', icon: 'game-side-scroller', status: 'released', family: 'bound-action',
    exerciseGate: true,
    component: () => importWithReload(() => import('./SideScrollerGame/SideScrollerGame')),
    hook: () => importWithReload(() => import('./SideScrollerGame/useSideScrollerGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./SideScrollerGame/SideScrollerGame')),
  },
  chess: {
    label: 'Piano Chess', icon: 'game-chess', status: 'released', family: 'addressed-board',
    // This is a property of Chess, not of a particular launcher. Every host
    // that mounts this entry must put its configured match boundary in front of
    // it, including the office piano display.
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoChessGame/PianoChessGame')),
    hook: () => importWithReload(() => import('./PianoChessGame/PianoChessGame')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoChessGame/PianoChessGame')),
  },
  'connect-four': {
    label: 'Connect Four', icon: 'game-connect-four', status: 'released', family: 'addressed-board',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoConnectFour/PianoConnectFour')),
    hook: () => importWithReload(() => import('./PianoConnectFour/PianoConnectFour')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoConnectFour/PianoConnectFour')),
  },
  checkers: {
    label: 'Piano Checkers', icon: 'game-checkers', status: 'released', family: 'addressed-board',
    exerciseGate: true,
    component: () => importWithReload(() => import('./PianoCheckers/PianoCheckers')),
    hook: () => importWithReload(() => import('./PianoCheckers/PianoCheckers')),
    layout: 'replace',
    LazyComponent: lazyWithReload(() => import('./PianoCheckers/PianoCheckers')),
  },
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

/**
 * Fetch a game's chunk BEFORE anything is riding on it.
 *
 * `lazyWithReload` recovers from a stale chunk by reloading the shell, which is
 * the right repair and the wrong MOMENT when the import is triggered by a game
 * mounting: by then a child has passed a gate, and the recovery costs them the
 * thing they just earned. Worse, when the reload guard was latched (see
 * lib/chunkReload.js) there was no recovery at all and they got "This game
 * stopped." — four times running, on 2026-09-11, after four clean passes.
 *
 * A gate takes tens of seconds. Warming the chunk while the child is still
 * playing means a stale shell reloads BEFORE they have spent anything, and a
 * warm chunk makes the hand-over after the ceremony instant. Failure is not
 * propagated: `importWithReload` has already either reloaded or decided this is
 * a real fault, and a preflight must never be the reason a gate does not open.
 *
 * @param {string} gameId
 * @returns {Promise<void>} resolves whatever happened.
 */
export function preloadGame(gameId) {
  const entry = getGameEntry(gameId);
  if (!entry?.component) return Promise.resolve();
  return Promise.resolve()
    .then(() => entry.component())
    .then(() => {}, () => {});
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
