import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { FoodIcon, resetDecodedIcons } from './FoodIcon.jsx';

beforeEach(() => resetDecodedIcons());

const { reportArtworkFailure } = vi.hoisted(() => ({ reportArtworkFailure: vi.fn() }));
vi.mock('./artworkLog.js', () => ({ reportArtworkFailure }));

describe('stable food artwork', () => {
  it('keeps the same slot and placeholder until image decoding finishes', async () => {
    const { container } = render(<FoodIcon icon="tortilla" />);
    const slot = container.firstChild, img = slot.querySelector('img');
    let finish;
    img.decode = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.load(img);
    expect(slot.dataset.state).toBe('loading');
    expect(slot.querySelector('svg')).toBeTruthy();
    await act(async () => finish());
    expect(container.firstChild).toBe(slot);
    expect(slot.dataset.state).toBe('ready');
    expect(slot.querySelector('svg')).toBeNull();
  });
  it('holds its slot on failure, and can load a newly assigned image', async () => {
    const { container, rerender } = render(<FoodIcon icon="bad" />);
    const slot = container.firstChild;
    fireEvent.error(slot.querySelector('img'));
    expect(slot.dataset.state).toBe('failed');
    expect(slot.querySelector('img')).toBeNull();
    rerender(<FoodIcon icon="tortilla" />);
    expect(container.firstChild).toBe(slot);
    expect(slot.dataset.state).toBe('loading');
    await act(async () => fireEvent.load(slot.querySelector('img')));
    expect(slot.dataset.state).toBe('ready');
  });
  it('reports a failed icon load with its slug and url', () => {
    reportArtworkFailure.mockClear();
    const { container } = render(<FoodIcon icon="cheese" />);
    fireEvent.error(container.querySelector('img'));
    expect(reportArtworkFailure).toHaveBeenCalledWith('icon', 'cheese',
      { url: '/api/v1/health/nutrition/icons/cheese', reason: 'load' });
  });
});

describe('decoded icons across remounts', () => {
  it('an icon decoded once paints immediately when a new row mounts it', async () => {
    const first = render(<FoodIcon icon="carrot" />);
    const img = first.container.querySelector('img');
    img.decode = vi.fn(() => Promise.resolve());
    await act(async () => fireEvent.load(img));
    expect(first.container.firstChild.dataset.state).toBe('ready');
    first.unmount();
    const second = render(<FoodIcon icon="carrot" />);
    expect(second.container.firstChild.dataset.state).toBe('ready');
    expect(second.container.querySelector('svg')).toBeNull();
  });
});
