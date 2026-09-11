import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Icon from './Icon.jsx';
import { SUBJECTS } from '../subjects.js';

describe('school subject icons', () => {
  it('has an inline SVG for every subject id', () => {
    for (const { id } of SUBJECTS) {
      const { container, unmount } = render(<Icon name={id} />);
      expect(container.querySelector('svg'), `icon for ${id}`).not.toBeNull();
      unmount();
    }
  });

  it('has an inline SVG for each content-kind glyph', () => {
    for (const name of ['kind-video', 'kind-audio', 'kind-app', 'kind-deck']) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg'), `icon for ${name}`).not.toBeNull();
      unmount();
    }
  });

  // Named one by one, never globbed. A directory walk would keep passing while
  // a rung quietly lost its icon — the count stays right and the coverage moves.
  it('has an inline SVG named for every rung of the sentence ladder', () => {
    for (const rung of ['repetition', 'dictation', 'recording', 'interpretation']) {
      const { container, unmount } = render(<Icon name={`rung-${rung}`} />);
      const svg = container.querySelector('svg');
      expect(svg, `icon for rung-${rung}`).not.toBeNull();
      // The inline-icon contract (MANIFEST.md): sizes to 1em, colours from CSS.
      expect(svg.getAttribute('width')).toBe('1em');
      expect(svg.outerHTML).toContain('currentColor');
      expect(svg.outerHTML, `rung-${rung} has a baked-in colour`).not.toMatch(/#[0-9a-f]{3,8}/i);
      unmount();
    }
  });

  it('renders nothing for an unknown name', () => {
    const { container } = render(<Icon name="not-a-subject" />);
    expect(container.firstChild).toBeNull();
  });
});
