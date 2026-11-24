import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => logger };
  return { default: () => logger, getLogger: () => logger };
});

import { LetterCoin } from './PassageCoin.jsx';
import PianoUserContext from '../../PianoUserContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import usePassageTomatoes from './usePassageTomatoes.js';

const tomatoOf = (container) => container.querySelector('.piano-letter-coin__tomato');

describe('LetterCoin', () => {
  it('a todo disc wears a tomato at its shoulder when tomatoes are on', () => {
    const { container } = render(<LetterCoin state="todo" letter="A" tomato />);
    const mark = tomatoOf(container);
    expect(mark).not.toBeNull();
    // The same shoulder, and the same 17-unit size, as the flower a passage under way wears.
    expect(mark.getAttribute('transform')).toBe('translate(20.5 -3) scale(0.1328)');
    expect(mark.querySelector('svg').getAttribute('viewBox')).toBe('0 0 128 128');
  });

  it('only a passage not started wears it: no tomato with tomatoes off, or on any other state', () => {
    expect(tomatoOf(render(<LetterCoin state="todo" letter="A" />).container)).toBeNull();
    for (const state of ['learning', 'silver', 'joined', 'gold', 'socket']) {
      expect(tomatoOf(render(<LetterCoin state={state} letter="B" tomato />).container)).toBeNull();
    }
  });
});

const Probe = ({ onValue }) => { onValue(usePassageTomatoes()); return null; };
const valueFor = ({ tomatoes, learner }) => {
  let seen;
  const users = [{ id: 'kid', schoolLearner: true }, { id: 'grownup', schoolLearner: false }];
  const config = tomatoes === undefined ? { sheetmusic: { learn: {} } } : { sheetmusic: { learn: { tomatoes } } };
  render(<ActivePianoProvider pianoId="p" basePath="/piano" config={config}>
    <PianoUserContext.Provider value={{ users, currentUser: learner, currentProfile: null, setCurrentUser: () => {} }}>
      <Probe onValue={(value) => { seen = value; }} />
    </PianoUserContext.Provider>
  </ActivePianoProvider>);
  return seen;
};

describe('usePassageTomatoes', () => {
  it('no tomato for a grown-up by default; a school learner gets them', () => {
    expect(valueFor({ learner: 'grownup' })).toBe(false);
    expect(valueFor({ learner: 'kid' })).toBe(true);
  });

  it('tomatoes: everyone / nobody', () => {
    expect(valueFor({ tomatoes: 'everyone', learner: 'grownup' })).toBe(true);
    expect(valueFor({ tomatoes: 'nobody', learner: 'kid' })).toBe(false);
    expect(valueFor({ tomatoes: 'learners', learner: 'grownup' })).toBe(false);
  });

  it('is off with no piano user context at all (a page outside the kiosk), except for everyone', () => {
    let seen;
    render(<Probe onValue={(value) => { seen = value; }} />);
    expect(seen).toBe(false);
    // ...unless the household asked for tomatoes for everyone (the office screen has no player provider).
    render(<ActivePianoProvider pianoId="p" basePath="/piano" config={{ sheetmusic: { learn: { tomatoes: 'everyone' } } }}>
      <Probe onValue={(value) => { seen = value; }} />
    </ActivePianoProvider>);
    expect(seen).toBe(true);
  });
});
