import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ActionStaff } from './ActionStaff.jsx';

describe('ActionStaff', () => {
  it.each([
    ['moveLeft', 'Move left'],
    ['rotateCW', 'Rotate right'],
    ['hardDrop', 'Drop'],
    ['jump', 'Jump'],
    ['duck', 'Duck'],
  ])('names the %s icon rather than exposing an anonymous SVG', (action, label) => {
    const { container } = render(<ActionStaff action={action} targetPitches={[60]} />);
    expect(container.querySelector('.action-staff__icon').getAttribute('aria-label')).toBe(label);
  });
});

