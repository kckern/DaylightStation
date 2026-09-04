import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { ObservationRow, ObservationsSection, observationLabel } from './ObservationRow.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

// Real envelope shape from GET /api/v1/health/nutrition/observations
const WEIGHT = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  kind: 'weight', value: 82, unit: 'g', scaleId: 'kitchen-1',
  at: '2026-09-02 18:04:12', date: '2026-09-02', status: 'open', pairedEntryUuid: null,
};
const DENSITY = { ...WEIGHT, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', kind: 'density', value: 3, unit: null };

describe('observationLabel', () => {
  it('describes a weight as the measurement it is', () => {
    expect(observationLabel(WEIGHT)).toBe('82 g on the kitchen scale at 18:04');
  });

  it('describes the scan kinds by what was scanned, never as a bare number', () => {
    expect(observationLabel(DENSITY)).toBe('Density level 3 scanned at 18:04');
    expect(observationLabel({ ...WEIGHT, kind: 'container', value: 'mug' }))
      .toBe('Container "mug" scanned at 18:04');
    expect(observationLabel({ ...WEIGHT, kind: 'upc', value: '049000028911' }))
      .toBe('Barcode 049000028911 scanned at 18:04');
  });

  it('degrades without a usable timestamp instead of printing junk', () => {
    expect(observationLabel({ kind: 'weight', value: 82, unit: 'g' })).toBe('82 g on the kitchen scale');
    expect(observationLabel({})).toBe('Scale signal');
  });
});

describe('ObservationRow — day list (dismiss)', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('renders the measurement, an Unmatched tag, and a dismiss button named after the row', () => {
    r(<ObservationRow observation={WEIGHT} onDismissed={() => {}} />);
    expect(screen.getByText('82 g on the kitchen scale at 18:04')).toBeTruthy();
    expect(screen.getByText('Unmatched')).toBeTruthy();
    // The accessible name carries the row's own description — a screenful of
    // buttons all called "Dismiss" is unusable without sight of the row.
    expect(screen.getByRole('button', { name: 'Dismiss 82 g on the kitchen scale at 18:04' })).toBeTruthy();
  });

  it('Dismiss POSTs to the dismiss endpoint and reports back', async () => {
    apiMock.mockResolvedValue({ observation: { ...WEIGHT, status: 'dismissed' } });
    const onDismissed = vi.fn();
    r(<ObservationRow observation={WEIGHT} onDismissed={onDismissed} />);

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss / }));

    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(WEIGHT));
    expect(apiMock).toHaveBeenCalledWith(
      `api/v1/health/nutrition/observations/${WEIGHT.id}/dismiss`, {}, 'POST',
    );
  });

  it('a failed dismiss shows the reason and does NOT claim success', async () => {
    apiMock.mockRejectedValue(new Error('network down'));
    const onDismissed = vi.fn();
    r(<ObservationRow observation={WEIGHT} onDismissed={onDismissed} />);

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss / }));

    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(onDismissed).not.toHaveBeenCalled();
  });
});

describe('ObservationRow — edit sheet (pair)', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('offers "pair to this entry" instead of dismiss, named after the row', () => {
    r(<ObservationRow observation={WEIGHT} onPair={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pair 82 g on the kitchen scale at 18:04 to this entry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
    expect(screen.queryByText('Unmatched')).toBeNull();
  });

  it('a measurement already attached to this entry reads Attached and cannot be re-paired', () => {
    const onPair = vi.fn();
    r(<ObservationRow observation={{ ...WEIGHT, status: 'consumed', pairedEntryUuid: 'e1' }}
      onPair={onPair} attached />);
    const btn = screen.getByRole('button', { name: /Pair .* to this entry/ });
    expect(btn.textContent).toContain('Attached');
    expect(btn).toBeDisabled();
  });

  it('hands the whole observation to onPair', () => {
    const onPair = vi.fn();
    r(<ObservationRow observation={WEIGHT} onPair={onPair} />);
    fireEvent.click(screen.getByRole('button', { name: /Pair .* to this entry/ }));
    expect(onPair).toHaveBeenCalledWith(WEIGHT);
  });
});

describe('ObservationsSection', () => {
  it('renders nothing at all when there are no unmatched signals', () => {
    r(<ObservationsSection observations={[]} onChanged={() => {}} />);
    expect(document.querySelector('.health-obs')).toBeFalsy();
  });

  it('renders one row per unmatched signal under a labelled region', () => {
    r(<ObservationsSection observations={[WEIGHT, DENSITY]} onChanged={() => {}} />);
    expect(screen.getByRole('region', { name: 'Unmatched scale measurements' })).toBeTruthy();
    expect(screen.getByText('ON THE SCALE')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Dismiss / })).toHaveLength(2);
  });
});
