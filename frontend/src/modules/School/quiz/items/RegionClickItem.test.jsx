import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionClickItem from './RegionClickItem.jsx';

const item = { id: 'q', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' };

it('renders the prompt and submits the clicked region once', () => {
  const onSubmit = vi.fn();
  const { container } = render(<RegionClickItem item={item} onSubmit={onSubmit} verdict={null} />);
  expect(screen.getByText('Click Nevada')).toBeInTheDocument();
  const nv = container.querySelector('[data-region-id="NV"]');
  fireEvent.click(nv);
  fireEvent.click(nv);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('NV');
});

it('goes inert after a verdict', () => {
  const onSubmit = vi.fn();
  const { container } = render(<RegionClickItem item={item} onSubmit={onSubmit} verdict={{ correct: true, expected: 'NV' }} />);
  fireEvent.click(container.querySelector('[data-region-id="CA"]'));
  expect(onSubmit).not.toHaveBeenCalled();
});
