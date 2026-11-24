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

  it('uses a fullscreen, aspect-preserving preview and hides manual entry until requested', () => {
    const { container } = wrap(<BarcodeCapture open quickScan onClose={vi.fn()} onDecode={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Scan barcode' }).classList.contains('ds-sheet--fullscreen')).toBe(true);
    expect(container.querySelector('video').style.objectFit).toBe('cover');
    expect(screen.queryByRole('textbox', { name: 'Manual UPC entry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enter UPC' }));
    expect(screen.getByRole('textbox', { name: 'Manual UPC entry' })).toBeTruthy();
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

    it('logs at once, readies the camera for the next item and keeps an Undo until the owner leaves', async () => {
      const onDone = vi.fn();
      const onUndo = vi.fn(async () => true);
      const onConfirm = vi.fn(async () => ({ undoToken: 'u1' }));
      wrap(<BarcodeCapture open quickScan bucket="breakfast" meals={meals} onClose={vi.fn()} onDone={onDone}
        onDecode={known} onConfirm={onConfirm} onUndo={onUndo} />);
      await act(async () => { scanner.args.onDecode('012345678905'); });
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Logged Granola')).toBeTruthy();
      expect(screen.getByText(/170 kcal · Breakfast/)).toBeTruthy();
      expect(scanner.args.active).toBe(true);
      // Nothing closes the screen on a timer: it used to leave after 1.6 s.
      await new Promise(resolve => setTimeout(resolve, 1800));
      expect(onDone).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Undo logged item' }));
      await waitFor(() => expect(onUndo).toHaveBeenCalledWith('u1', expect.any(Function), expect.stringMatching(/^undo-/)));
      expect(await screen.findByText('Removed')).toBeTruthy();
    });

    it('keeps an unknown barcode on screen and offers to enter the food', async () => {
      const onUnknown = vi.fn();
      const onDone = vi.fn();
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDone={onDone}
        onDecode={async upc => ({ upc, product: null })} onUnknown={onUnknown} />);
      await act(async () => { scanner.args.onDecode('0042100005264'); });
      fireEvent.click(await screen.findByRole('button', { name: 'Enter food details' }));
      expect(onUnknown).toHaveBeenCalledWith('0042100005264', 'lunch');
      await new Promise(resolve => setTimeout(resolve, 1800));
      expect(onDone).not.toHaveBeenCalled();
    });

    it('brings the camera back by itself when the app is visible again', () => {
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDecode={vi.fn()} />);
      fireEvent(document, new Event('freeze'));
      expect(scanner.args.active).toBe(false);
      fireEvent(document, new Event('visibilitychange'));
      expect(scanner.args.active).toBe(true);
    });

    it('asks a refused camera again when the app comes back', () => {
      scanner.cameraState = 'denied';
      wrap(<BarcodeCapture open quickScan bucket="lunch" meals={meals} onClose={vi.fn()} onDecode={vi.fn()} />);
      const before = scanner.args.restartKey;
      fireEvent(document, new Event('visibilitychange'));
      expect(scanner.args.restartKey).toBeGreaterThan(before);
    });
  });
});
