import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import EmbedSection from './EmbedSection.jsx';

describe('EmbedSection', () => {
  test('frames an embed on another origin', () => {
    const { container } = render(<EmbedSection data={{ url: 'https://player.example/embed/1' }} />);
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://player.example/embed/1');
  });

  test('frames nothing that is not http(s), or that is on the app\'s own origin', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/api/v1/admin', `${window.location.origin}/admin`]) {
      const { container, unmount } = render(<EmbedSection data={{ url }} />);
      expect(container.querySelector('iframe'), url).toBeNull();
      unmount();
    }
  });
});
