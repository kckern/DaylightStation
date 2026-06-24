import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MixControls from './MixControls.jsx';

const base = { pianoLevel: 0.8, mediaLevel: 0.5, onPiano: vi.fn(), onMedia: vi.fn() };

describe('MixControls', () => {
  it('renders piano and media percentages', () => {
    render(<MixControls {...base} />);
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });
  it('fires a negative delta on piano down and positive on piano up', () => {
    const onPiano = vi.fn();
    render(<MixControls {...base} onPiano={onPiano} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(onPiano).toHaveBeenCalledWith(-0.1);
    expect(onPiano).toHaveBeenCalledWith(0.1);
  });
  it('fires deltas on media down/up', () => {
    const onMedia = vi.fn();
    render(<MixControls {...base} onMedia={onMedia} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(onMedia).toHaveBeenCalledWith(-0.1);
    expect(onMedia).toHaveBeenCalledWith(0.1);
  });
});
