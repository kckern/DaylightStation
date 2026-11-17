// Renders real School activity components into DOM snapshots for the style
// gallery (index.html). Run before and after a styling change, then shoot the
// gallery: the CSS under test applies to exactly the DOM the components emit.
//
//   npx vitest run --config tests/_fixtures/school/style-gallery/vitest.gallery.config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, it, vi } from 'vitest';
import FlashcardProgram from '../../../../__app_modules/learning/school/browser/Programs/Flashcards/FlashcardProgram.jsx';
import LanguageReelsProgram from '../../../../__app_modules/learning/school/browser/Programs/LanguageReels/LanguageReelsProgram.jsx';
import { languageReelsApi } from '../../../../__app_modules/learning/school/browser/Programs/LanguageReels/languageReelsApi.js';
import RubiksCubeProgram from '../../../../__app_modules/learning/school/browser/Programs/RubiksCube/RubiksCubeProgram.jsx';
import ChessLessons from '../../../../__app_modules/learning/school/browser/chess/ChessLessons.jsx';
import RewardsModal from '../../../../__app_modules/learning/school/browser/rewards/RewardsModal.jsx';
import { schoolApi } from '../../../../__app_modules/learning/school/browser/schoolApi.js';
import { COLORS, FACES } from '../../../../__capabilities/gaming/portable/rulesets/rubiks-cube/index.mjs';

vi.mock('../../../../__app_modules/learning/school/browser/Programs/LanguageReels/languageReelsApi.js', () => ({ createLanguageReelsApi: vi.fn(), languageReelsApi: { open: vi.fn(), attempt: vi.fn(), stage: vi.fn() } }));
vi.mock('../../../../__app_modules/learning/school/browser/schoolApi.js', () => {
  const api = { rubiksCubePreview: vi.fn(), rubiksCubeOpen: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn(), gems: vi.fn(), stateGates: vi.fn() };
  return { schoolApi: api, createSchoolApi: () => api };
});

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'snapshots');
const save = (name, html) => fs.writeFileSync(path.join(OUT, `${name}.html`), html);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const proto = Object.getPrototypeOf(document.createElement('dialog'));
  vi.spyOn(proto, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
  vi.spyOn(proto, 'close').mockImplementation(function () { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const deck = {
  id: 'biology/cells', title: 'Cell organelles', cards: [
    { cardId: 'mito', front: { blocks: [{ type: 'text', text: 'Where is ATP made?' }] }, back: { blocks: [{ type: 'text', text: 'Mitochondrion' }] } },
    { cardId: 'nucleus', front: { blocks: [{ type: 'text', text: 'Which organelle holds the DNA?' }] }, back: { blocks: [{ type: 'text', text: 'Nucleus' }] } },
  ],
};

it('flashcards', async () => {
  const view = render(<FlashcardProgram descriptor={{ deck, policy: { modes: ['cards', 'review', 'learn'] } }} />);
  await settle(); save('flashcards-front', view.container.innerHTML);
  fireEvent.click(screen.getByRole('button', { name: 'Show answer' })); await settle();
  save('flashcards-revealed', view.container.innerHTML);
  fireEvent.click(screen.getByRole('button', { name: 'review' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Show answer' })); await settle();
  save('flashcards-ratings', view.container.innerHTML);
});

it('language reels', async () => {
  const stages = { flashcards: true, listen: true, cloze: false, watch: false, comprehension: false, speaking: true };
  languageReelsApi.open.mockResolvedValue({ ok: true, status: 200, data: { session: { stages, attempts: [] }, mediaUrl: '', reel: { title: 'At the market', transcript: [], authoring: { cloze: [{ id: 'fill', prompt: 'I would like ___ apples, please.', answer: 'three', decoys: ['tree', 'there', 'they'] }] } } } });
  languageReelsApi.attempt.mockResolvedValue({ ok: true, status: 200, data: { stages, attempts: [{ type: 'cloze', itemId: 'fill', answer: 'tree', correct: false }] } });
  const view = render(<LanguageReelsProgram userId="learner" reelId="r" reelGrant="g" onExit={() => {}} />);
  await screen.findByRole('button', { name: 'three' }); await settle();
  save('reels-cloze', view.container.innerHTML);
  fireEvent.click(screen.getByRole('button', { name: 'tree' })); await screen.findByText(/Not quite/); await settle();
  save('reels-wrong', view.container.innerHTML);
});

it('rubiks cube', async () => {
  const cube = Object.fromEntries(FACES.map(face => [face, Array(9).fill(COLORS[face])]));
  const lesson = { id: 'turn-practice', title: 'Turn practice', kind: 'lesson', prompt: 'Turn the right face clockwise, then back.' };
  schoolApi.rubiksCubeOpen.mockResolvedValue({ ok: true, data: {
    course: { title: 'Rubik’s Cube Foundations', units: [
      { id: 'u1', title: 'Know the cube', lessons: [{ id: 'names', title: 'Naming faces', kind: 'demo', unlocked: true, completed: true }, { id: lesson.id, title: lesson.title, kind: 'lesson', unlocked: true, completed: false }] },
      { id: 'u2', title: 'The white cross', lessons: [{ id: 'cross', title: 'Daisy to cross', kind: 'lesson', unlocked: false, completed: false }] },
    ] },
    lesson, active: { lessonId: lesson.id, revision: 0, cube, moves: [], hints: 0 }, progress: { completed: 1, total: 3, score: 1 },
  } });
  const view = render(<RubiksCubeProgram userId="learner" cubeGrant="g" />);
  await screen.findByRole('heading', { name: 'Turn practice' }); await settle();
  save('rubiks-lesson', view.container.innerHTML);
});

it('chess lessons', async () => {
  const view = render(<ChessLessons />);
  save('chess-units', view.container.innerHTML);
  fireEvent.click(view.container.querySelector('.chess-lessons__unit')); await settle();
  save('chess-lessons', view.container.innerHTML);
  fireEvent.click(view.container.querySelector('.chess-lessons__lesson')); await settle();
  save('chess-board', view.container.innerHTML);
});

it('rewards modal', async () => {
  const snapshot = {
    learnerId: 'one', week: '2026-11-09', mode: 'live', silver: 24, gold: 3, rings: 1260,
    groups: [{ id: 'school', label: 'School' }, { id: 'home', label: 'Home' }],
    gems: [
      { id: 'reading', label: 'Reading', group: 'school', color: '#f2c94c', cell: { state: 'pending', week: 0, streak: { have: 3, need: 4, reach: 'on-track' }, parts: [] } },
      { id: 'math', label: 'Math', group: 'school', color: '#56ccf2', cell: { state: 'earned', week: 1, streak: { have: 4, need: 4, reach: 'met' }, parts: [] } },
      { id: 'chores', label: 'Chores', group: 'home', color: '#6fcf97', cell: { state: 'pending', week: 0, streak: { have: 1, need: 5, reach: 'behind' }, parts: [] } },
    ],
  };
  render(<RewardsModal learner={{ id: 'one', name: 'Learner One' }} snapshot={snapshot} onClose={() => {}} idleMs={0} />);
  await settle();
  save('rewards-modal', document.body.innerHTML);
});
