import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DrawingCanvas from './DrawingCanvas.jsx';

const context = {
  clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  set strokeStyle(_value) {}, set lineWidth(_value) {}, set lineCap(_value) {},
};

describe('DrawingCanvas controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  });

  it('applies mounted cursor configuration and checkpoints undo and clear', () => {
    const onCheckpoint = vi.fn();
    const initialStrokes = [{ ink: '#123456', width: 4, eraser: false, points: [{ x: 1, y: 2 }] }];
    render(<DrawingCanvas cursor="cell" initialStrokes={initialStrokes} onCheckpoint={onCheckpoint} />);
    expect(screen.getByLabelText('Drawing canvas').style.cursor).toBe('cell');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onCheckpoint).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onCheckpoint).toHaveBeenLastCalledWith([]);
  });

  it('exposes ink, eraser, and explicit Finish controls', () => {
    const onFinish = vi.fn();
    render(<DrawingCanvas onFinish={onFinish} />);
    expect(screen.getByRole('button', { name: 'Ink' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.getByRole('button', { name: 'Eraser' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
