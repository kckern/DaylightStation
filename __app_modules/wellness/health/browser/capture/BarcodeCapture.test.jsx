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

  it('quick scan is fullscreen, aspect-preserving, continuous, with no manual entry while the camera works', () => {
    const { container } = wrap(<BarcodeCapture open quickScan onClose={vi.fn()} onDecode={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Scan barcode' }).classList.contains('ds-sheet--fullscreen')).toBe(true);
    expect(container.querySelector('video').style.objectFit).toBe('cover');
    expect(scanner.args.continuous).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Manual UPC entry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enter UPC' })).toBeNull();
  });

  it('hands a camera decode to onDecode with the bucket that opened the sheet', async () => {
    const onDecode = vi.fn(async () => {});
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="breakfast" />);
    await act(async () => { scanner.args.onDecode('012345678905'); });
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('012345678905', 'breakfast', expect.any(AbortSignal)));
    expect(scanner.stop).toHaveBeenCalled();
  });

  it('lateDecodeCannotReplaceReview', async () => {
    const onDecode = vi.fn(async upc => ({ upc, product: { name: 'Granola', amount: 40, unit: 'g', calories: 170 } }));
    const sheet = open => <MantineProvider><DismissStackProvider><BarcodeCapture open={open} onClose={() => {}} onDecode={onDecode} /></DismissStackProvider></MantineProvider>;
    const { rerender } = render(sheet(true));
    const detected = scanner.args.onDecode;
    await act(async () => { detected('012345678905'); detected('042100005264'); });
    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Barcode read');
    expect(screen.getByText('Granola')).toBeTruthy();
    expect(scanner.args.active).toBe(false);
    rerender(sheet(false));
    rerender(sheet(true));
    await act(async () => { detected('042100005264'); });
    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Granola')).toBeNull();
  });

  it('releases the camera on freeze and only rearms through Scan another', () => {
    const onDecode = vi.fn();
    wrap(<BarcodeCapture open onClose={() => {}} onDecode={onDecode} />);
    const previousDecode = scanner.args.onDecode;
    fireEvent(document, new Event('freeze'));
    expect(scanner.stop).toHaveBeenCalled();
    expect(scanner.args.active).toBe(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(scanner.args.active).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Scan another' }));
    expect(scanner.args.active).toBe(true);
    previousDecode('012345678905');
    expect(onDecode).not.toHaveBeenCalled();
  });

  it('stops detection when the Android window is hidden', () => {
    wrap(<BarcodeCapture open onClose={() => {}} onDecode={vi.fn()} />);
    fireEvent(window, new Event('daylight:hidden'));
    expect(scanner.stop).toHaveBeenCalled();
    expect(scanner.args.active).toBe(false);
  });

  it('keeps the manual field as the fallback when the camera is denied', async () => {
    scanner.cameraState = 'denied';
    const onDecode = vi.fn(async () => {});
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="lunch" />);
    expect(screen.getByText(/Camera unavailable/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Manual UPC entry'), { target: { value: '012345678905' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('012345678905', 'lunch', expect.any(AbortSignal)));
  });

  it('shows a failed lookup and lets the number be tried again', async () => {
    const onDecode = vi.fn(async () => { throw new Error('Lookup failed. Try again.'); });
    wrap(<BarcodeCapture open onClose={vi.fn()} onDecode={onDecode} bucket="lunch" />);
    await act(async () => { scanner.args.onDecode('012345678905'); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Manual UPC entry').value).toBe('012345678905');
  });

  describe('quick scan (from the home-screen shortcut)', () => {
    const meals = [{ value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }];
    const known = async upc => ({ upc, product: { name: 'Granola', amount: 40, unit: 'g', calories: 170 } });

    it('logs each beep at once in a toast, never stops the camera, and keeps Undo in the toast', async () => {
      const onDone = vi.fn();
      const onUndo = vi.fn(async () => true);
      const onConfirm = vi.fn(async () => ({ undoToken: 'u1' }));
      wrap(<BarcodeCapture open quickScan bucket="breakfast" meals={meals} onClose={vi.fn()} onDone={onDone}
        onDecode={known} onConfirm={onConfirm} onUndo={onUndo} />);
      await act(async () => { scanner.args.onDecode('012345678905'); });
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Logged Granola · 170 kcal · Breakfast')).toBeTruthy();
      expect(scanner.args.active).toBe(true);
      expect(scanner.stop).not.toHaveBeenCalled();
      // No Next, Log item or Scan again: the next code just logs.
      for (const name of ['Log item', 'Scan next', 'Scan again', 'Enter UPC']) expect(screen.queryByRole('button', { name })).toBeNull();
      await act(async () => { scanner.args.onDecode('042100005264'); });
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
      expect(onDone).not.toHaveBeenCalled();
      fireEvent.click(screen.getAllByRole('button', { name: 'Undo logged item' })[0]);
      await waitFor(() => expect(onUndo).toHaveBeenCalledWith('u1', expect.any(Function), expect.stringMatching(/^undo-/)));
      expect(await screen.findByText('Removed Granola')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('logs the closest saved food when a misread code is unknown, and says so', async () => {
      const onConfirm = vi.fn(async () => ({ undoToken: 'u2' }));
      const pudding = { upc: '749826002729', product: { name: 'Banana Pudding', amount: 325, unit: 'ml', calories: 140 } };
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDone={vi.fn()}
        onDecode={async upc => ({ upc, product: null, suggestions: [pudding] })} onConfirm={onConfirm} onUndo={vi.fn()} />);
      await act(async () => { scanner.args.onDecode('749505002729'); });
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ upc: '749826002729', bucket: 'lunch' })));
      expect(await screen.findByText(/Logged Banana Pudding \(closest match\)/)).toBeTruthy();
    });

    it('reports an unknown code in a toast and keeps scanning; details are optional', async () => {
      const onUnknown = vi.fn();
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDone={vi.fn()}
        onDecode={async upc => ({ upc, product: null })} onUnknown={onUnknown} />);
      await act(async () => { scanner.args.onDecode('0042100005264'); });
      expect(await screen.findByText('Not found: 0042100005264')).toBeTruthy();
      expect(scanner.args.active).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Add details' }));
      expect(onUnknown).toHaveBeenCalledWith('0042100005264', 'lunch');
    });

    it('brings the camera back by itself when the app is visible again', () => {
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDecode={vi.fn()} />);
      fireEvent(document, new Event('freeze'));
      expect(scanner.args.active).toBe(false);
      fireEvent(document, new Event('visibilitychange'));
      expect(scanner.args.active).toBe(true);
    });

    it('asks a refused camera again when the app comes back, and offers typing the number meanwhile', () => {
      scanner.cameraState = 'denied';
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDecode={vi.fn()} />);
      expect(screen.getByRole('textbox', { name: 'Manual UPC entry' })).toBeTruthy();
      const before = scanner.args.restartKey;
      fireEvent(document, new Event('visibilitychange'));
      expect(scanner.args.restartKey).toBeGreaterThan(before);
    });
  });
});
