import { describe, it, expect } from 'vitest';
import { PIANO_MODES } from './PianoMenu.jsx';

// Locks the home-menu tile contract: 10 tiles, the Producer tile present but
// disabled (greyed, non-clickable — reachable only via its route), and the
// Lessons mode surfaced under the "Training" label. Every tile carries an icon.
describe('PIANO_MODES (home menu tiles)', () => {
  it('has 10 tiles', () => {
    expect(PIANO_MODES).toHaveLength(10);
  });

  it('includes the expected mode ids in grid order', () => {
    expect(PIANO_MODES.map((m) => m.id)).toEqual([
      'videos', 'music', 'sheetmusic', 'studio', 'composer',
      'playalong', 'singalong', 'lessons', 'games', 'producer',
    ]);
  });

  it('labels the lessons mode "Training"', () => {
    const lessons = PIANO_MODES.find((m) => m.id === 'lessons');
    expect(lessons.label).toBe('Training');
  });

  it('marks Producer disabled and leaves every other tile enabled', () => {
    const disabled = PIANO_MODES.filter((m) => m.disabled).map((m) => m.id);
    expect(disabled).toEqual(['producer']);
  });

  it('uses the expected icons for the new/renamed tiles', () => {
    expect(PIANO_MODES.find((m) => m.id === 'singalong').icon).toBe('singalong');
    expect(PIANO_MODES.find((m) => m.id === 'composer').icon).toBe('quill');      // quill = compose
    expect(PIANO_MODES.find((m) => m.id === 'lessons').icon).toBe('metronome');   // Training
  });

  it('gives every tile an icon', () => {
    for (const m of PIANO_MODES) expect(m.icon).toBeTruthy();
  });
});
