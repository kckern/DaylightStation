// ExerciseNotation.component.test.jsx — the wrapper's own render decision:
// nothing painted when instanceToAbc has nothing to say. AbcRenderer is mocked
// out (it's abcjs's job to draw a tune, not this component's) so this test
// stays about ExerciseNotation's own branch, not abcjs's SVG output.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseNotation from './ExerciseNotation.jsx';

vi.mock('../../../../MusicNotation/renderers/AbcRenderer.jsx', () => ({
  AbcRenderer: ({ abc }) => <div data-testid="abc-renderer" data-abc={abc} />,
}));

const base = {
  key: 'C',
  meter: '4/4',
  ordering: 'strict',
  events: [{ notes: [{ midi: 60, hand: 'right' }] }],
};

describe('ExerciseNotation', () => {
  it('renders the AbcRenderer for material instanceToAbc can draw', () => {
    const { container, getByTestId } = render(<ExerciseNotation instance={base} />);
    expect(getByTestId('abc-renderer')).toBeInTheDocument();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders nothing — not even an empty AbcRenderer — for ordering:any material', () => {
    const { container, queryByTestId } = render(<ExerciseNotation instance={{ ...base, ordering: 'any' }} />);
    expect(queryByTestId('abc-renderer')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });
});
