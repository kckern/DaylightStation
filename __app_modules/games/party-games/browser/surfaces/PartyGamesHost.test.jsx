vi.mock('../../../../../__capabilities/gaming/browser/platform/ui/fonts.js', () => ({}));
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PartyGamesHost from './PartyGamesHost.jsx';
import { JeopardyHost } from './hostPresenterRegistry.jsx';
import { fetchSession } from '../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import { sendJeopardyCommand } from '../experiences/jeopardy/jeopardyClient.js';
import { restartJeopardySession } from '../app/sessionClient.js';
vi.mock('@/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_, fn) => { socket.handler = fn; },
  useWebSocketStatus: () => ({ connected: socket.connected })
}));
vi.mock('../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js', () => ({
  fetchSession: vi.fn(),
  sendRuleCommand: vi.fn()
}));
vi.mock('../experiences/jeopardy/jeopardyClient.js', () => ({
  sendJeopardyCommand: vi.fn()
}));
vi.mock('../app/sessionClient.js', () => ({
  printHostPacket: vi.fn(),
  restartJeopardySession: vi.fn()
}));
const socket = vi.hoisted(() => ({ handler: null, connected: true }));
const clue = {
  clue: 'Regular question',
  answer: 'Regular answer',
  value: 100,
  scripture_reference: 'Genesis 1:1'
};
const set = {
  rounds: [{
    categories: [{
      name: 'Creation',
      clues: [clue]
    }]
  }],
  final: {
    clue: 'Final question',
    answer: 'Final answer',
    scripture_reference: 'Genesis 2:1'
  }
};
const teams = [{
  id: 'red',
  name: 'Red'
}];
const base = {
  roundIndex: 0,
  used: {},
  scores: {
    red: 0
  },
  set,
  attempted: [],
  finalWagers: {},
  finalJudged: {}
};
const session = (phase = 'round-intro') => ({
  header: {
    session_id: 'game:one',
    ruleset: {
      id: 'jeopardy'
    },
    experience: {
      id: 'jeopardy'
    },
    seats: teams
  },
  state: {
    ...base,
    phase
  }
});
const mount = () => render(<MemoryRouter initialEntries={['/party-games/host/game:one']}><Routes><Route path='/party-games/host/:sessionId' element={<PartyGamesHost />} /></Routes></MemoryRouter>);
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  fetchSession.mockResolvedValue(session());
});
it('rapid_double_tap_sends_once', async () => {
  sendJeopardyCommand.mockImplementation(() => new Promise(() => {}));
  mount();
  const button = await screen.findByRole('button', {
    name: 'Start game'
  });
  act(() => {
    button.click();
    button.click();
  });
  expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
});
it('failed_command_can_refresh_without_replaying', async () => {
  sendJeopardyCommand.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(session('board'));
  mount();
  fireEvent.click(await screen.findByRole('button', {
    name: 'Start game'
  }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Retry'
  }));
  await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(2));
  expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole('button', {
    name: 'Start game'
  }));
  await waitFor(() => expect(sendJeopardyCommand).toHaveBeenCalledTimes(2));
});
it('restart confirms, cancels and follows the fresh session route', async () => {
  restartJeopardySession.mockResolvedValue({
    ...session(),
    header: {
      ...session().header,
      session_id: 'game:new'
    }
  });
  mount();
  fireEvent.click(await screen.findByRole('button', {
    name: 'Restart game'
  }));
  expect(screen.getByText(/scores, questions, and wagers/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {
    name: 'Cancel'
  }));
  expect(restartJeopardySession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {
    name: 'Restart game'
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Confirm restart'
  }));
  await waitFor(() => expect(fetchSession).toHaveBeenCalledWith('game:new'));
  expect(restartJeopardySession).toHaveBeenCalledTimes(1);
});
it('host_shows_scripture_and_final_prompt only in allowed phases', () => {
  for (const phase of ['clue', 'final-category', 'final-wager', 'final-clue', 'final-judging']) {
    const view = render(<JeopardyHost state={{
      ...base,
      phase,
      active: {
        clue
      }
    }} set={set} teams={teams} scores={{}} send={vi.fn()} wagerDraft={100} setWagerDraft={vi.fn()} />);
    if (phase === 'clue') expect(screen.getByText('Scripture: Genesis 1:1')).toBeTruthy();
    if (['final-clue', 'final-judging'].includes(phase)) {
      expect(screen.getByText('Final question')).toBeTruthy();
      expect(screen.getByText('Scripture: Genesis 2:1')).toBeTruthy();
    } else expect(screen.queryByText('Final question')).toBeNull();
    view.unmount();
  }
});
it('used tiles stay disabled accessible cells', () => {
  render(<JeopardyHost state={{
    ...base,
    phase: 'board',
    used: {
      '0:0:0': true
    }
  }} set={set} teams={teams} scores={{}} send={vi.fn()} />);
  expect(screen.getByRole('button', {
    name: 'Creation $100 — used'
  }).disabled).toBe(true);
});
it('host_has_every_phase_action with exact command envelopes', () => {
  const cases = [['round-intro', {}, 'Start game', {
    type: 'START_ROUND'
  }], ['board', {}, 'Creation $100', {
    type: 'SELECT_AT',
    cat: 0,
    row: 0
  }], ['wager', {
    answeringTeamId: 'red'
  }, 'Lock wager', {
    type: 'SET_WAGER',
    amount: 100
  }], ['clue', {
    active: {
      clue
    }
  }, 'Reveal answer', {
    type: 'REVEAL'
  }], ['clue', {
    active: {
      clue
    }
  }, 'Red answers', {
    type: 'BUZZ',
    teamId: 'red'
  }], ['clue', {
    active: {
      clue
    },
    revealed: true
  }, 'Back to board', {
    type: 'RETURN_TO_BOARD'
  }], ['judging', {
    active: {
      clue
    }
  }, 'Correct ✓', {
    type: 'JUDGE',
    correct: true
  }], ['judging', {
    active: {
      clue
    }
  }, 'Wrong ✗', {
    type: 'JUDGE',
    correct: false
  }], ['final-category', {}, 'Continue', {
    type: 'START_ROUND'
  }], ['final-wager', {}, 'Lock wager', {
    type: 'SET_FINAL_WAGER',
    teamId: 'red',
    amount: 100
  }], ['final-clue', {}, 'Reveal answer', {
    type: 'REVEAL'
  }], ['final-judging', {}, 'Correct', {
    type: 'JUDGE_FINAL',
    teamId: 'red',
    correct: true
  }], ['final-judging', {}, 'Wrong', {
    type: 'JUDGE_FINAL',
    teamId: 'red',
    correct: false
  }]];
  for (const [phase, extra, label, command] of cases) {
    const send = vi.fn();
    const view = render(<JeopardyHost state={{
      ...base,
      phase,
      ...extra
    }} set={set} teams={teams} scores={{}} send={send} wagerDraft={100} setWagerDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', {
      name: label,
      exact: true
    }));
    expect(send).toHaveBeenCalledWith(command);
    view.unmount();
  }
});
it('tile and category styles fix block size and flex basis', async () => {
  const {
    readFileSync
  } = await import('node:fs');
  const styles = readFileSync(new URL('./PartyGamesHost.scss', import.meta.url), 'utf8');
  expect(styles).toMatch(/height: 3\.5rem;\s+flex: 0 0 3\.5rem;\s+box-sizing: border-box;\s+line-height:/);
  expect(styles).toMatch(/height: 3rem;\s+flex: 0 0 3rem;/);
});
it.each(['round-intro', 'board', 'clue', 'judging', 'wager', 'final-category', 'final-wager', 'final-clue', 'final-judging', 'done'])('restart utility is available during %s', async phase => {
  fetchSession.mockResolvedValue(session(phase));
  mount();
  expect(await screen.findByRole('button', {
    name: 'Restart game'
  })).toBeTruthy();
});
it('rapid restart confirmation sends once and does not replay on Retry', async () => {
  let rejectRestart;
  restartJeopardySession.mockImplementation(() => new Promise((_resolve, reject) => {
    rejectRestart = reject;
  }));
  mount();
  fireEvent.click(await screen.findByRole('button', {
    name: 'Restart game'
  }));
  const confirm = screen.getByRole('button', {
    name: 'Confirm restart'
  });
  act(() => {
    confirm.click();
    confirm.click();
  });
  expect(restartJeopardySession).toHaveBeenCalledTimes(1);
  await act(async () => rejectRestart(new Error('restart offline')));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Retry'
  }));
  await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(2));
  expect(restartJeopardySession).toHaveBeenCalledTimes(1);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identified = (id, phase = 'round-intro', revision = 0) => ({ ...session(phase), header: { ...session().header, session_id: id, revision } });
it.each(['success', 'failure'])('ignores old deferred refresh %s after restart navigation', async outcome => {
  const old = deferred();
  fetchSession.mockResolvedValueOnce(identified('game:one')).mockImplementationOnce(() => old.promise).mockResolvedValue(identified('game:new', 'board'));
  mount();
  await screen.findByRole('button', { name: 'Start game' });
  act(() => socket.handler({ kind: 'session-updated', sessionId: 'game:one' }));
  act(() => socket.handler({ kind: 'session-restarted', sessionId: 'game:one', replacementSessionId: 'game:new' }));
  await screen.findByRole('button', { name: /Creation \$100/ });
  await act(async () => { if (outcome === 'success') old.resolve(identified('game:one')); else old.reject(new Error('old offline')); });
  expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
  expect(screen.queryByText('Controller unavailable')).toBeNull();
  expect(screen.getByRole('button', { name: /Creation \$100/ })).toBeTruthy();
});
it('follows restart WebSocket before a rejected HTTP acknowledgement without undoing new route', async () => {
  const post = deferred();
  restartJeopardySession.mockImplementation(() => post.promise);
  fetchSession.mockImplementation(async id => identified(id, id === 'game:one' ? 'round-intro' : 'board'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Restart game' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
  act(() => socket.handler({ kind: 'session-restarted', sessionId: 'game:one', replacementSessionId: 'game:new' }));
  await screen.findByRole('button', { name: /Creation \$100/ });
  await act(async () => post.reject(new Error('response lost')));
  expect(screen.queryByText('Controller unavailable')).toBeNull();
  expect(screen.getByRole('button', { name: /Creation \$100/ })).toBeTruthy();
});
it('does not regress when an older revision refresh completes last', async () => {
  const old = deferred();
  fetchSession.mockResolvedValueOnce(identified('game:one')).mockImplementationOnce(() => old.promise).mockResolvedValueOnce(identified('game:one', 'board', 3));
  mount(); await screen.findByRole('button', { name: 'Start game' });
  act(() => socket.handler({ kind: 'session-updated', sessionId: 'game:one' }));
  act(() => socket.handler({ kind: 'session-updated', sessionId: 'game:one' }));
  await screen.findByRole('button', { name: /Creation \$100/ });
  await act(async () => old.resolve(identified('game:one', 'round-intro', 1)));
  expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
});

it('ignores an old refresh error after a newer command revision succeeds', async () => {
  const old = deferred();
  fetchSession.mockResolvedValueOnce(identified('game:one')).mockImplementationOnce(() => old.promise);
  sendJeopardyCommand.mockResolvedValue(identified('game:one', 'board', 2));
  mount();
  const start = await screen.findByRole('button', { name: 'Start game' });
  act(() => socket.handler({ kind: 'session-updated', sessionId: 'game:one' }));
  fireEvent.click(start);
  await screen.findByRole('button', { name: /Creation \$100/ });
  await act(async () => old.reject(new Error('old offline')));
  expect(screen.queryByText('Controller unavailable')).toBeNull();
});
