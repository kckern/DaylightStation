import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { FoodIcon } from './FoodIcon.jsx';

describe('stable food artwork', () => {
  it('keeps the same slot and placeholder until image decoding finishes', async () => {
    const { container } = render(<FoodIcon icon="tortilla" />);
    const slot = container.firstChild, img = slot.querySelector('img');
    let finish;
    img.decode = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.load(img);
    expect(slot.dataset.state).toBe('loading');
    expect(slot.querySelector('circle')).toBeTruthy();
    await act(async () => finish());
    expect(container.firstChild).toBe(slot);
    expect(slot.dataset.state).toBe('ready');
    expect(slot.querySelector('circle')).toBeNull();
  });
  it('holds its slot on failure, and can load a newly assigned image', async () => {
    const { container, rerender } = render(<FoodIcon icon="bad" />);
    const slot = container.firstChild;
    fireEvent.error(slot.querySelector('img'));
    expect(slot.dataset.state).toBe('missing');
    expect(slot.querySelector('img')).toBeNull();
    rerender(<FoodIcon icon="tortilla" />);
    expect(container.firstChild).toBe(slot);
    expect(slot.dataset.state).toBe('loading');
    await act(async () => fireEvent.load(slot.querySelector('img')));
    expect(slot.dataset.state).toBe('ready');
  });
});
