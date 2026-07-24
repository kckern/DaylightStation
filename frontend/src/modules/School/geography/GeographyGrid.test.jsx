import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GeographyGrid from './GeographyGrid.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { geoDecks: vi.fn() } }));
import { schoolApi } from '../schoolApi.js';

beforeEach(() => {
  schoolApi.geoDecks.mockResolvedValue({ ok: true, data: { decks: [
    { deckId: 'us-state-locations', bankId: 'geo:us-state-locations', title: 'US State Locations', itemType: 'region_click', available: true },
    { deckId: 'country-locations', bankId: 'geo:country-locations', title: 'Country Locations', itemType: 'region_click', available: false },
  ] } });
});

it('launches an available deck through onLaunch with drill mode + generic audience', async () => {
  const onLaunch = vi.fn();
  render(<GeographyGrid onLaunch={onLaunch} />);
  const tile = await screen.findByRole('button', { name: /US State Locations/i });
  fireEvent.click(tile);
  expect(onLaunch).toHaveBeenCalledWith(
    { id: 'geo:us-state-locations', title: 'US State Locations', audience: 'generic' }, 'drill');
});

it('renders unavailable decks greyed and non-interactive', async () => {
  const onLaunch = vi.fn();
  render(<GeographyGrid onLaunch={onLaunch} />);
  const coming = await screen.findByText('Country Locations');
  fireEvent.click(coming);
  expect(onLaunch).not.toHaveBeenCalled();
});
