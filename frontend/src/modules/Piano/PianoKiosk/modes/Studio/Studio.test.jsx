import { render, act, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaylightAPI } from '../../../../../lib/api.mjs';

// --- mocks -----------------------------------------------------------------
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({ takes: [] })) }));

vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: vi.fn(() => () => {}), connected: true }),
  usePianoMidiNotes: () => ({ isPlaying: false }),
}));
let mockUser = 'test-user';
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: mockUser }) }));

vi.mock('./useStudioRecorder.js', () => ({
  useStudioRecorder: () => ({ recording: false, start: vi.fn(), stop: vi.fn(() => ({ events: [], durationMs: 0 })) }),
}));

// Stub the heavy route children so the test focuses on the nav / record button.
vi.mock('./StudioPlay.jsx', () => ({ default: () => <div data-testid="play" /> }));
vi.mock('./StudioRecordings.jsx', () => ({ default: () => <div data-testid="recordings" /> }));
vi.mock('./StudioPlayback.jsx', () => ({ default: () => <div data-testid="playback" /> }));
vi.mock('./StudioReviewPrompt.jsx', () => ({ default: () => null }));
// Real RecordButton, but stub its icon.
vi.mock('../../../ui/icons/Icon.jsx', () => ({ default: ({ name }) => <span data-name={name} /> }));

import { Studio } from './Studio.jsx';

// Mounting Studio triggers loadTakes (mocked DaylightAPI → setTakes) asynchronously;
// wrap render in act so that state update settles inside act and doesn't warn.
async function renderAt(path) {
  let result;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/studio/*" element={<Studio />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return result;
}

beforeEach(() => {
  mockUser = 'test-user';
  DaylightAPI.mockClear();
});

describe('Studio tab-bar record button', () => {
  it('shows the Record button on the Play (index) route', async () => {
    const { container } = await renderAt('/studio');
    expect(container.querySelector('.piano-studio__tabs .piano-studio__record')).toBeTruthy();
  });

  it('shows the Record button on the Recordings list route', async () => {
    const { container } = await renderAt('/studio/recordings');
    expect(container.querySelector('.piano-studio__tabs .piano-studio__record')).toBeTruthy();
  });

  it('hides the Record button on the individual take-playback route', async () => {
    const { container } = await renderAt('/studio/recordings/take-123');
    expect(container.querySelector('.piano-studio__record')).toBeNull();
  });

  it('no longer renders the old NavLink rec-dot (the button carries recording state)', async () => {
    const { container } = await renderAt('/studio');
    expect(container.querySelector('.piano-studio__rec-dot')).toBeNull();
  });
});

describe('Studio as Guest (F1)', () => {
  it('hides the Record button and shows the pick-a-player note', async () => {
    mockUser = 'guest';
    await renderAt('/studio');
    expect(screen.queryByRole('button', { name: /Start recording/i })).toBeNull();
    expect(screen.getByText('Pick a player to record')).toBeTruthy();
  });

  it('does not fetch takes for guest (the backend 400s it)', async () => {
    mockUser = 'guest';
    await renderAt('/studio');
    const studioCalls = DaylightAPI.mock.calls.filter(([p]) => String(p).includes('/studio'));
    expect(studioCalls).toHaveLength(0);
  });
});
