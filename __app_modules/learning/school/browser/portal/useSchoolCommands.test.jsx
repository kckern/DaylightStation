import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchoolSurfaceProvider } from './SchoolSurface.jsx';
import { useSchoolCommands, useSchoolCommandListener } from './useSchoolCommands.js';
import { useProgramKeys } from '../Programs/shared/useProgramKeys.js';
import { useCardLadderKeys } from '../Programs/Flashcards/CardLadder/useCardLadderKeys.js';

afterEach(cleanup);
function Commands({ action, ...options }) { useSchoolCommands({ a: action, enter: action }, options); return <button>Activate</button>; }
function Surface({ id, action }) { return <SchoolSurfaceProvider surfaceId={id}><Commands action={action} /><input aria-label={`${id} input`} /></SchoolSurfaceProvider>; }

describe('scoped School command dispatcher', () => {
  it('scopes specialized command listeners without swallowing keys they leave native', () => {
    const observed = [];
    function Specialized() { useSchoolCommandListener(event => { observed.push(event.key); if (event.key === 'Enter') event.preventDefault(); }, { allowInInput: true }); return <input aria-label="specialized" />; }
    render(<SchoolSurfaceProvider><Specialized /></SchoolSurfaceProvider>);
    const field = screen.getByRole('textbox');
    expect(fireEvent.keyDown(field, { key: 'x' })).toBe(true);
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false);
    fireEvent.keyDown(field, { key: 'a', isComposing: true });
    expect(observed).toEqual(['x', 'Enter']);
  });
  it('routes physical keys only to the activated surface', () => {
    const left = vi.fn(), right = vi.fn();
    render(<><Surface id="left" action={left} /><Surface id="right" action={right} /></>);
    const buttons = screen.getAllByRole('button');
    fireEvent.pointerDown(buttons[0]);
    fireEvent.keyDown(window, { key: 'ㅁ', code: 'KeyA' });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
    fireEvent.pointerDown(buttons[1]);
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);
  });

  it('ignores composition, editable targets, modifiers and prevented events', () => {
    const action = vi.fn();
    render(<Surface id="desk" action={action} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a', code: 'KeyA' });
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA', isComposing: true });
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA', keyCode: 229 });
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true });
    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', cancelable: true }); event.preventDefault();
    fireEvent(window, event);
    expect(action).not.toHaveBeenCalled();
  });

  it('gives modal command scopes priority and blocks background maps', () => {
    const background = vi.fn(), modal = vi.fn();
    function View({ open }) { return <SchoolSurfaceProvider><Commands action={background} />{open && <div role="dialog" aria-modal="true"><Commands action={modal} priority={100} /></div>}</SchoolSurfaceProvider>; }
    const view = render(<View open />);
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(modal).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    view.rerender(<View open={false} />);
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('respects disabled maps, explicit input allowance, and unregisters on exit', () => {
    const action = vi.fn();
    const view = render(<SchoolSurfaceProvider><Commands action={action} enabled={false} /><input aria-label="text" /></SchoolSurfaceProvider>);
    fireEvent.keyDown(window, { key: 'a' });
    expect(action).not.toHaveBeenCalled();
    view.rerender(<SchoolSurfaceProvider><Commands action={action} allowInInput /><input aria-label="text" /></SchoolSurfaceProvider>);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(action).toHaveBeenCalledTimes(1);
    view.unmount();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it.each([useProgramKeys, useCardLadderKeys])('retains Tab-to-hear in fields while guarding IME through existing key adapters', hook => {
    const hear = vi.fn(), answer = vi.fn();
    function Item() { hook({ tab: hear, a: answer }); return <input aria-label="answer" />; }
    render(<SchoolSurfaceProvider><Item /></SchoolSurfaceProvider>);
    const field = screen.getByRole('textbox');
    fireEvent.keyDown(field, { key: 'a', code: 'KeyA' });
    fireEvent.keyDown(field, { key: 'Tab', code: 'Tab', isComposing: true });
    expect(answer).not.toHaveBeenCalled();
    expect(hear).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Tab', code: 'Tab' });
    expect(hear).toHaveBeenCalledTimes(1);
  });
});

it('keeps unrelated native fields editable while the real typing activity is mounted', async () => {
  const { default: TypingTutor } = await import('../Typing/TypingTutor.jsx');
  render(<SchoolSurfaceProvider><TypingTutor /><input aria-label="Unrelated answer" /></SchoolSurfaceProvider>);
  const field = screen.getByRole('textbox', { name: 'Unrelated answer' });
  expect(fireEvent.keyDown(field, { key: 'a', code: 'KeyA' })).toBe(true);
  expect(document.querySelectorAll('.school-typing__char.is-correct')).toHaveLength(0);
});
