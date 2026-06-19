import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UnlockPrompt from './UnlockPrompt.jsx';

describe('UnlockPrompt', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <UnlockPrompt open={false} state="scanning" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the scanning prompt text and the lockLabel', () => {
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Place finger to unlock')).toBeTruthy();
    expect(screen.getByText('Dance Party')).toBeTruthy();
  });

  it('calls onCancel when the Cancel button is activated', () => {
    const onCancel = vi.fn();
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} />
    );
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the denied state', () => {
    const { container } = render(
      <UnlockPrompt open state="denied" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Not recognized')).toBeTruthy();
    // In the denied state the cancel button reads "Close"
    expect(screen.getByRole('button')).toHaveTextContent('Close');
    // The access-denied gif must resolve to the static IMAGE route (correct
    // image/* content-type), not the AV streamer (octet-stream + nosniff).
    const gif = container.querySelector('.unlock-prompt__denied-avatar');
    expect(gif).toBeTruthy();
    expect(gif.getAttribute('src')).toContain('api/v1/static/img/fitness/accessdenied.gif');
  });

  it('shows the unauthorized state: recognized person (avatar + name) but "Not allowed"', () => {
    const { container } = render(
      <UnlockPrompt
        open
        state="unauthorized"
        lockLabel="Fingerprint manager"
        unlockedUser={{ userId: 'soren', name: 'Soren', avatarSrc: '/static/img/users/soren' }}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.getByText('Soren')).toBeTruthy();
    // Recognized → shows their avatar (not the unknown-finger gif), blocked-styled.
    expect(container.querySelector('.unlock-prompt__avatar--blocked')).toBeTruthy();
    expect(container.querySelector('.unlock-prompt__avatar-img').getAttribute('src')).toBe('/static/img/users/soren');
  });

  it('shows the granted state with the recognized user (avatar + name)', () => {
    const { container } = render(
      <UnlockPrompt
        open
        state="granted"
        lockLabel="Dance Party"
        unlockedUser={{ userId: 'kckern', name: 'KC Kern', avatarSrc: '/static/img/users/kckern' }}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Access Granted')).toBeTruthy();
    expect(screen.getByText('KC Kern')).toBeTruthy();
    const avatar = container.querySelector('.unlock-prompt__avatar-img');
    expect(avatar).toBeTruthy();
    expect(avatar.getAttribute('src')).toBe('/static/img/users/kckern');
  });

  it('falls back to the generic avatar and omits the name when no user is resolved', () => {
    const { container } = render(
      <UnlockPrompt open state="granted" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Access Granted')).toBeTruthy();
    const avatar = container.querySelector('.unlock-prompt__avatar-img');
    expect(avatar.getAttribute('src')).toBe('/media/static/img/users/user');
    expect(container.querySelector('.unlock-prompt__user-name')).toBeNull();
  });

  describe('auto-dismiss timeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('calls onCancel after timeoutMs while scanning', () => {
      const onCancel = vi.fn();
      render(
        <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} timeoutMs={500} />
      );
      expect(onCancel).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(500); });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onCancel via timeout when state is granted', () => {
      const onCancel = vi.fn();
      render(
        <UnlockPrompt open state="granted" lockLabel="Dance Party" onCancel={onCancel} timeoutMs={500} />
      );
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
