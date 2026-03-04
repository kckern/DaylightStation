import { createActionDetector, createCustomActionDetector } from '../../../../frontend/src/modules/Fitness/lib/pose/poseActions.js';
import { JUMPING_JACK, SQUAT, LUNGE, PUSH_UP, PLANK, BURPEE } from '../../../../frontend/src/modules/Fitness/lib/pose/exercisePatterns.js';

describe('exercise pattern definitions', () => {
  // --- Cyclic patterns create valid detectors ---

  test.each([
    ['JUMPING_JACK', JUMPING_JACK],
    ['SQUAT', SQUAT],
    ['LUNGE', LUNGE],
    ['PUSH_UP', PUSH_UP],
  ])('%s creates a valid cyclic detector', (name, pattern) => {
    const det = createActionDetector(pattern);
    expect(det.id).toBe(pattern.id);
    expect(typeof det.update).toBe('function');
    expect(typeof det.reset).toBe('function');
  });

  // --- Sustain patterns create valid detectors ---

  test('PLANK creates a valid sustain detector', () => {
    const det = createActionDetector(PLANK);
    expect(det.id).toBe('plank');
    expect(typeof det.update).toBe('function');
    expect(typeof det.reset).toBe('function');
  });

  // --- Custom patterns create valid detectors ---

  test('BURPEE creates a valid custom detector', () => {
    const det = createCustomActionDetector(BURPEE);
    expect(det.id).toBe('burpee');
    expect(typeof det.update).toBe('function');
    expect(typeof det.reset).toBe('function');
  });

  // --- Jumping Jack rep counting ---

  test('JUMPING_JACK counts a rep through open → closed cycle', () => {
    const det = createActionDetector(JUMPING_JACK);
    const open = { armsOverhead: true, wideStance: true, armsAtSides: false, narrowStance: false, upright: true };
    const closed = { armsOverhead: false, wideStance: false, armsAtSides: true, narrowStance: true, upright: true };

    det.update(closed, 1000);
    det.update(open, 1500);
    const r = det.update(closed, 2000);
    expect(r.repCount).toBe(1);
  });

  // --- Squat rep counting ---

  test('SQUAT counts a rep through down → up cycle', () => {
    const det = createActionDetector(SQUAT);
    const down = { squatting: true, upright: true, narrowStance: true };
    const up = { squatting: false, upright: true, narrowStance: true };

    det.update(up, 1000);
    det.update(down, 1900);
    const r = det.update(up, 2800);
    expect(r.repCount).toBe(1);
  });

  // --- Lunge rep counting ---

  test('LUNGE counts a rep through down → up cycle', () => {
    const det = createActionDetector(LUNGE);
    const down = { lunging: true, upright: true };
    const up = { lunging: false, upright: true };

    det.update(up, 1000);
    det.update(down, 1900);
    const r = det.update(up, 2800);
    expect(r.repCount).toBe(1);
  });

  // --- Push-up rep counting ---

  test('PUSH_UP counts a rep through down → up cycle', () => {
    const det = createActionDetector(PUSH_UP);
    const down = { prone: true, leftElbow: 'MID', armsExtended: false };
    const up = { prone: true, leftElbow: 'LOW', armsExtended: true };

    det.update(up, 1000);
    det.update(down, 1600);
    const r = det.update(up, 2200);
    expect(r.repCount).toBe(1);
  });

  // --- Plank hold ---

  test('PLANK tracks hold duration', () => {
    const det = createActionDetector(PLANK);
    det.update({ prone: true, armsExtended: true }, 1000);
    const r = det.update({ prone: true, armsExtended: true }, 6000);
    expect(r.holding).toBe(true);
    expect(r.holdDurationMs).toBe(5000);
  });

  // --- Burpee custom detection ---

  test('BURPEE counts a rep through full state machine', () => {
    const det = createCustomActionDetector(BURPEE);
    const standing = { upright: true, squatting: false, prone: false, armsOverhead: false };
    const squat = { upright: true, squatting: true, prone: false, armsOverhead: false };
    const prone = { upright: false, squatting: false, prone: true, armsOverhead: false };
    const jump = { upright: true, squatting: false, prone: false, armsOverhead: true };

    det.update(standing, 1000);   // standing
    det.update(squat, 1500);      // squatDown
    det.update(prone, 2000);      // prone
    det.update(squat, 2500);      // squatUp
    det.update(jump, 3000);       // jump
    const r = det.update(standing, 3500); // back to standing = 1 rep
    expect(r.repCount).toBe(1);
  });
});
