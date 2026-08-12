import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChordReadout from './ChordReadout.jsx';

describe('ChordReadout', () => {
  it('says it is listening when no keys are down', () => {
    render(<ChordReadout heldNotes={[]} chord={null} square={null} connected />);
    expect(screen.getByText(/listening/i)).toBeTruthy();
  });

  it('names the chord and the square it addresses', () => {
    render(<ChordReadout heldNotes={[60, 64, 67]} chord={{ symbol: 'C' }} square="e4" connected />);
    expect(screen.getByText('C')).toBeTruthy();
    expect(screen.getByText('e4')).toBeTruthy();
  });

  it('says the held set is not a square only once it has settled', () => {
    render(<ChordReadout heldNotes={[60, 61, 62]} chord={null} square={null} connected settling={false} />);
    expect(screen.getByText(/not a square/i)).toBeTruthy();
  });

  it('does not call a chord unrecognised while it is still settling', () => {
    // The cursor only names a square after the 140ms settle. Calling every valid
    // chord "not a square" for that window is the bug this component must not have.
    render(<ChordReadout heldNotes={[60, 64, 67]} chord={null} square={null} connected settling />);
    expect(screen.queryByText(/not a square/i)).toBeNull();
  });

  it('reports a disconnected piano rather than pretending to listen', () => {
    render(<ChordReadout heldNotes={[]} chord={null} square={null} connected={false} />);
    expect(screen.getByText(/not connected/i)).toBeTruthy();
  });
});
