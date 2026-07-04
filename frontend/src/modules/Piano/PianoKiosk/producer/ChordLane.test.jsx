import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChordLane } from './ChordLane.jsx';

const bundle = { notes: [{ ticks: 0, durationTicks: 4, midi: 60 }], ppq: 4, barSpan: 4 };

describe('ChordLane', () => {
  it('renders a slot per chord (with its Roman glyph) plus a sweeping cursor', () => {
    const { container } = render(<ChordLane roman={['I', 'IV', 'V', 'I']} notesBundle={bundle} />);
    expect(container.querySelectorAll('.piano-chord-lane__slot').length).toBe(4);
    expect(container.querySelectorAll('.roman-chord').length).toBe(4);
    expect(container.querySelector('.piano-chord-lane__cursor')).toBeTruthy();
  });

  it('renders nothing without chords', () => {
    const { container } = render(<ChordLane roman={[]} notesBundle={bundle} />);
    expect(container.querySelector('.piano-chord-lane')).toBeNull();
  });

  it('keeps the cursor hidden while stopped', () => {
    const { container } = render(<ChordLane roman={['I']} notesBundle={bundle} isPlaying={false} />);
    expect(container.querySelector('.piano-chord-lane__cursor').style.opacity).toBe('0');
  });

  it('shows keyed chord names above the Roman when tonicPc is given (design §7)', () => {
    // tonic D (pc 2): I→D, IV→G, V→A, vi→Bm
    const { container } = render(
      <ChordLane roman={['I', 'IV', 'V', 'vi']} notesBundle={bundle} tonicPc={2} />,
    );
    const keyed = [...container.querySelectorAll('.piano-chord-lane__keyed')].map((n) => n.textContent);
    expect(keyed).toEqual(['D', 'G', 'A', 'Bm']);
  });

  it('omits keyed names in the abstract (no tonicPc) — Roman only', () => {
    const { container } = render(<ChordLane roman={['I', 'IV']} notesBundle={bundle} />);
    expect(container.querySelector('.piano-chord-lane__keyed')).toBeNull();
  });
});
