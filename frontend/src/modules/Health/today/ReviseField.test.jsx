import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
// The mic is exercised in VoiceCapture's own suite; here it stands in as a plain
// button so this file tests the revise contract, not getUserMedia.
vi.mock('../capture/VoiceCapture.jsx', () => ({
  VoiceCapture: ({ onCapture, busy }) => (
    <button type="button" disabled={busy} onClick={() => onCapture('data:audio/webm;base64,AAA')}>Speak</button>
  ),
}));

import { ReviseField } from './ReviseField.jsx';

const row = { uuid: 'r1', name: 'Rice', grams: 158, calories: 205 };
const proposal = {
  entryUuid: 'r1', basis: 'estimated', pinned: [], volume: { amount: 1, unit: 'cup' },
  current: { name: 'Rice', grams: 158, calories: 205 },
  proposal: { name: 'Cauliflower Rice', icon: 'cauliflower-rice', color: 'green', grams: 57, amount: 57, unit: 'g', calories: 28, protein: 2.2 },
};

const mount = (props = {}) => render(<MantineProvider><ReviseField row={row} onApply={() => {}} {...props} /></MantineProvider>);
const type = (value) => fireEvent.change(screen.getByLabelText('Say what this really was'), { target: { value } });

describe('ReviseField', () => {
  beforeEach(() => apiMock.mockReset());

  it('re-derives and applies in one gesture, without a second confirming tap', async () => {
    apiMock.mockResolvedValue(proposal);
    const onApply = vi.fn();
    mount({ onApply });
    type('cauliflower rice');
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrilist/r1/revise', { instruction: 'cauliflower rice' }, 'POST');
    // The whole proposal lands: identity AND everything downstream of it.
    expect(onApply.mock.calls[0][0]).toMatchObject({ name: 'Cauliflower Rice', icon: 'cauliflower-rice', grams: 57, calories: 28 });
  });

  it('reports what it HEARD, so a mis-transcription is visible rather than silent', async () => {
    apiMock.mockResolvedValue({ ...proposal, instruction: 'cauliflower rice' });
    mount({ onApply: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrilist/r1/revise', { audio: 'data:audio/webm;base64,AAA' }, 'POST');
    const status = screen.getByRole('status').textContent;
    expect(status).toContain('cauliflower rice');
    expect(status).toContain('Cauliflower Rice');
    expect(status).toContain('57 g');
    expect(status).toContain('same 1 cup');
  });

  it('names the pins BEFORE anything is said, and holds them back on apply', async () => {
    apiMock.mockResolvedValue({ ...proposal, pinned: ['calories', 'grams'] });
    const onApply = vi.fn();
    render(<MantineProvider><ReviseField row={{ ...row, manualFields: ['calories', 'grams'] }} onApply={onApply} /></MantineProvider>);
    // Visible with no round trip — a pin found only after a correction did
    // nothing is the dead end this is here to prevent.
    expect(screen.getByText(/You set calories, grams by hand/)).toBeTruthy();
    type('cauliflower rice');
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const changes = onApply.mock.calls[0][0];
    expect(changes.name).toBe('Cauliflower Rice');
    expect(changes).not.toHaveProperty('calories');
    expect(changes).not.toHaveProperty('grams');
    expect(screen.getByRole('status').textContent).toContain('kept your calories, grams');
  });

  it('releasing the pins lets the correction move them', async () => {
    apiMock.mockResolvedValue({ ...proposal, pinned: ['calories', 'grams'] });
    const onApply = vi.fn();
    render(<MantineProvider><ReviseField row={{ ...row, manualFields: ['calories', 'grams'] }} onApply={onApply} /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Release all' }));
    type('cauliflower rice');
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0]).toMatchObject({ calories: 28, grams: 57 });
  });

  it('explains a correction that every pin would have blocked, instead of no-opping', async () => {
    apiMock.mockResolvedValue({ ...proposal, pinned: ['name', 'icon', 'color', 'grams', 'amount', 'unit', 'calories', 'protein'] });
    const onApply = vi.fn();
    render(<MantineProvider><ReviseField row={{ ...row, manualFields: ['name'] }} onApply={onApply} /></MantineProvider>);
    type('cauliflower rice');
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/pinned/i);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('surfaces a failure and keeps the words so they need not be said twice', async () => {
    apiMock.mockImplementationOnce(async () => { throw new Error('Could not hear that correction'); });
    mount({ onApply: vi.fn() });
    type('cauliflower rice');
    fireEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not hear that correction'));
    expect(screen.getByLabelText('Say what this really was').value).toBe('cauliflower rice');
  });

  it('says nothing on an empty field rather than spending a model call', () => {
    mount({ onApply: vi.fn() });
    expect(screen.getByRole('button', { name: 'Rework' }).disabled).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();
  });
});
