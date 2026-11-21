import { it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HealthOperationsProvider } from './HealthOperationsProvider.jsx';
import { createHealthOperations } from './healthOperations.js';
import { BarcodeOperationStatus } from './BarcodeOperationStatus.jsx';

it('reopens an uncertain barcode without a write and recovers the same entry after explicit retry', async () => {
  const userId = 'capture-status-owner';
  const path = 'api/v1/health/nutrition/barcode-commit';
  const id = 'same-operation';
  const date = '2026-11-19';
  const draft = { operationId: id, product: { name: 'private product' } };
  const store = createHealthOperations({ userId, durableStorage: localStorage });
  store.begin({ id, kind: 'barcode-commit', targetIds: [], date, bucket: 'evening', request: { path, method: 'POST', body: draft } });
  store.dispose();

  const ack = { committed: true, entryIds: ['saved-entry'], undoToken: 'saved-reversal', items: [{ uuid: 'saved-entry', date }] };
  const send = vi.fn(async () => ack);
  const onView = vi.fn();
  const onUndo = vi.fn(async () => true);
  const open = () => render(<MantineProvider><HealthOperationsProvider userId={userId} send={send}>
    <BarcodeOperationStatus open onClose={() => {}} onView={onView} onUndo={onUndo} />
  </HealthOperationsProvider></MantineProvider>);

  const reopened = open();
  expect(screen.getByText('Waiting to confirm delivery')).toBeTruthy();
  expect(screen.queryByText('private product')).toBeNull();
  expect(send).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
  expect(send.mock.calls.filter(([route]) => route === path)).toHaveLength(1);
  expect(send.mock.calls[0][1]).toEqual(draft);
  expect(screen.getByText('Delivered')).toBeTruthy();
  reopened.unmount();

  const withReceipt = open();
  fireEvent.click(screen.getByRole('button', { name: 'View in Health' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
  expect(onView).toHaveBeenCalledWith({ date, entryIds: ['saved-entry'] });
  expect(onUndo).toHaveBeenCalledWith('saved-reversal', expect.any(Function), 'undo-same-operation');
  expect(screen.getByText('Undone')).toBeTruthy();
  expect(send.mock.calls.filter(([route]) => route === path)).toHaveLength(1);
  withReceipt.unmount();
  localStorage.clear();
});
