import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import MediaSection from './MediaSection.jsx';
import GallerySection from './GallerySection.jsx';

const srcs = (container) => [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('feed detail image sections', () => {
  test('MediaSection renders only safe image URLs', () => {
    const { container } = render(<MediaSection data={{ images: [
      { url: 'https://cdn.example/a.jpg' }, { url: '/api/v1/home/script/run' }, { url: '/api/v1/proxy/immich/assets/a/thumbnail' },
    ] }} />);
    expect(srcs(container)).toEqual(['https://cdn.example/a.jpg', '/api/v1/proxy/immich/assets/a/thumbnail']);
  });

  test('GallerySection renders only safe image URLs', () => {
    const { container } = render(<GallerySection data={{ items: [
      { id: '1', image: '/API/v1/admin/x' }, { id: '2', image: 'https://cdn.example/b.jpg' },
    ] }} />);
    expect(srcs(container)).toEqual(['https://cdn.example/b.jpg']);
  });
});
