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

  it('renders nothing for an unknown name', () => {
    const { container } = render(<Icon name="not-a-subject" />);
    expect(container.firstChild).toBeNull();
  });
});
