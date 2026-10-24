import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
const ctx = { value: {} };
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ctx.value }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ default: ({ open, onClose }) => open ? <div role="dialog" aria-label="Feedback"><button onClick={onClose}>Close feedback</button></div> : null }));
import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';
const props = () => ({ onClose: vi.fn(), visibility: {}, onToggleVisibility: vi.fn(), setBoost: vi.fn(), playerRef: { current: { getMediaElement: () => ({}) } }, videoVolume: { volume: 0.5, setVolume: vi.fn() }, activeSessionId: 'session', onEndSession: vi.fn() });
afterEach(() => { vi.useRealTimers(); ctx.value = {}; });
describe('Settings primary controls and interaction', () => {
  it('stacks bottom-up by priority: End Session top, then tools, webcam, boost, treasure, volume, Close last', () => {
    const { container } = render(<FitnessSidebarMenu {...props()} />);
    const order = [
      screen.getByRole('button', { name: /End current/ }),
      screen.getByRole('button', { name: 'Send feedback' }),
      screen.getByRole('button', { name: /Hard-reload/ }),
      screen.getByRole('checkbox', { name: 'Sidebar Webcam' }),
      screen.getByRole('group', { name: 'Boost' }),
      screen.getByRole('checkbox', { name: 'Treasure Box' }),
      screen.getByRole('group', { name: 'Video volume' }),
      screen.getByRole('button', { name: 'Close settings' }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText('More')).toBeNull();
    expect(container.querySelector('.sidebar-menu-footer .close-btn')).toBeTruthy();
    expect(container.querySelectorAll('#settings-video-volume-label')).toHaveLength(1);
  });
  it('focuses Close on open without holding the menu open', () => {
    vi.useFakeTimers(); const p = props(); render(<FitnessSidebarMenu {...p} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close settings' }));
    act(() => vi.advanceTimersByTime(6000)); expect(p.onClose).not.toHaveBeenCalled();
  });
  it('Escape closes; with the End Session confirm open it dismisses only the confirm', () => {
    const p = props(); render(<FitnessSidebarMenu {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /End current/ }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'End this fitness session?' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'End this fitness session?' })).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close settings' }), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('a tap on the empty band above the stack closes; a tap on a control does not', () => {
    const p = props(); const { container } = render(<FitnessSidebarMenu {...p} />);
    fireEvent.click(container.querySelector('.settings-stack'));
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.sidebar-menu-content'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('Up/Down walk the stack in visual order; the volume strip is one stop', () => {
    render(<FitnessSidebarMenu {...props()} />);
    const close = screen.getByRole('button', { name: 'Close settings' });
    fireEvent.keyDown(close, { key: 'ArrowUp' });
    expect(document.activeElement.closest('.touch-volume')).toBeTruthy();
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Treasure Box' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(close);
  });
  it('Left/Right on the volume strip step the level', () => {
    const p = props(); render(<FitnessSidebarMenu {...p} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close settings' }), { key: 'ArrowUp' });
    const start = document.activeElement;
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(start);
    expect(p.videoVolume.setVolume).toHaveBeenCalledTimes(1);
  });
  it('shows the Music toggle only for a video that allows music, and it toggles the override', () => {
    const p = props();
    const { unmount } = render(<FitnessSidebarMenu {...p} />);
    expect(screen.queryByRole('checkbox', { name: 'Background music' })).toBeNull();
    unmount();
    const setMusicOverride = vi.fn();
    ctx.value = { musicAllowed: true, musicOverride: null, setMusicOverride };
    render(<FitnessSidebarMenu {...p} />);
    const music = screen.getByRole('checkbox', { name: 'Background music' });
    expect(music.checked).toBe(true);
    expect(music.compareDocumentPosition(screen.getByRole('group', { name: 'Video volume' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(music);
    expect(setMusicOverride).toHaveBeenCalledWith(false);
  });
  it('a silenced allowed overlay turns back on through the toggle', () => {
    const setMusicOverride = vi.fn();
    ctx.value = { musicAllowed: true, musicOverride: false, setMusicOverride };
    render(<FitnessSidebarMenu {...props()} />);
    const music = screen.getByRole('checkbox', { name: 'Background music' });
    expect(music.checked).toBe(false);
    fireEvent.click(music);
    expect(setMusicOverride).toHaveBeenCalledWith(null);
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
  it('a tap that focuses a control still dismisses after idle', () => {
    vi.useFakeTimers(); const p = props(); render(<FitnessSidebarMenu {...p} />);
    const toggle = screen.getByRole('checkbox', { name: 'Sidebar Webcam' });
    fireEvent.pointerDown(toggle); fireEvent.focus(toggle); fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(5001)); expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps open while a control retains keyboard focus, then dismisses after idle blur', () => {
    vi.useFakeTimers(); const p = props(); render(<FitnessSidebarMenu {...p} />);
    const button = screen.getByRole('button', { name: /End current/ });
    fireEvent.keyDown(button, { key: 'Tab' }); fireEvent.focus(button);
    act(() => vi.advanceTimersByTime(6000)); expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.blur(button, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(5001)); expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps the feedback dialog mounted beyond menu idle while it is open', () => {
    vi.useFakeTimers(); const p = props(); const { container } = render(<FitnessSidebarMenu {...p} />);
    fireEvent.pointerDown(container.firstChild);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
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
