import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../lib/api.mjs';
import { FilterLibrary } from './FilterLibrary.jsx';

vi.mock('../../../lib/api.mjs', async original => ({ ...await original(), DaylightAPI: vi.fn() }));

// Refining happens on the film's page, filtered parts only (owner, 2026-11-21): the library card's
// button opens the film and never starts a whole-film run.
it('the card button opens the film and queues nothing', async () => {
  const library = 'api/v1/content-filter/library';
  DaylightAPI.mockImplementation((path) => {
    if (path === library || path === `${library}?view=active`) return Promise.resolve({ films: [{ ratingKey: '77', title: 'Annie', stage: 'machine', job: null, reviewed: { n: 0, m: 12 } }] });
    throw Error('Unexpected path ' + path);
  });
  render(<MantineProvider env="test"><MemoryRouter initialEntries={['/admin/content/filter']}>
    <Routes>
      <Route path="/admin/content/filter" element={<FilterLibrary />} />
      <Route path="/admin/content/filter/:id" element={<span>Film review</span>} />
    </Routes>
  </MemoryRouter></MantineProvider>);
  fireEvent.click(await screen.findByRole('link', { name: 'Review' }));
  await screen.findByText('Film review');
  expect(DaylightAPI.mock.calls.every(([, , method]) => method === 'GET')).toBe(true);
});
