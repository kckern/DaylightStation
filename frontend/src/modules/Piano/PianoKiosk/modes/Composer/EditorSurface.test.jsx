import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ subscribe: () => () => {} }) }));
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ musicXml, children }) => (<div data-testid="renderer" data-xml-len={String(musicXml || '').length}>{children}</div>),
}));
import { EditorSurface } from './EditorSurface.jsx';
import { makeEmptyScore } from './model/index.js';

describe('EditorSurface', () => {
  it('mounts, renders the score xml, and shows the HUD', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.getByTestId('renderer')).toBeInTheDocument();
    expect(Number(screen.getByTestId('renderer').getAttribute('data-xml-len'))).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toBeInTheDocument(); // the HUD
  });
});
