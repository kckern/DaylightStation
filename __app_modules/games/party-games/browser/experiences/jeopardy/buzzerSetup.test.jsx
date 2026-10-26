import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Jeopardy from './Jeopardy.jsx';
import { JeopardyHost } from '../../surfaces/hostPresenterRegistry.jsx';
import { jeopardyRuleModule as rules } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { fetchSession } from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import { sendJeopardyCommand } from './jeopardyClient.js';
import { acquireGamepadBuzzerCapture, restoreGamepadRoleBindings } from '../../../../../../__capabilities/screen-host/browser/input.mjs';
const socket = vi.hoisted(() => ({ listeners: new Set() }));
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_, fn) => { socket.listeners.add(fn); } }));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js', async importOriginal => ({ ...await importOriginal(), fetchSession: vi.fn() }));
vi.mock('./jeopardyClient.js', () => ({ sendJeopardyCommand: vi.fn() }));
const teams = [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }];
const definition = { title: 'Ready quiz', open_book: true, rounds: [{ name: 'Round', mode: 'hosted', categories: [{ name: 'Kids', clues: [{ value: 100, clue: 'Question', answer: 'Secret', little_kids: true }] }] }] };
it('TV guides distinct assignment/test presses and phone uses the same authoritative readiness and reassign gate', async () => {
  let state = rules.createInitialState(definition, { seats: teams }); let revision = 0; let disconnectedOnce = false;
  const current = () => ({ header: { revision }, state });
  fetchSession.mockImplementation(async () => current());
  sendJeopardyCommand.mockImplementation(async (_, command) => {
    if (command.kind === 'disconnect' && !disconnectedOnce) { disconnectedOnce = true; throw Object.assign(new Error('Temporarily offline'), { transient: true }); }
    const result = rules.handleCommand(state, command, definition, { actorId: 'host', logicalTime: Date.now() });
    if (result.error) throw new Error(result.error.message);
    state = result.state; revision++; return current();
  });
  const services = { audio: { play: vi.fn(), stopChannel() {} }, buzzers: { arm() {}, disarm() {}, subscribe: () => () => {}, subscribeInput: fn => { const listener = e => fn(e.detail); window.addEventListener('gaming:interaction', listener); return () => window.removeEventListener('gaming:interaction', listener); }, capture: acquireGamepadBuzzerCapture, restore: restoreGamepadRoleBindings } };
  const view = render(<Jeopardy sessionId="fixture" seats={teams} gamingServices={services} />);
  await screen.findByText('Ready to play');
  expect(screen.getByRole('img', { name: /Scan/ })).toBeVisible();
  await waitFor(() => expect(state.buzzerSetup).toBeTruthy());
  const press = async (id, phase = 'press') => act(async () => window.dispatchEvent(new CustomEvent('gaming:interaction', { detail: { source: 'gamepad', controller_id: id, action: 'button.a', phase } })));
  await press('0:Pad');
  await waitFor(() => expect(state.buzzerSetup.teams.red.slot).toBe('gamepad:0:Pad'));
  expect(state.buzzerSetup.teams.red.tested).toBe(false);
  await press('1:Pad'); // while Red is highlighted, another pad cannot claim Blue
  expect(state.buzzerSetup.teams.blue.slot).toBe(null);
  await press('1:Pad', 'release');
  await press('0:Pad'); // held/repeated press cannot test
  expect(state.buzzerSetup.teams.red.tested).toBe(false);
  await press('0:Pad', 'release'); await press('0:Pad');
  await waitFor(() => expect(state.buzzerSetup.teams.red.tested).toBe(true));
  await press('0:Pad', 'release'); await press('0:Pad'); // cannot steal red's controller
  expect(state.buzzerSetup.teams.blue.slot).toBe(null);
  const cuesBeforeMash = services.audio.play.mock.calls.length;
  for (let i = 0; i < 50; i++) { await press('0:Pad', 'release'); await press('0:Pad'); }
  expect(services.audio.play.mock.calls).toHaveLength(cuesBeforeMash);
  await press('1:Pad'); await press('1:Pad', 'release'); await press('1:Pad');
  await waitFor(() => expect(state.buzzerSetup.teams.blue.tested).toBe(true));
  expect(screen.getAllByText(/Ready ✓/)).toHaveLength(2);
  await press('0:Pad', 'release');
  await act(async () => window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0, id: 'Pad' } })));
  expect(state.buzzerSetup.teams.red.connected).toBe(true); // first network failure must remain pending
  await act(async () => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(state.buzzerSetup.teams.red.connected).toBe(false));
  expect(state.buzzerSetup.teams.red.tested).toBe(false);
  await press('0:Pad');
  await waitFor(() => expect(state.buzzerSetup.teams.red.tested).toBe(true));
  view.unmount();
  const phone = render(<JeopardyHost state={state} set={state.set} teams={teams} scores={state.scores} send={async command => { await sendJeopardyCommand('fixture', command); phone.rerender(<JeopardyHost state={state} set={state.set} teams={teams} scores={state.scores} send={() => {}} />); }} />);
  expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reassign Red' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled());
});
it('phone disables start for a restored session without setup and exposes assigned ownership on the board', () => {
  let state = rules.createInitialState(definition, { seats: teams });
  const view = render(<JeopardyHost state={state} set={state.set} teams={teams} scores={state.scores} send={() => {}} />);
  expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
  state = { ...state, phase: 'board' };
  view.rerender(<JeopardyHost state={state} set={state.set} teams={teams} scores={state.scores} send={() => {}} />);
  expect(screen.getByRole('button', { name: /Kids.*Red/ })).toBeVisible();
});

it('blocks WS, number-key and gamepad buzzes through the shared arbiter for the entire tile acknowledgment', async () => {
  const { default: PartyGamesExperience } = await import('../../app/PartyGamesExperience.jsx');
  vi.useFakeTimers(); socket.listeners.clear();
  let state = { ...rules.createInitialState(definition, { seats: teams }), phase: 'board', buzzerSetup: { epoch: 'old', seenAt: Date.now(), teams: { red: { slot: 'gamepad:0:Pad', generation: 0, tested: true, connected: true }, blue: { slot: null, generation: 0, tested: false, connected: false } } } };
  // Use an ordinary competitive clue for the arming assertion.
  state.set.rounds[0].categories[0].clues[0].little_kids = false;
  let revision = 0;
  const current = () => ({ header: { revision }, state });
  fetchSession.mockImplementation(async () => current());
  sendJeopardyCommand.mockImplementation(async (_, command) => {
    const result = rules.handleCommand(state, command, definition, { actorId: 'host', logicalTime: Date.now() });
    if (result.error) throw new Error(result.error.message);
    state = result.state; revision++; return current();
  });
  const view = render(<PartyGamesExperience component={Jeopardy} sessionId="ack" seats={teams} buzzerBindings={{ 'gamepad:0:Pad': 'red', slot_1: 'red' }} config={{ defaults: { mute: true } }} />);
  await act(async () => {});
  expect(screen.getByTestId('jeopardy-board')).toBeVisible();
  state = rules.handleCommand(state, { type: 'SELECT_AT', cat: 0, row: 0 }, definition, { actorId: 'host' }).state; revision++;
  await act(async () => { for (const fn of [...socket.listeners]) fn({kind:'session-updated',sessionId:'ack'}); });
  const before = sendJeopardyCommand.mock.calls.length;
  const inputs = () => {
    for (const fn of [...socket.listeners]) fn({ kind: 'buzz', slot: 'gamepad:0:Pad' });
    fireEvent.keyDown(window, { key: '1' });
    window.dispatchEvent(new CustomEvent('gaming:interaction', { detail: { source: 'gamepad', controller_id: '0:Pad', phase: 'press', action: 'button.a' } }));
  };
  act(inputs); act(() => vi.advanceTimersByTime(499)); act(inputs);
  expect(screen.getByTestId('jeopardy-board')).toBeVisible();
  expect(sendJeopardyCommand.mock.calls.length).toBe(before);
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('clue-screen')).toBeVisible();
  await act(async () => { for (const fn of [...socket.listeners]) fn({ kind: 'buzz', slot: 'gamepad:0:Pad' }); });
  expect(state.answeringTeamId).toBe('red');
  expect(state.phase).toBe('judging');
  view.unmount(); vi.useRealTimers();
});

it('phone visibly expires stale TV readiness without receiving another snapshot', () => {
  vi.useFakeTimers();
  const state = rules.createInitialState(definition, { seats: teams });
  state.buzzerSetup = { seenAt: Date.now(), teams: { red: { slot: 'gamepad:0:Pad', tested: true, connected: true }, blue: { slot: 'gamepad:1:Pad', tested: true, connected: true } } };
  const view = render(<JeopardyHost state={state} set={state.set} teams={teams} scores={state.scores} send={() => {}} />);
  expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled();
  act(() => vi.advanceTimersByTime(16000));
  expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
  view.unmount(); vi.useRealTimers();
});
