import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from '@/lib/ui/dismiss/DismissStackProvider.jsx';

const scanner = vi.hoisted(() => ({ args: null, cameraState: 'live', stop: vi.fn() }));
vi.mock("../../../../../frontend/src/lib/camera/useBarcodeScanner.js", () => ({
  useBarcodeScanner: (args) => { scanner.args = args; return { cameraState: scanner.cameraState, stop: scanner.stop }; },
}));
import { BarcodeCapture } from "./BarcodeCapture.jsx";

const wrap = (ui) => render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);

beforeEach(() => { scanner.args = null; scanner.cameraState = 'live'; scanner.stop.mockReset(); });

describe('BarcodeCapture over the shared scanner', () => {
  it('runs the camera only while open', () => {
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={vi.fn()} bucket="breakfast" />);
    expect(scanner.args.active).toBe(true);
  });

  it('hands a camera decode to onDecode with the bucket that opened the sheet', async () => {
    const onDecode = vi.fn(async () => {});
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="breakfast" />);
    await act(async () => { scanner.args.onDecode('012345678905'); });
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('012345678905', 'breakfast'));
    expect(scanner.stop).toHaveBeenCalled();
  });

  it('keeps the manual field as the fallback when the camera is denied', async () => {
    scanner.cameraState = 'denied';
    const onDecode = vi.fn(async () => {});
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="lunch" />);
    expect(screen.getByText(/Camera unavailable/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Manual UPC entry'), { target: { value: '012345678905' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('012345678905', 'lunch'));
  });

  it('shows a failed lookup and lets the number be tried again', async () => {
    const onDecode = vi.fn(async () => { throw new Error('Lookup failed. Try again.'); });
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="lunch" />);
    await act(async () => { scanner.args.onDecode('012345678905'); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Manual UPC entry').value).toBe('012345678905');
  });
});
