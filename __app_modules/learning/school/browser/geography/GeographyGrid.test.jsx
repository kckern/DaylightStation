import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GeographyGrid from "./GeographyGrid.jsx";

vi.mock("../schoolApi.js", () => ({ schoolApi: { geoDecks: vi.fn() } }));
import { schoolApi } from "../schoolApi.js";

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

it('shows a retryable failure instead of an empty geography grid', async () => {
  schoolApi.geoDecks.mockResolvedValueOnce({ ok: false, status: 503, data: null });
  render(<GeographyGrid onLaunch={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i);
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByRole('button', { name: /US State Locations/i })).toBeInTheDocument();
});
