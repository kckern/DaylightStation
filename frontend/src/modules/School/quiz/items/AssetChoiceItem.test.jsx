import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AssetChoiceItem from './AssetChoiceItem.jsx';

const item = { id: 'geo:world-flags:FR', type: 'asset_choice', prompt: 'Whose flag is this?',
  promptImage: { kind: 'flag', iso: 'FR' }, answer: 'FR',
  choices: [{ value: 'FR', label: 'France' }, { value: 'DE', label: 'Germany' },
    { value: 'IT', label: 'Italy' }, { value: 'ES', label: 'Spain' }] };

it('renders the flag prompt image and submits the chosen value once', () => {
  const onSubmit = vi.fn();
  render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
  expect(screen.getByRole('img', { name: /flag/i })).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: 'France' });
  fireEvent.click(btn);
  fireEvent.click(btn);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('FR');
});

it('keeps choice order stable across a verdict re-render', () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={null} />);
  const order1 = screen.getAllByRole('button').map((b) => b.textContent);
  rerender(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: true, expected: 'FR' }} />);
  const order2 = screen.getAllByRole('button').map((b) => b.textContent);
  expect(order2).toEqual(order1);
});

it('goes inert after a verdict', () => {
  const onSubmit = vi.fn();
  render(<AssetChoiceItem item={item} onSubmit={onSubmit} verdict={{ correct: false, expected: 'FR' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Germany' }));
  expect(onSubmit).not.toHaveBeenCalled();
});
