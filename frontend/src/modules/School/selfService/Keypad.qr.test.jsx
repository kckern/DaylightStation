import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Keypad from './Keypad.jsx';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

afterEach(() => {
  delete navigator.mediaDevices;
});

describe('Keypad browser QR affordance', () => {
  it('keeps the camera explicitly off until the child asks to scan', () => {
    render(<Keypad onSubmit={vi.fn()} onScan={vi.fn()} />);

    expect(screen.getByRole('button', { name: /scan qr camera off/i })).toBeInTheDocument();
    const video = document.querySelector('video.school-selfservice__camera-source');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('aria-hidden', 'true');
  });

  it('replaces the digits with a focused scanner panel and offers the keypad when camera access is unavailable', async () => {
    delete navigator.mediaDevices;
    render(<Keypad onSubmit={vi.fn()} onScan={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /scan qr camera off/i }));

    expect(await screen.findByRole('heading', { name: 'Scan your QR code' })).toBeInTheDocument();
    expect(await screen.findByText(/camera is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use keypad' }));
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
  });
});
