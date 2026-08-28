import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const askProps = vi.hoisted(() => ({ current: null }));
const api = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: api }));
vi.mock('../ask/AskSession.jsx', () => ({
  default: (props) => {
    askProps.current = props;
    return (
      <div data-testid="ask-session">
        <button type="button" onClick={() => props.onPassed({ score: 1 })}>pass</button>
        <button type="button" onClick={() => props.onFailed({ score: 0 })}>fail</button>
      </div>
    );
  },
}));

import { ActivePianoProvider } from './PianoConfig.jsx';
import PianoUserContext from './PianoUserContext.jsx';
import PianoChallengePlacement from './PianoChallengePlacement.jsx';

const config = {
  gameGate: {
    repertoire: [
      { id: 'L1', tier: 1, material: [{ kind: 'keys', notes: 2, arrangement: 'together' }] },
      { id: 'L2', tier: 2, material: [{ kind: 'keys', notes: 3, arrangement: 'together' }] },
    ],
  },
};

function renderPlacement(currentUser = 'alan') {
  return render(
    <MemoryRouter>
      <ActivePianoProvider pianoId="test" basePath="/piano" config={config}>
        <PianoUserContext.Provider value={{ currentUser }}>
          <PianoChallengePlacement />
        </PianoUserContext.Provider>
      </ActivePianoProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  askProps.current = null;
  api.mockResolvedValue({ startLevel: 'L2' });
});

describe('PianoChallengePlacement', () => {
  it('mounts AskSession with the hardest configured rung and saves a passed result through the narrow profile API', async () => {
    renderPlacement();
    expect(screen.getByTestId('ask-session')).toBeTruthy();
    expect(askProps.current.ask.id).toBe('L2');
    expect(askProps.current.materialSpec).toEqual(config.gameGate.repertoire[1].material[0]);
    expect(askProps.current.framing).toContain('PianoChallenge');

    fireEvent.click(screen.getByText('pass'));
    expect(await screen.findByText('You’re ready to begin')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/piano/users/alan/piano-challenge-profile', { startLevel: 'L2' }, 'PUT');
  });

  it('moves one rung down after a judged failure without doing presentation or grading itself', () => {
    renderPlacement();
    fireEvent.click(screen.getByText('fail'));
    expect(askProps.current.ask.id).toBe('L1');
    expect(api).not.toHaveBeenCalled();
  });

  it('does not mount a challenge for guest', () => {
    renderPlacement('guest');
    expect(screen.getByText('Choose your profile first')).toBeTruthy();
    expect(screen.queryByTestId('ask-session')).toBeNull();
  });
});
