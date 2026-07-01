import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RomanProgression, RomanChord } from './RomanProgression.jsx';

describe('RomanChord', () => {
  it('renders numeral, accidental and figure', () => {
    const { container } = render(<RomanChord token="bVII7" />);
    expect(container.textContent).toContain('♭');
    expect(container.textContent).toContain('VII');
    expect(container.querySelector('sup').textContent).toBe('7');
  });
  it('tags minor quality on the element for styling', () => {
    const { container } = render(<RomanChord token="ii" />);
    expect(container.querySelector('.roman-chord').dataset.quality).toBe('minor');
  });
});

describe('RomanProgression', () => {
  it('renders one chord per token, highlighting the active index', () => {
    const { container } = render(<RomanProgression roman={['I', 'V', 'vi', 'IV']} activeIndex={2} />);
    const chips = container.querySelectorAll('.roman-chord');
    expect(chips.length).toBe(4);
    expect(chips[2].classList.contains('is-active')).toBe(true);
  });
  it('renders nothing for empty input', () => {
    const { container } = render(<RomanProgression roman={[]} />);
    expect(container.querySelector('.roman-progression')).toBeNull();
  });
});
