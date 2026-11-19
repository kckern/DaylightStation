import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { VoiceCapture } from './VoiceCapture.jsx';

const show = props => render(<MantineProvider><VoiceCapture onCapture={vi.fn()} {...props} /></MantineProvider>);
const denyMicrophone = () => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
afterEach(cleanup);

describe('VoiceCapture', () => {
  it('names a meal after its prefix', () => {
    show({ labelPrefix: 'Speak foods', mealLabel: 'Lunch' });
    expect(screen.getByRole('button', { name: 'Speak foods to Lunch' })).toBeTruthy();
  });
  it('uses a prefix as it is when there is no meal', () => {
    show({ labelPrefix: 'Speak foods or changes' });
    expect(screen.getByRole('button', { name: 'Speak foods or changes' })).toBeTruthy();
  });
  it('shows a problem beside the button by default', async () => {
    denyMicrophone();
    show({ mealLabel: 'Lunch' });
    fireEvent.click(screen.getByRole('button'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Microphone unavailable/);
  });
  it('hands a problem to onError instead, so the caller can place it', async () => {
    denyMicrophone();
    const onError = vi.fn();
    show({ labelPrefix: 'Speak', onError });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone unavailable/)));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
