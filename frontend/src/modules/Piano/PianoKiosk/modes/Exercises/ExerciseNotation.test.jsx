import { describe, expect, it } from 'vitest';
import { instanceToAbc } from './ExerciseNotation.jsx';

const base = {
  key: 'C',
  meter: '4/4',
  ordering: 'strict',
};

describe('exercise notation staff selection', () => {
  it('uses a single treble staff for a right-hand-only exercise', () => {
    const abc = instanceToAbc({
      ...base,
      events: [
        { notes: [{ midi: 60, hand: 'right', finger: 1 }] },
        { notes: [{ midi: 64, hand: 'right', finger: 3 }] },
      ],
    });

    expect(abc).toContain('V:MAIN clef=treble');
    expect(abc).not.toContain('V:LH');
    expect(abc).toContain('!1!C');
  });

  it('uses a single bass staff for a left-hand-only exercise', () => {
    const abc = instanceToAbc({
      ...base,
      events: [{ notes: [{ midi: 48, hand: 'left', finger: 5 }] }],
    });

    expect(abc).toContain('V:MAIN clef=bass');
    expect(abc).not.toContain('V:RH');
  });

  it('keeps a grand staff when both hands play', () => {
    const abc = instanceToAbc({
      ...base,
      events: [{ notes: [{ midi: 48, hand: 'left' }, { midi: 60, hand: 'right' }] }],
    });

    expect(abc).toContain('%%staves {(RH) (LH)}');
    expect(abc).toContain('V:RH clef=treble');
    expect(abc).toContain('V:LH clef=bass');
  });
});
