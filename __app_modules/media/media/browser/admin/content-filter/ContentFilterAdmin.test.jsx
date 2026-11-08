import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const calls = [];
const scenesPayload = {
  title: 'Film', calibration: { situation: 'trusted', picture: 'trusted' },
  scenes: [{
    id: 'sc-va1', in: 100, out: 160, localIn: 110, tags: ['A man is shot.'], effect: 'blackout', profileEffect: 'blackout',
    level: { violence_blood_gore: { situation: 2, picture: 2 } }, card: { text: 'They get away.' }, ruling: null,
  }],
};
vi.mock('../../../../../../frontend/src/lib/hooks/useApiResource.js', () => ({
  useApiResource: (url) => ({ data: url.endsWith('/scenes') ? scenesPayload : { titles: [{ ratingKey: '77', title: 'Film', scenes: 1, hiding: 1, cardsApproved: 0, certification: 'machine' }] }, loading: false, error: null, reload: () => {} }),
}));
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); return { drafted: 0 }; },
}));

const { ContentFilterScenes } = await import('./ContentFilterAdmin.jsx');

const at = (path, el) => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/content/filter/:ratingKey" element={el} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>,
);

describe('ContentFilterAdmin', () => {
  beforeEach(() => { calls.length = 0; });

  it('shows a scene with its levels, draft card and a filtered play link at the copy time', () => {
    at('/admin/content/filter/77', <ContentFilterScenes />);
    expect(screen.getByText(/situation 2 · picture 2/)).toBeTruthy();
    expect(screen.getByText('They get away.')).toBeTruthy();
    const play = screen.getByRole('link', { name: 'Play scene' });
    expect(play.getAttribute('href')).toBe('/screen/living-room?play=plex%3A77&goto=107&filter=1');
  });

  it('approving the draft card writes the ruling', async () => {
    at('/admin/content/filter/77', <ContentFilterScenes />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve card' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: 'api/v1/content-filter/77/scenes/sc-va1', body: { card: { approve: true } }, method: 'PUT' });
  });
});
