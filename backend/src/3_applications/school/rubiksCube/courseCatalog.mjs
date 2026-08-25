import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';

export const RUBIKS_CUBE_COURSE_ID = 'beginner-v1';
export const RUBIKS_CUBE_REVISION = 1;

const quiz = (id, title, prompt, options, answer) => ({ id, title, kind: 'quiz', prompt, questions: [
  { prompt, options, answer },
  { prompt: 'Which symbol means turn a face counter-clockwise?', options: ['2', 'x', "'", '+'], answer: 2 },
  { prompt: 'How many stickers are on a 3×3 cube?', options: ['27', '36', '54', '48'], answer: 2 },
  { prompt: 'What stays fixed and tells you each face colour?', options: ['Edges', 'Centres', 'Algorithms', 'Corners'], answer: 1 },
  { prompt: 'What does a 2 after a move mean?', options: ['Turn it slowly', 'Undo it', 'Use two faces', 'Turn it twice'], answer: 3 },
] });

const solve = (id, title, prompt, seed, { kind = 'lesson', challenge = false, length = 3 } = {}) => ({
  id, title, kind, prompt, seed, challenge,
  // The authored inverse is used only for the progressive hint ladder. The
  // cube itself accepts any legal route to the solved state.
  scrambleLength: length,
  solution: scramble(seed, length).reverse().map(inverseMove),
});

const demo = (id, title, prompt, moves) => ({ id, title, kind: 'demo', prompt, moves });

export const RUBIKS_CUBE_COURSE = Object.freeze({
  id: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION, title: 'Rubik’s Cube Foundations',
  units: [
    { id: 'know-the-cube', title: 'Know the cube', lessons: [
      demo('centres-and-pieces', 'Centres, edges, and corners', 'Centres stay put. They tell you which colour belongs on each face.', ['R', "R'"]),
      demo('read-notation', 'Read cube notation', 'A letter names a face. A prime means turn it the other way.', ['R', 'U', "R'", "U'"]),
      solve('turn-practice', 'Turn practice', 'Use the face buttons to return this little scramble to solved.', 101),
      quiz('know-the-cube-quiz', 'Notation check', 'What does the letter R name?', ['The right face', 'A red sticker', 'A reset', 'A row'], 0),
    ] },
    { id: 'white-cross', title: 'Build the white cross', lessons: [
      demo('cross-goal', 'Meet the white cross', 'A cross edge must match white and the side centre.', ['F', 'R', "F'", "R'"]),
      solve('cross-edges', 'Match cross edges', 'Return this practice cube to solved. Watch the side colours as well as white.', 201),
      solve('cross-strategy', 'Plan before turning', 'Try a short scramble. Reset whenever you want to rethink your plan.', 202),
      solve('cross-challenge', 'White cross challenge', 'Solve this fresh practice scramble without a timer.', 203, { kind: 'challenge' }),
      quiz('white-cross-quiz', 'Cross check', 'What makes a white cross edge correct?', ['It matches white and its side centre', 'It only has a white sticker', 'It sits beside any edge', 'It is in the middle layer'], 0),
    ] },
    { id: 'white-corners', title: 'Finish the first layer', lessons: [
      demo('right-trigger', 'The right trigger', 'This short move pattern is one of your best tools.', ['R', 'U', "R'", "U'"]),
      demo('left-trigger', 'The left trigger', 'The mirror image helps corners enter from the other side.', ["L'", "U'", 'L', 'U']),
      solve('corner-practice', 'Insert a corner', 'Solve the cube and notice where each three-colour corner belongs.', 301),
      solve('first-layer-challenge', 'First-layer challenge', 'Use the triggers you just learned.', 302, { kind: 'challenge' }),
      quiz('white-corners-quiz', 'First-layer check', 'How many colours does a corner piece have?', ['Two', 'Four', 'Three', 'One'], 2),
    ] },
    { id: 'middle-layer', title: 'Solve the middle layer', lessons: [
      demo('middle-right', 'Send an edge right', 'This sequence makes room, then places an edge on the right.', ['U', 'R', "U'", "R'", "U'", "F'", 'U', 'F']),
      demo('middle-left', 'Send an edge left', 'This is the mirror sequence for an edge on the left.', ["U'", "L'", 'U', 'L', 'U', 'F', "U'", "F'"]),
      solve('middle-layer-practice', 'Middle-layer practice', 'Solve this state with patient, deliberate turns.', 401),
      solve('middle-layer-challenge', 'Middle-layer challenge', 'Complete a fresh practice scramble.', 402, { kind: 'challenge' }),
      quiz('middle-layer-quiz', 'Middle-layer check', 'How do you choose a middle-layer insertion?', ['Choose left or right from the target centre', 'Always use the right algorithm', 'Turn the whole cube over', 'Use only double turns'], 0),
    ] },
    { id: 'yellow-face', title: 'Make the yellow face', lessons: [
      demo('yellow-cross-algorithm', 'Make a yellow cross', 'Use the same sequence to orient the top edges.', ['F', 'R', 'U', "R'", "U'", "F'"]),
      demo('orient-corners', 'Turn yellow corners up', 'A short repeated algorithm turns one corner at a time.', ['R', 'U', "R'", 'U', 'R', 'U2', "R'"]),
      solve('yellow-face-practice', 'Yellow-face practice', 'Solve this state and look for the pattern before moving.', 501),
      solve('yellow-face-challenge', 'Yellow-face challenge', 'Complete this practice scramble.', 502, { kind: 'challenge' }),
      quiz('yellow-face-quiz', 'Yellow-face check', 'What comes first on the yellow face?', ['Permute every edge', 'Orient the top colour', 'Break the cross', 'Turn the cube upside down'], 1),
    ] },
    { id: 'last-layer', title: 'Put the last layer in place', lessons: [
      demo('position-corners', 'Position the last corners', 'Now their colours point up; put the corners in their homes.', ['U', 'R', "U'", "L'", 'U', "R'", "U'", 'L']),
      demo('position-edges', 'Position the last edges', 'The final edge cycle brings the whole cube home.', ['R2', 'U', 'R', 'U', "R'", "U'", "R'", "U'", "R'", 'U', "R'"]),
      solve('last-layer-practice', 'Last-layer practice', 'Solve this final-layer scramble.', 601),
      solve('last-layer-challenge', 'Last-layer challenge', 'Complete the whole cube without a timer.', 602, { kind: 'challenge' }),
      quiz('last-layer-quiz', 'Last-layer check', 'What is the useful last-layer order?', ['Position, then orient', 'Orient, then position', 'Scramble, then reset', 'Use speed first'], 1),
    ] },
    { id: 'complete-the-cube', title: 'Complete the cube', lessons: [
      solve('guided-full-solve', 'Guided full solve', 'Put every stage together with the hint ladder nearby.', 701),
      solve('fresh-full-solve', 'Fresh full solve', 'Solve a 20-move scramble. Time is a personal best, never a gate.', 702, { kind: 'challenge', length: 20 }),
      solve('personal-best-replay', 'Try for a personal best', 'Try another complete solve at your own pace.', 703, { kind: 'challenge', length: 20 }),
      quiz('final-quiz', 'Rubik’s Cube Foundations', 'What is the goal of this course?', ['A complete layer-by-layer solve', 'Memorize one random move', 'Only solve a white face', 'Finish in a fixed time'], 0),
    ] },
  ],
});

export function activities(course = RUBIKS_CUBE_COURSE) {
  return course.units.flatMap((unit, unitIndex) => unit.lessons.map((lesson, lessonIndex) => ({ ...lesson, unitId: unit.id, unitTitle: unit.title, unitIndex, lessonIndex })));
}

export function activityById(id) { return activities().find((lesson) => lesson.id === id) ?? null; }

export function publicActivity(activity) {
  if (!activity) return null;
  const { solution, questions, ...safe } = activity;
  return { ...safe, ...(questions ? { questions: questions.map(({ answer, ...question }) => question) } : {}) };
}
