import crypto from 'node:crypto';
import { applySequence, cubeFaces, goalReached } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';

const GROUP_SIZE = 4;

const instruction = (goal) => ({
  'white-cross': 'Build the white cross: each white edge must also match its side centre.',
  'first-layer': 'Finish the white layer before moving on.',
  'middle-layer': 'Keep the first layer safe while completing the middle layer.',
  'yellow-oriented': 'Make every top sticker yellow; the side pieces can wait.',
  solved: 'Complete the cube layer by layer.',
}[goal] ?? 'Work toward the current unit goal.');

/**
 * Turns a verified physical state into an immutable, paper-first route.  The
 * solver is deliberately behind this port: a future beginner-method planner
 * can replace it without changing packet storage, rendering, or companion
 * identity.  Every emitted group is replayed through the house engine.
 */
export class RubiksPacketPlanner {
  #solver; #clock;
  constructor({ solver, clock = () => new Date() } = {}) { this.#solver = solver; this.#clock = clock; }

  async plan({ unitId, lessonId, goal, facelets, cube }) {
    if (!cube || !facelets) throw new Error('Enter a valid physical cube before making a packet.');
    if (unitId === 'know-the-cube') {
      return {
        id: crypto.randomUUID(), schema: 'school.rubiks-packet/v1', planner: 'foundation-intake-v1', unitId, lessonId, goal: 'orientation',
        generatedAt: this.#clock().toISOString(), inputFacelets: facelets, inputCube: cubeFaces(cube),
        steps: [{ number: 1, title: 'Meet your own cube', instruction: 'Find the six centre stickers. They do not move; they name each face.', moves: [], before: cubeFaces(cube), after: cubeFaces(cube) },
          { number: 2, title: 'Read the faces', instruction: 'With white on top and green in front, name the faces U, R, F, D, L, and B on your cube.', moves: [], before: cubeFaces(cube), after: cubeFaces(cube) }],
      };
    }
    if (!this.#solver) throw new Error('The paper-plan solver is unavailable. Try again in a moment.');
    const allMoves = await this.#solver.solve(facelets);
    let working = cube; const steps = [];
    for (let offset = 0; offset < allMoves.length; offset += GROUP_SIZE) {
      const moves = allMoves.slice(offset, offset + GROUP_SIZE); const before = cubeFaces(working); working = applySequence(working, moves);
      steps.push({ number: steps.length + 1, title: `Move group ${steps.length + 1}`, instruction: instruction(goal), moves, before, after: cubeFaces(working) });
      if (goalReached(working, goal)) break;
    }
    if (!goalReached(working, goal)) throw new Error('The planner could not reach this unit’s goal from the entered cube.');
    return { id: crypto.randomUUID(), schema: 'school.rubiks-packet/v1', planner: 'verified-route-v1', unitId, lessonId, goal,
      generatedAt: this.#clock().toISOString(), inputFacelets: facelets, inputCube: cubeFaces(cube), steps };
  }
}

export default RubiksPacketPlanner;
