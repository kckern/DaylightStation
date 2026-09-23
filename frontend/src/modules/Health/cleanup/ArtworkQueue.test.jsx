import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ArtworkQueue, artworkQueuePath } from './ArtworkQueue.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
beforeEach(() => { resetApiResourceCache(); api.mockReset(); });
const mount = () => render(<MantineProvider><ArtworkQueue /></MantineProvider>);

describe('Artwork queue settings card', () => {
  it('lists open items with their attempts and last error, and recent fixes', async () => {
    api.mockImplementation(async path => {
      expect(path).toBe(artworkQueuePath);
      return { open: [{ key: 'food:oikos', kind: 'icon-missing', name: 'Oikos Pro Plain', attempts: 3,
        nextAttemptAt: '2026-09-23T18:00:00Z', lastError: 'takes only its exact icon' }],
      recentlyResolved: [{ key: 'food:shake', name: 'Strawberry Milkshake', resolvedAt: '2026-09-23T17:00:00Z', resolution: { via: 'name', icon: 'strawberry' } }] };
    });
    mount();
    await screen.findByText('Oikos Pro Plain');
    expect(screen.getByText('No icon')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('takes only its exact icon')).toBeTruthy();
    expect(screen.getByText(/Strawberry Milkshake · closest icon by name/)).toBeTruthy();
  });

  it('says so when nothing is waiting', async () => {
    api.mockResolvedValue({ open: [], recentlyResolved: [] });
    mount();
    await screen.findByText(/Nothing waiting/);
  });
});
