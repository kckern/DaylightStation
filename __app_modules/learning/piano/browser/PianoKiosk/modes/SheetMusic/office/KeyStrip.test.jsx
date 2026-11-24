import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import KeyStrip from './KeyStrip.jsx';
import { visibleNotes } from './OfficeMidiProvider.jsx';

const held = (...notes) => new Map(notes.map((note) => [note, { velocity: 80, timestamp: 1 }]));
const actions = (onSelect) => ({ pieces: { onSelect }, retry: { onSelect }, later: { label: 'Skip rhythm', onSelect } });

describe('KeyStrip', () => {
  it('draws one labelled key face per action, with its note, and no buttons', () => {
    const { container } = render(<KeyStrip activeNotes={held()} actions={actions(() => {})} />);
    const faces = [...container.querySelectorAll('.office-key-strip__key')];
    expect(faces.map((face) => face.dataset.key)).toEqual(['pieces', 'previous', 'next', 'retry', 'later']);
    expect(faces.map((face) => face.querySelector('.office-key-strip__note').textContent)).toEqual(['C2', 'D2', 'E2', 'F2', 'G2']);
    expect(faces[4].textContent).toContain('Skip rhythm');
    expect(faces.map((face) => Boolean(face.dataset.enabled))).toEqual([true, false, false, true, true]);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('a struck key does its action; a dim key and other notes do nothing', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<KeyStrip activeNotes={held()} actions={actions(() => {})} onSelect={onSelect} />);
    rerender(<KeyStrip activeNotes={held(38)} actions={actions(() => {})} onSelect={onSelect} />); // D2: previous, nothing there
    rerender(<KeyStrip activeNotes={held(60)} actions={actions(() => {})} onSelect={onSelect} />); // C4: music
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<KeyStrip activeNotes={held()} actions={actions(() => {})} onSelect={onSelect} />);
    rerender(<KeyStrip activeNotes={held(41)} actions={actions(() => {})} onSelect={onSelect} />); // F2: try again
    expect(onSelect).toHaveBeenCalledWith('retry');
  });

  it('listens to no key while inactive (a take is under way)', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<KeyStrip activeNotes={held()} actions={actions(() => {})} active={false} onSelect={onSelect} />);
    rerender(<KeyStrip activeNotes={held(36)} actions={actions(() => {})} active={false} onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('.office-key-strip').dataset.active).toBeUndefined();
    expect(container.querySelectorAll('.office-key-strip__key[data-enabled]')).toHaveLength(0);
  });

  it('draws Listen only when the piano can sound notes', () => {
    const listen = { listen: { onSelect: () => {} } };
    expect(render(<KeyStrip activeNotes={held()} actions={listen} />).container.querySelector('[data-key="listen"]')).toBeNull();
    expect(render(<KeyStrip activeNotes={held()} actions={listen} canListen />).container.querySelector('[data-key="listen"]')).not.toBeNull();
  });
});

describe('visibleNotes (what Learn hears while the strip holds its keys)', () => {
  it('passes every note through when nothing is claimed', () => {
    const live = held(36, 60);
    expect(visibleNotes(live, null, new Set())).toBe(live);
  });

  it('hides claimed keys from the music', () => {
    expect([...visibleNotes(held(36, 60), new Set([36]), new Set()).keys()]).toEqual([60]);
  });

  it('keeps a key struck while claimed hidden until it comes up, even after the claim ends', () => {
    const sticky = new Set();
    visibleNotes(held(36), new Set([36]), sticky);
    // The take starts (claim released) with the finger still down: not a fresh note.
    expect([...visibleNotes(held(36, 60), null, sticky).keys()]).toEqual([60]);
    // Released and struck again: now it is music.
    visibleNotes(held(60), null, sticky);
    expect([...visibleNotes(held(36, 60), null, sticky).keys()]).toEqual([36, 60]);
  });
});
