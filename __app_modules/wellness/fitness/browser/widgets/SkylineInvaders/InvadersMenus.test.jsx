import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightImagePath: (path) => path, DaylightMediaPath: (path) => path, DaylightAPI: vi.fn() }));

import InvadersMenus, { InvadersTouchKeys } from './InvadersMenus.jsx';
import { invadersControls } from '../../lib/skylineInvaders/invadersPanel.js';
import { GESTURES, GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';

const rows = (container) => [...container.querySelectorAll('.skyline-invaders__keys')].map((row) => [...row.querySelectorAll('.skyline-invaders__key')].map((key) => key.querySelector('strong').textContent));

describe('InvadersTouchKeys', () => {
  it('draws the screen\'s four keys in one row, and Controls and Exit in a smaller row of their own', () => {
    const keys = invadersControls({ screen: 'waves', count: 2, wave: { name: 'First Light', status: 'open' }, mat: true, controlsName: 'Twist', canExit: true });
    const { container } = render(<InvadersTouchKeys keys={keys} onPress={() => {}} />);
    expect(rows(container)).toEqual([['Previous', 'Next', 'Change defender', 'Start'], ['Controls', 'Exit']]);
    expect(container.querySelectorAll('.skyline-invaders__keys--extra')).toHaveLength(1);
  });

  it('draws only the row that has keys, and reports a press by position', () => {
    const onPress = vi.fn();
    const exitOnly = render(<InvadersTouchKeys keys={[{ position: 6, label: 'Exit', hint: 'Leave the game', icon: '×' }]} onPress={onPress} />);
    expect(rows(exitOnly.container)).toEqual([['Exit']]);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onPress).toHaveBeenCalledWith(6);
    exitOnly.unmount();
    const none = render(<InvadersTouchKeys keys={[]} onPress={onPress} />);
    expect(none.container.querySelector('[data-testid="invaders-keys"]')).toBeNull();
  });

  it('draws the mat hints under a key, and keeps every other hint as its title', () => {
    const keys = invadersControls({ screen: 'controls', mat: true, cardName: 'Wipers' });
    render(<InvadersTouchKeys keys={keys} onPress={() => {}} />);
    expect(screen.getByRole('button', { name: /^Next/ }).querySelector('small').textContent).toBe('Or step on the mat');
    expect(screen.getByRole('button', { name: /^Use these/ }).querySelector('small').textContent).toBe('Or stomp the mat');
    expect(screen.getByRole('button', { name: 'Back' }).querySelector('small')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('title')).toBe('The one before');
  });
});

describe('InvadersMenus: the controls card', () => {
  const card = (over = {}) => ({ gesture: 'wings', index: 2, reached: 1, leftS: 12, leftPct: 60, note: null, ...over });

  it.each(GESTURES)('shows the demo, the name and the one line of how for %s', (gesture) => {
    const { container } = render(<InvadersMenus screen="controls" shooterName="Kid" card={card({ gesture, index: GESTURES.indexOf(gesture) })} />);
    expect(container.querySelector(`[data-demo="${gesture}"]`)).not.toBeNull();
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe(GESTURE_INFO[gesture].label);
    expect(screen.getByTestId('invaders-controls-how').textContent).toBe(GESTURE_INFO[gesture].how);
    expect(screen.getByTestId('invaders-controls-step').textContent).toBe(`Kid: pick your controls · ${GESTURES.indexOf(gesture) + 1} of 8`);
  });

  it('counts the targets lit, says when all three are, and shows the card clock', () => {
    const first = render(<InvadersMenus screen="controls" shooterName="" card={card()} />);
    expect(screen.getByTestId('invaders-controls-task').textContent).toBe('Light the targets: 1 of 3');
    expect(screen.getByRole('timer').firstChild.style.width).toBe('60%');
    expect(screen.getByTestId('invaders-controls-step').textContent).toBe('Pick your controls · 3 of 8');
    first.unmount();
    render(<InvadersMenus screen="controls" card={card({ reached: 3 })} />);
    expect(screen.getByTestId('invaders-controls-task').textContent).toBe('All three lit!');
  });

  it('says why the cannon is not following instead of the target count', () => {
    render(<InvadersMenus screen="controls" card={card({ note: 'Stand where the camera can see you.' })} />);
    expect(screen.getByTestId('invaders-controls-task').textContent).toBe('Stand where the camera can see you.');
  });
});
