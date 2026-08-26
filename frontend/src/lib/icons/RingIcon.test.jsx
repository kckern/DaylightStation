/**
 * The two invariants that are invisible until they break in production:
 * duplicate IDs (four cards on the status board) and surviving SMIL (which
 * would silently defeat prefers-reduced-motion again).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RingIcon from './RingIcon.jsx';

describe('RingIcon', () => {
  it('is static and decorative by default', () => {
    const { container } = render(<RingIcon />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('class')).toBe('ring-icon');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('opts into continuous and one-shot spin', () => {
    expect(render(<RingIcon spin />).container.querySelector('svg').getAttribute('class'))
      .toContain('ring-icon--spin');
    expect(render(<RingIcon spin="once" />).container.querySelector('svg').getAttribute('class'))
      .toContain('ring-icon--spin-once');
  });

  it('becomes an accessible image when it carries the meaning', () => {
    const { container } = render(<RingIcon label="rings" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    const titleId = svg.getAttribute('aria-labelledby');
    expect(container.querySelector(`#${CSS.escape(titleId)}`).textContent).toBe('rings');
  });

  it('NEVER emits a duplicate element id across instances', () => {
    // The status board renders one per child. Before namespacing, four cards
    // meant four `id="orange-band"` and an ambiguous url(#orange-band).
    const { container } = render(
      <div><RingIcon /><RingIcon /><RingIcon /><RingIcon /></div>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references its own gradients, not a neighbour\'s', () => {
    const { container } = render(<div><RingIcon /><RingIcon /></div>);
    const [first, second] = container.querySelectorAll('svg');
    const gradOf = (svg) => svg.querySelector('linearGradient').id;
    expect(gradOf(first)).not.toBe(gradOf(second));

    // Every url(#…) inside an svg must resolve to an id declared in THAT svg.
    for (const svg of [first, second]) {
      const declared = new Set([...svg.querySelectorAll('[id]')].map((n) => n.id));
      const refs = [...svg.querySelectorAll('*')]
        .flatMap((n) => [n.getAttribute('stroke'), n.getAttribute('filter')])
        .filter((v) => v && v.startsWith('url(#'))
        .map((v) => v.slice(5, -1));
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(declared.has(ref)).toBe(true);
    }
  });

  it('contains NO SMIL — all motion must be CSS so reduced-motion can stop it', () => {
    // If an <animateTransform> ever comes back, prefers-reduced-motion is
    // silently broken again and only this assertion notices.
    const { container } = render(<RingIcon spin />);
    expect(container.querySelector('animateTransform')).toBeNull();
    expect(container.querySelector('animate')).toBeNull();
  });

  it('drives all eight extrusion planes from one keyframe via --amp', () => {
    const { container } = render(<RingIcon />);
    const slices = container.querySelectorAll('.ring-icon__slice');
    expect(slices).toHaveLength(8); // 7 depth slices + the face
    const amps = [...slices].map((n) => n.style.getPropertyValue('--amp'));
    expect(amps).toEqual(['-14px', '-10px', '-6px', '-2px', '2px', '6px', '10px', '14px']);
  });
});
