import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ClickableAsset from './ClickableAsset.jsx';

describe('ClickableAsset', () => {
  it('calls onPick with the clicked region id', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value={null} verdict={null} expected={null} onPick={onPick} />);
    const nv = container.querySelector('[data-region-id="NV"]');
    expect(nv).toBeTruthy();
    fireEvent.click(nv);
    expect(onPick).toHaveBeenCalledWith('NV');
  });
  it('is inert once a verdict exists', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value="CA" verdict={{ correct: false, expected: 'NV' }} expected="NV" onPick={onPick} />);
    fireEvent.click(container.querySelector('[data-region-id="TX"]'));
    expect(onPick).not.toHaveBeenCalled();
  });
  it('marks expected and picked regions on a verdict', () => {
    const { container } = render(<ClickableAsset asset="us-states" value="CA" verdict={{ correct: false, expected: 'NV' }} expected="NV" onPick={() => {}} />);
    expect(container.querySelector('[data-region-id="NV"]').classList.contains('is-expected')).toBe(true);
    expect(container.querySelector('[data-region-id="CA"]').classList.contains('is-wrong')).toBe(true);
  });
  it('small-state callout puck is clickable', () => {
    const onPick = vi.fn();
    const { container } = render(<ClickableAsset asset="us-states" value={null} verdict={null} expected={null} onPick={onPick} />);
    fireEvent.click(container.querySelector('.school-clickable__callout[data-region-id="RI"]'));
    expect(onPick).toHaveBeenCalledWith('RI');
  });
});
