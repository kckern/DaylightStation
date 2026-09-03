import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MacroFooter } from './MacroFooter.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const ITEMS = [
  { protein: 10, carbs: 20, fat: 5 },
  { protein: 5, carbs: 10, fat: 2 },
];

describe('MacroFooter — Task 4.3: one capture surface (QuickCaptureBar owns it now)', () => {
  it('renders the macro summary line', () => {
    r(<MacroFooter items={ITEMS} coachLine={null} onCoachTap={() => {}} />);
    expect(screen.getByText('P 15g · C 30g · F 7g')).toBeTruthy();
  });

  it('renders the coach one-liner when present, tappable', () => {
    r(<MacroFooter items={[]} coachLine="Great job today!" onCoachTap={() => {}} />);
    expect(screen.getByText(/Great job today!/)).toBeTruthy();
  });

  // THE PIN: no mic/camera/barcode controls anywhere in the footer — those
  // were retired to QuickCaptureBar so there is exactly ONE capture
  // surface, not two. Assert by accessible name rather than DOM structure,
  // so this fails if the icons come back under any wrapper.
  it('renders no capture controls (no mic, camera, or barcode buttons) — the one-surface pin', () => {
    r(<MacroFooter items={ITEMS} coachLine="Note" onCoachTap={() => {}} />);
    expect(screen.queryByRole('button', { name: /voice log/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /photo log/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /scan barcode/i })).toBeNull();
    // MacroFooter no longer accepts a children/actions slot at all.
    expect(document.querySelector('.health-footer__actions')).toBeFalsy();
  });
});
