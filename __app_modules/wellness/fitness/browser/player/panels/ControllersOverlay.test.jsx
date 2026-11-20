import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const apiSpy = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiSpy(...a), DaylightMediaPath: (p) => p }));
const pairController = vi.fn();
vi.mock('../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ btInventory: [], controllerPairing: null, pairController, forgetController: vi.fn(), controllerForget: null }),
}));
// Capture the overlay's gamepad handler and whether it is active.
const gamepad = { active: null, onKey: null };
vi.mock('../../lib/useGamepadKeys.js', () => ({
  useGamepadKeys: (active, onKey) => { gamepad.active = active; gamepad.onKey = onKey; },
}));

import ControllersOverlay from './ControllersOverlay.jsx';

const library = (controllers = []) => ({ input: { controllers } });
const enabledButtons = () => screen.getByRole('dialog').querySelectorAll('button:not([disabled])');
const press = (key) => act(() => { gamepad.onKey(key); });

describe('ControllersOverlay', () => {
  beforeEach(() => {
    apiSpy.mockReset();
    pairController.mockReset();
    gamepad.active = null;
    gamepad.onKey = null;
  });

  it('renders nothing when closed', () => {
    render(<ControllersOverlay open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiSpy).not.toHaveBeenCalled();
    expect(gamepad.active).toBe(false);
  });

  it('is labelled by its heading and shows loading as a status', () => {
    apiSpy.mockReturnValueOnce(new Promise(() => {}));
    render(<ControllersOverlay open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Controllers' });
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).tagName).toBe('H3');
    expect(screen.getByRole('status').textContent).toMatch(/Loading/);
  });

  it('loads controllers from the emulator library and wires pairing to the context', async () => {
    apiSpy.mockResolvedValueOnce(library([{ id: 'x', label: 'Pad X', match: 'X' }]));
    render(<ControllersOverlay open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Controllers' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Pad X')).toBeTruthy());
    expect(apiSpy).toHaveBeenCalledWith('api/v1/emulator/library');
    fireEvent.click(screen.getByRole('button', { name: /Add a new device/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start search/ }));
    expect(pairController.mock.calls[0][0].mode).toBe('add');
  });

  it('still offers Add a new device when the library fails', async () => {
    apiSpy.mockRejectedValueOnce(new Error('boom'));
    render(<ControllersOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/boom/));
    expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy();
  });

  it('fetches the library again when reopened', async () => {
    apiSpy.mockResolvedValue(library());
    const { rerender } = render(<ControllersOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy());
    rerender(<ControllersOverlay open={false} onClose={vi.fn()} />);
    rerender(<ControllersOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(apiSpy).toHaveBeenCalledTimes(2));
  });

  it('Close and Escape call onClose', async () => {
    apiSpy.mockResolvedValueOnce(library());
    const onClose = vi.fn();
    render(<ControllersOverlay open onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close controllers' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe('focus and keys', () => {
    const openLoaded = async (onClose = vi.fn()) => {
      apiSpy.mockResolvedValueOnce(library());
      const utils = render(<ControllersOverlay open onClose={onClose} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy());
      return utils;
    };

    it('focuses Close on open, once: a re-render does not pull focus back', async () => {
      apiSpy.mockResolvedValueOnce(library());
      const { rerender } = render(<ControllersOverlay open onClose={vi.fn()} />);
      const close = screen.getByRole('button', { name: 'Close controllers' });
      expect(document.activeElement).toBe(close);
      await waitFor(() => expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy());
      screen.getByRole('button', { name: /Add a new device/ }).focus();
      rerender(<ControllersOverlay open onClose={vi.fn()} />);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Add a new device/ }));
    });

    it('gamepad: arrows wrap, A clicks the focused button, B closes', async () => {
      const onClose = vi.fn();
      await openLoaded(onClose);
      expect(gamepad.active).toBe(true);
      const buttons = enabledButtons();
      expect(document.activeElement).toBe(buttons[0]);
      press('ArrowUp');
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
      press('ArrowDown');
      expect(document.activeElement).toBe(buttons[0]);
      press('ArrowRight');
      expect(document.activeElement).toBe(buttons[1]);
      press('ArrowLeft');
      expect(document.activeElement).toBe(buttons[0]);
      press('Enter'); // Close is focused
      expect(onClose).toHaveBeenCalledTimes(1);
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('gamepad: A with nothing in the dialog focused lands focus first, then clicks', async () => {
      const onClose = vi.fn();
      await openLoaded(onClose);
      document.activeElement.blur();
      press('Enter');
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(enabledButtons()[0]);
      screen.getByRole('button', { name: /Add a new device/ }).focus();
      press('Enter');
      expect(screen.getByRole('button', { name: /Start search/ })).toBeTruthy();
    });

    it('keyboard: arrows and Escape from the focused Close button, without reaching the page behind', async () => {
      const onClose = vi.fn();
      const behind = vi.fn();
      document.addEventListener('keydown', behind);
      await openLoaded(onClose);
      const buttons = enabledButtons();
      fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(buttons[1]);
      fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(buttons[0]);
      fireEvent.keyDown(document.activeElement, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(behind).not.toHaveBeenCalled();
      document.removeEventListener('keydown', behind);
    });

    it('keyboard: Enter on a button is left to the native click (no double press)', async () => {
      await openLoaded();
      const close = screen.getByRole('button', { name: 'Close controllers' });
      const clicks = vi.fn();
      close.addEventListener('click', clicks);
      const notPrevented = fireEvent.keyDown(close, { key: 'Enter' });
      expect(notPrevented).toBe(true);
      expect(clicks).not.toHaveBeenCalled();
    });

    it('keyboard: Tab and Shift+Tab cycle inside the dialog', async () => {
      await openLoaded();
      const buttons = enabledButtons();
      buttons[buttons.length - 1].focus();
      fireEvent.keyDown(document.activeElement, { key: 'Tab' });
      expect(document.activeElement).toBe(buttons[0]);
      fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });
  });
});
