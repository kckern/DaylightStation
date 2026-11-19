import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CropEditor from "./CropEditor.jsx";

describe('CropEditor', () => {
  it('"Don\'t crop" writes crop.enabled:false', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={null} onCrop={onCrop} />);
    fireEvent.click(screen.getByLabelText(/don.t crop/i));
    expect(onCrop).toHaveBeenCalledWith({ enabled: false });
  });

  it('"Reset to auto" clears the crop (null)', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={{ enabled: false }} onCrop={onCrop} />);
    fireEvent.click(screen.getByText(/reset to auto/i));
    expect(onCrop).toHaveBeenCalledWith(null);
  });

  it('keyboard-nudging a handle writes an adjusted band', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={{ enabled: true, top: 10, bottom: 10 }} onCrop={onCrop} />);
    const topHandle = screen.getByTestId('crop-handle-top');
    fireEvent.keyDown(topHandle, { key: 'ArrowDown' }); // +1% top margin
    expect(onCrop).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, top: 11, bottom: 10 }));
  });

  function pointer(target, type, id, y) {
    const event = new MouseEvent(type, { bubbles: true, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: id });
    fireEvent(target, event);
  }

  function handles() {
    const stage = screen.getByTestId('crop-editor');
    Object.defineProperty(stage, 'clientHeight', { configurable: true, value: 100 });
    const top = screen.getByRole('button', { name: 'top crop edge' });
    const bottom = screen.getByRole('button', { name: 'bottom crop edge' });
    for (const handle of [top, bottom]) {
      handle.setPointerCapture = vi.fn();
      handle.releasePointerCapture = vi.fn();
      handle.hasPointerCapture = () => true;
    }
    return { top, bottom };
  }

  it('previews only the first pointer and commits its final coordinate once', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={null} onCrop={onCrop} />);
    const { top, bottom } = handles();
    pointer(top, 'pointerdown', 1, 20);
    pointer(bottom, 'pointerdown', 2, 80);
    pointer(bottom, 'pointermove', 2, 65);
    pointer(bottom, 'pointerup', 2, 65);
    expect(onCrop).not.toHaveBeenCalled();
    pointer(top, 'pointermove', 1, 30);
    expect(screen.getByText('top 18% · bottom 8%')).toBeInTheDocument();
    expect(onCrop).not.toHaveBeenCalled();
    pointer(top, 'pointerup', 1, 34);
    pointer(top, 'pointerup', 1, 36);
    expect(onCrop.mock.calls).toEqual([[{ enabled: true, top: 22, bottom: 8 }]]);
  });

  it('drops cancelled, lost, replaced and unmounted gestures without saving', () => {
    const first = vi.fn();
    const next = vi.fn();
    const view = render(<CropEditor crop={null} onCrop={first} />);
    const { top } = handles();
    for (const type of ['pointercancel', 'lostpointercapture']) {
      pointer(top, 'pointerdown', 1, 20);
      pointer(top, 'pointermove', 1, 30);
      pointer(top, type, 1, 30);
      expect(screen.getByText('top 8% · bottom 8%')).toBeInTheDocument();
      pointer(top, 'pointerup', 1, 30);
    }
    pointer(top, 'pointerdown', 1, 20);
    view.rerender(<CropEditor crop={null} onCrop={next} />);
    pointer(top, 'pointerup', 1, 40);
    pointer(top, 'pointerdown', 3, 45);
    pointer(top, 'pointermove', 3, 50);
    view.unmount();
    pointer(window, 'pointermove', 3, 55);
    pointer(window, 'pointerup', 3, 55);
    expect(first).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(top.releasePointerCapture).toHaveBeenCalledWith(3);
  });

  it('horizontal axis edits left/right margins', () => {
    const onCrop = vi.fn();
    render(<CropEditor axis="horizontal" crop={{ enabled: true, left: 10, right: 10 }} onCrop={onCrop} />);
    const leftHandle = screen.getByTestId('crop-handle-left');
    fireEvent.keyDown(leftHandle, { key: 'ArrowRight' }); // +1% left margin
    expect(onCrop).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, left: 11, right: 10 }));
  });
});
