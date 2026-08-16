import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ControllerIndicator, faultLabel, ariaLabelFor } from './ControllerIndicator.jsx';

describe('ControllerIndicator quiet states', () => {
  it('shows a dim pad dot and a keyboard hint when nothing is connected', () => {
    const { container, getByText } = render(
      <ControllerIndicator state="no-pad" connected={false} />,
    );
    expect(container.querySelector('.is-link').classList.contains('is-on')).toBe(false);
    expect(getByText('keyboard')).toBeTruthy(); // missing pad is informational, not an error
  });

  it('lights the link dot when connected, independent of activity', () => {
    const { container } = render(<ControllerIndicator state="ok" connected activity={false} />);
    expect(container.querySelector('.is-link').classList.contains('is-on')).toBe(true);
    expect(container.querySelector('.is-activity').classList.contains('is-on')).toBe(false);
  });

  it('lights the activity dot only when the core consumed input', () => {
    const { container } = render(<ControllerIndicator state="ok" connected activity />);
    expect(container.querySelectorAll('.is-on')).toHaveLength(2);
  });

  it('never intercepts touches in a quiet state', () => {
    const { container } = render(<ControllerIndicator state="ok" connected />);
    // pointer-events:auto is applied only by .is-fault
    expect(container.querySelector('.emulator-controller-ind').classList.contains('is-fault')).toBe(false);
  });
});

describe('ControllerIndicator fault state', () => {
  it('announces the fault in words rather than by an absent dot', () => {
    const { container, getByText } = render(
      <ControllerIndicator state="fault" fault="input-gap" connected />,
    );
    const root = container.querySelector('.emulator-controller-ind');
    expect(root.classList.contains('is-fault')).toBe(true);
    expect(root.getAttribute('data-fault')).toBe('input-gap');
    expect(getByText('Controller not reaching game')).toBeTruthy();
  });

  it('exposes a Fix action that fires on pointerDown (touch kiosk)', () => {
    const onFix = vi.fn();
    const { getByText } = render(
      <ControllerIndicator state="fault" fault="frozen" onFix={onFix} />,
    );
    fireEvent.pointerDown(getByText('Fix'));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  it('omits the Fix button when no handler is supplied', () => {
    const { queryByText } = render(<ControllerIndicator state="fault" fault="input-gap" />);
    expect(queryByText('Fix')).toBeNull();
  });

  it('is assertive to screen readers only when faulted', () => {
    const { container: faulted } = render(<ControllerIndicator state="fault" fault="input-gap" />);
    expect(faulted.querySelector('[role="status"]').getAttribute('aria-live')).toBe('assertive');
    const { container: fine } = render(<ControllerIndicator state="ok" connected />);
    expect(fine.querySelector('[role="status"]').getAttribute('aria-live')).toBe('off');
  });
});

describe('ControllerIndicator healing state', () => {
  it('shows a non-interactive reconnecting affordance', () => {
    const onFix = vi.fn();
    const { getByText, queryByText } = render(
      <ControllerIndicator state="healing" onFix={onFix} />,
    );
    expect(getByText('Reconnecting…')).toBeTruthy();
    expect(queryByText('Fix')).toBeNull(); // self-healing; nothing for a child to do
  });
});

describe('labels', () => {
  it('maps each fault kind to kid-readable text', () => {
    expect(faultLabel('input-gap')).toBe('Controller not reaching game');
    expect(faultLabel('frozen')).toBe('Game stopped responding');
    expect(faultLabel('contract-broken')).toBe('Emulator needs a restart');
    expect(faultLabel('nonsense')).toBe('Controller problem'); // never blank
  });

  it('describes every state for assistive tech', () => {
    expect(ariaLabelFor('fault', 'frozen')).toContain('Game stopped responding');
    expect(ariaLabelFor('no-pad')).toContain('keyboard');
    expect(ariaLabelFor('ok')).toBe('Controller connected');
  });
});
