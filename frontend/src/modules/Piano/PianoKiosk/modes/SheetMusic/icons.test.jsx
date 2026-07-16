import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlayIcon, PauseIcon, RestartIcon, QuarterNoteIcon, CloseIcon, ChevronDownIcon } from './icons.jsx';

describe('icons', () => {
  it.each([
    ['PlayIcon', PlayIcon], ['PauseIcon', PauseIcon], ['RestartIcon', RestartIcon],
    ['QuarterNoteIcon', QuarterNoteIcon], ['CloseIcon', CloseIcon], ['ChevronDownIcon', ChevronDownIcon],
  ])('%s renders a decorative currentColor svg', (_, Cmp) => {
    const { container } = render(<Cmp />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });
});
