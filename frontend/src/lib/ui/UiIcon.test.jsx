import { fireEvent, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { UiIcon } from './UiIcon.jsx';

it('provides the shared navigation and action icon names as decorative SVGs', () => {
  const names = [
    'back', 'brain', 'calendar', 'car', 'chart', 'close', 'coach', 'dashboard',
    'diamond', 'expand', 'folder', 'fuel', 'heart', 'home', 'mosaic', 'pause', 'pin', 'play', 'plus', 'search',
    'service', 'settings', 'shield', 'target', 'timeline', 'television', 'video',
  ];
  const { container } = render(<div>{names.map(name => <UiIcon key={name} name={name} />)}</div>);
  const icons = container.querySelectorAll('svg');
  expect(icons).toHaveLength(names.length);
  for (const icon of icons) {
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('stroke-width', '1.75');
  }
});

it('preserves the caller size and stroke for app navigation', () => {
  const { container } = render(<UiIcon name="car" size={20} stroke={1.5} className="nav-icon" />);
  expect(container.querySelector('svg')).toHaveAttribute('width', '20');
  expect(container.querySelector('svg')).toHaveClass('nav-icon');
});

it('uses the shared symbol when a configured asset icon cannot load', () => {
  const { container } = render(<UiIcon name="television" assetName="missing-fitness-icon" size={24} className="nav-icon" />);
  const image = container.querySelector('img');
  expect(image.getAttribute('src')).toMatch(/\/api\/v1\/static\/img\/icons\/missing-fitness-icon\.svg$/);
  fireEvent.error(image);
  const fallback = container.querySelector('svg');
  expect(fallback).toHaveAttribute('width', '24');
  expect(fallback).toHaveClass('nav-icon');
  expect(fallback).toHaveAttribute('aria-hidden', 'true');
});
