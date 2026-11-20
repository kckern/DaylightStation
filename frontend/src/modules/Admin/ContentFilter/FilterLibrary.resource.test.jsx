import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../lib/api.mjs';
import { FilterLibrary } from './FilterLibrary.jsx';

vi.mock('../../../lib/api.mjs', async original => ({ ...await original(), DaylightAPI: vi.fn() }));

it('refreshes the reopened library when a make request from its prior visit commits', async () => {
  const library = 'api/v1/content-filter/library';
  const make = 'api/v1/content-filter/77/jobs';
  const job = Promise.withResolvers();
  let committed = false;
  DaylightAPI.mockImplementation((path, body, method) => {
    if (path === make && method === 'POST') return job.promise;
    if (path === library) return Promise.resolve({ films: [{
      ratingKey: '77', title: 'Annie', stage: 'parent', job: committed ? { status: 'queued' } : null,
    }] });
    throw Error('Unexpected path ' + path);
  });
  render(<MantineProvider env="test"><MemoryRouter initialEntries={['/admin/content/filter']}>
    <Link to="/admin/content/filter">Open library</Link>
    <Routes>
      <Route path="/admin/content/filter" element={<FilterLibrary />} />
      <Route path="/admin/content/filter/:id" element={<span>Film review</span>} />
    </Routes>
  </MemoryRouter></MantineProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Run again' }));
  expect(DaylightAPI).toHaveBeenCalledWith(make, { kind: 'make' }, 'POST');
  fireEvent.click(screen.getByRole('link', { name: /Annie/ }));
  await screen.findByText('Film review');
  fireEvent.click(screen.getByText('Open library'));
  await screen.findByRole('button', { name: 'Run again' });
  committed = true;
  await act(async () => job.resolve({ run: { id: 'r1' } }));
  expect(screen.getByText('Queued')).toBeInTheDocument();
  const libraryRead = [library, {}, 'GET', { signal: expect.any(AbortSignal) }];
  expect(DaylightAPI.mock.calls).toEqual([
    libraryRead,
    [make, { kind: 'make' }, 'POST'],
    libraryRead,
    libraryRead,
  ]);
});
