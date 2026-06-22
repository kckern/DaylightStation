import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CropEditor from './CropEditor.jsx';

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

  it('horizontal axis edits left/right margins', () => {
    const onCrop = vi.fn();
    render(<CropEditor axis="horizontal" crop={{ enabled: true, left: 10, right: 10 }} onCrop={onCrop} />);
    const leftHandle = screen.getByTestId('crop-handle-left');
    fireEvent.keyDown(leftHandle, { key: 'ArrowRight' }); // +1% left margin
    expect(onCrop).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, left: 11, right: 10 }));
  });
});
