import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ({}) }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ default: ({ open, onClose }) => open ? <div role="dialog" aria-label="Feedback"><button onClick={onClose}>Close feedback</button></div> : null }));
import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';
const props = () => ({ onClose: vi.fn(), visibility: {}, onToggleVisibility: vi.fn(), setBoost: vi.fn(), playerRef: { current: { getMediaElement: () => ({}) } }, videoVolume: { volume: 0.5, setVolume: vi.fn() }, activeSessionId: 'session', onEndSession: vi.fn() });
afterEach(() => vi.useRealTimers());
describe('Settings primary controls and interaction', () => {
  it('puts workout adjustments before visibility and collapses maintenance', () => {
    const { container } = render(<FitnessSidebarMenu {...props()} />);
    const volume = screen.getByRole('group', { name: 'Video volume' });
    const boost = screen.getByRole('group', { name: 'Video volume boost' });
    expect(volume.compareDocumentPosition(screen.getByRole('checkbox', { name: 'Sidebar Webcam' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boost).toBeTruthy();
    const details = screen.getByText('More').closest('details');
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByRole('button', { name: /Hard-reload/, hidden: true }))).toBe(true);
    expect(container.querySelectorAll('#settings-video-volume-label')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
  });
  it('visibility works with keyboard-compatible checkbox change', () => {
    const p = props(); render(<FitnessSidebarMenu {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sidebar Webcam' }));
    expect(p.onToggleVisibility).toHaveBeenCalledWith('sidebarCam');
  });
  it('volume and boost buttons support semantic activation', () => {
    const p = props(); render(<FitnessSidebarMenu {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '30% volume' }));
    expect(p.videoVolume.setVolume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Video boost 5 times' }));
    expect(p.setBoost).toHaveBeenCalledWith(5);
  });
  it('End Session retains explicit confirmation', () => {
    const p = props(); render(<FitnessSidebarMenu {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /End current/ }));
    expect(p.onEndSession).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'End this fitness session?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End Session' }));
    expect(p.onEndSession).toHaveBeenCalledTimes(1);
  });
  it('keeps open while a control retains focus, then dismisses after idle blur', () => {
    vi.useFakeTimers(); const p = props(); render(<FitnessSidebarMenu {...p} />);
    const button = screen.getByRole('button', { name: /End current/ });
    fireEvent.pointerDown(button); fireEvent.focus(button);
    act(() => vi.advanceTimersByTime(6000)); expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.blur(button, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(5001)); expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps the feedback dialog mounted beyond menu idle while it is open', () => {
    vi.useFakeTimers(); const p = props(); const { container } = render(<FitnessSidebarMenu {...p} />);
    fireEvent.pointerDown(container.firstChild);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback', hidden: true }));
    act(() => vi.advanceTimersByTime(6000));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close feedback' }));
    act(() => vi.advanceTimersByTime(5001));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('scroll activity renews the dismissal timer', () => {
    vi.useFakeTimers(); const p = props(); const { container } = render(<FitnessSidebarMenu {...p} />);
    fireEvent.pointerDown(container.firstChild);
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.scroll(container.querySelector('.sidebar-menu-content'));
    act(() => vi.advanceTimersByTime(4000)); expect(p.onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1001)); expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
