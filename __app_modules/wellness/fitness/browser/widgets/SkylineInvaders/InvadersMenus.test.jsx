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

  it('draws the mat hint under a key, and keeps every other hint as its title', () => {
    const keys = invadersControls({ screen: 'waves', count: 2, wave: { name: 'First Light', status: 'open' }, mat: true });
    render(<InvadersTouchKeys keys={keys} onPress={() => {}} />);
    expect(screen.getByRole('button', { name: /^Start/ }).querySelector('small').textContent).toBe('Or stomp the mat');
    expect(screen.getByRole('button', { name: 'Previous' }).querySelector('small')).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous' }).getAttribute('title')).toBe('Pick a wave');
  });
});

describe('InvadersMenus: choose your controls', () => {
  it('offers every gesture and the gamepad as tiles, the defender\'s own marked, the cursor pressed', () => {
    const onMethod = vi.fn();
    const { container } = render(<InvadersMenus screen="method" shooterName="Kid" setup={{ cursor: 3, current: 'wings', camera: 'on' }} onMethod={onMethod} />);
    const tiles = [...container.querySelectorAll('.skyline-invaders__method')];
    expect(tiles.map((tile) => tile.dataset.method)).toEqual([...GESTURES, 'gamepad']);
    expect(tiles.map((tile) => tile.querySelector('strong').textContent)).toEqual([...GESTURES.map((g) => GESTURE_INFO[g].label), 'Gamepad']);
    expect(container.querySelector('[data-current]').dataset.method).toBe('wings');
    expect(container.querySelector('[data-current] .skyline-invaders__method-yours').textContent).toBe('Yours');
    expect(container.querySelector('[aria-pressed="true"]').dataset.method).toBe('wheel');
    for (const gesture of GESTURES) expect(container.querySelector(`[data-method="${gesture}"] [data-demo="${gesture}"]`)).not.toBeNull();
    fireEvent.click(screen.getByTestId('invaders-method-sprinkler'));
    expect(onMethod).toHaveBeenCalledWith('sprinkler');
    expect(screen.queryByTestId('invaders-setup-note')).toBeNull();
  });

  it('with the camera off only the gamepad can be chosen, and the screen says why', () => {
    render(<InvadersMenus screen="method" setup={{ cursor: 0, camera: 'off' }} />);
    expect(screen.getByTestId('invaders-method-wiper').disabled).toBe(true);
    expect(screen.getByTestId('invaders-method-gamepad').disabled).toBe(false);
    expect(screen.getByTestId('invaders-setup-note').textContent).toBe('The camera is off. Aim with the gamepad.');
  });
});

describe('InvadersMenus: the test sweep', () => {
  const test = (over = {}) => ({ gesture: 'wheel', step: 0, status: 'running', results: { left: null, right: null, fire: null }, ...over });
  const sweep = (setup) => render(<InvadersMenus screen="sweep" shooterName="Kid" setup={{ camera: 'on', mat: true, leftS: 9, timeoutS: 15, ...setup }} />);
  const states = () => ['left', 'right', 'fire'].map((id) => screen.getByTestId(`invaders-sweep-step-${id}`).getAttribute('data-state'));

  it('names the method, shows how it goes, and asks for the step in hand', () => {
    const { container } = sweep({ test: test() });
    expect(container.querySelector('[data-demo="wheel"]')).not.toBeNull();
    expect(screen.getByText('Kid · Test: Steering wheel')).toBeTruthy();
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Go left');
    expect(screen.getByTestId('invaders-sweep-how').textContent).toBe(GESTURE_INFO.wheel.how);
    expect(states()).toEqual(['now', 'todo', 'todo']);
    expect(screen.getByRole('timer').firstChild.style.width).toBe('60%');
  });

  it('asks for a stomp on the fire step, or fire on the keys with no mat', () => {
    const fire = test({ step: 2, results: { left: 900, right: 800, fire: null } });
    const first = sweep({ test: fire });
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Stomp to fire');
    expect(states()).toEqual(['done', 'done', 'now']);
    first.unmount();
    sweep({ test: fire, mat: false });
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Press fire');
    expect(screen.getByTestId('invaders-sweep-line').textContent).toBe('Press A or Space.');
  });

  it('says when a step was not detected, when the defender is out of view, and when it works', () => {
    const failed = sweep({ test: test({ step: 1, status: 'timeout', results: { left: 900, right: null, fire: null } }) });
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Not detected');
    expect(screen.getByTestId('invaders-sweep-line').textContent).toBe('Go right did not register. Try again, or choose another.');
    expect(states()).toEqual(['done', 'failed', 'todo']);
    expect(screen.queryByRole('timer')).toBeNull();
    failed.unmount();
    const lost = sweep({ test: test(), lost: true });
    expect(screen.getByTestId('invaders-sweep-line').textContent).toBe('Stand where the camera can see you.');
    lost.unmount();
    sweep({ test: test({ step: 2, status: 'passed', results: { left: 1, right: 1, fire: 1 } }), from: 'start' });
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('It works!');
    expect(states()).toEqual(['done', 'done', 'done']);
  });
});
