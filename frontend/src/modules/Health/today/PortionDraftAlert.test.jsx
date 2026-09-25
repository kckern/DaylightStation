import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PortionDraftAlert, portionAlertFor, dayHasEntry, draftHasAlert } from './PortionDraftAlert.jsx';

const eggs = { uuid: 'e1', name: 'Eggs' };
const errored = { row: eggs, status: 'error', error: 'Offline.', portion: { value: 2, unit: 'egg' } };

describe('portion draft alert', () => {
  it('belongs to the entry the draft edits, and only when there is something to say', () => {
    expect(portionAlertFor({ draft: errored }, eggs)).toBe(true);
    expect(portionAlertFor({ draft: errored }, { uuid: 'x' })).toBe(false);
    expect(portionAlertFor({ draft: { ...errored, status: 'editing' } }, eggs)).toBe(false);
    expect(draftHasAlert({ row: eggs, status: 'editing', validationError: 'Too big' })).toBe(true);
  });

  it('finds the entry inside a group, so a grouped row is not treated as gone', () => {
    const items = [{ uuid: 'g', kind: 'group', children: [eggs] }];
    expect(dayHasEntry(items, 'e1')).toBe(true);
    expect(dayHasEntry(items, 'nope')).toBe(false);
  });

  it('offers retry and a discard that reloads the day', () => {
    const control = { draft: errored, retry: vi.fn(), cancel: vi.fn(), reloadDay: vi.fn() };
    render(<MantineProvider><PortionDraftAlert control={control} /></MantineProvider>);
    expect(screen.getByRole('alert').textContent).toContain('Intended portion: 2 egg');
    fireEvent.click(screen.getByRole('button', { name: 'Retry same change' }));
    expect(control.retry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Discard draft/ }));
    expect(control.cancel).toHaveBeenCalled();
    expect(control.reloadDay).toHaveBeenCalled();
  });
});
