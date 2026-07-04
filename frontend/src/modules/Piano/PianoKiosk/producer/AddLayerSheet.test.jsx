import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddLayerSheet } from './AddLayerSheet.jsx';

const base = () => ({ onPickRole: vi.fn(), onRecord: vi.fn(), onClose: vi.fn() });

describe('AddLayerSheet', () => {
  it('offers the four role cards and routes each to onPickRole', () => {
    const p = base();
    render(<AddLayerSheet {...p} />);
    for (const label of ['Chords', 'Bass', 'Drums', 'Melody']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    expect(p.onPickRole).toHaveBeenCalledWith('groove');
  });

  it('Record fires onRecord', () => {
    const p = base();
    render(<AddLayerSheet {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /record a new layer/i }));
    expect(p.onRecord).toHaveBeenCalledTimes(1);
  });

  it('build buttons are disabled until wired (Coming soon)', () => {
    render(<AddLayerSheet {...base()} />);
    expect(screen.getByRole('button', { name: /build a drum loop/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /build chords/i })).toBeDisabled();
  });

  it('build buttons fire their handlers when provided', () => {
    const onBuildDrums = vi.fn();
    const onBuildChords = vi.fn();
    render(<AddLayerSheet {...base()} onBuildDrums={onBuildDrums} onBuildChords={onBuildChords} />);
    fireEvent.click(screen.getByRole('button', { name: /build a drum loop/i }));
    fireEvent.click(screen.getByRole('button', { name: /build chords/i }));
    expect(onBuildDrums).toHaveBeenCalledTimes(1);
    expect(onBuildChords).toHaveBeenCalledTimes(1);
  });

  it('Cancel and the scrim close', () => {
    const p = base();
    const { rerender } = render(<AddLayerSheet {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    rerender(<AddLayerSheet {...p} />);
    fireEvent.click(screen.getByRole('presentation'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
