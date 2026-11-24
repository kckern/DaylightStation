import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import OfficeMenu from './OfficeMenu.jsx';
import { menuChoices } from './officeMenu.js';

const held = (...notes) => new Map(notes.map((note) => [note, { velocity: 80, timestamp: 1 }]));
const drill = menuChoices({ inDrill: true, paused: true, actions: { next: { onSelect: () => {} } } });

describe('OfficeMenu', () => {
  it('draws every choice on its key, a choice that does nothing now as a plain empty key', () => {
    const { container } = render(<OfficeMenu open choices={drill} activeNotes={held()} onSelect={() => {}} />);
    const keys = [...container.querySelectorAll('.office-menu__key')];
    expect(keys.map((key) => key.dataset.choice)).toEqual(['resume', 'pieces', 'previous', 'next', 'retry', 'later', 'leave']);
    expect(keys.map((key) => Boolean(key.querySelector('.office-key-card')))).toEqual([true, true, false, true, false, false, true]);
    expect(keys[2].childElementCount).toBe(0);
    expect(keys[0].textContent).toContain('C4');
    expect(keys[0].textContent).toContain('Resume');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('a struck key picks its choice; an empty key and other notes do nothing', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<OfficeMenu open choices={drill} activeNotes={held()} onSelect={onSelect} />);
    rerender(<OfficeMenu open choices={drill} activeNotes={held(64)} onSelect={onSelect} />); // E4: Previous, not offered
    rerender(<OfficeMenu open choices={drill} activeNotes={held(36)} onSelect={onSelect} />); // C2
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<OfficeMenu open choices={drill} activeNotes={held()} onSelect={onSelect} />);
    rerender(<OfficeMenu open choices={drill} activeNotes={held(62)} onSelect={onSelect} />); // D4: Pieces
    expect(onSelect).toHaveBeenCalledWith('pieces');
  });

  it('shut, it draws nothing and listens to nothing', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<OfficeMenu open={false} choices={drill} activeNotes={held()} onSelect={onSelect} />);
    rerender(<OfficeMenu open={false} choices={drill} activeNotes={held(60)} onSelect={onSelect} />);
    expect(container.childElementCount).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
