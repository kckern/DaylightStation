import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerPanel } from './PlayerPanel.jsx';

const saver = { userId: 'user_5', name: 'User_5', avatarSrc: '/a' };

describe('PlayerPanel', () => {
  it('anonymous on the kiosk: Continue as, Save as me, Just play', () => {
    const onLoad = vi.fn(); const onClaim = vi.fn(); const onJustPlay = vi.fn();
    render(<PlayerPanel savers={[saver]} onLoad={onLoad} onClaim={onClaim} onJustPlay={onJustPlay} />);
    fireEvent.click(screen.getByLabelText('Continue as User_5'));
    fireEvent.click(screen.getByText('Save as me'));
    fireEvent.click(screen.getByText('Just play'));
    expect(onLoad).toHaveBeenCalledWith('user_5');
    expect(onClaim).toHaveBeenCalled();
    expect(onJustPlay).toHaveBeenCalled();
  });

  it('Just play is the gamepad default (autofocus) on and off the kiosk', () => {
    const { unmount } = render(<PlayerPanel savers={[saver]} onJustPlay={() => {}} />);
    expect(screen.getByText('Just play').hasAttribute('data-autofocus')).toBe(true);
    unmount();
    render(<PlayerPanel canIdentify={false} onJustPlay={() => {}} />);
    expect(screen.getByText('Just play').hasAttribute('data-autofocus')).toBe(true);
  });

  it('no Just play button when the host gives no handler', () => {
    render(<PlayerPanel savers={[]} />);
    expect(screen.queryByText('Just play')).toBeNull();
    expect(screen.getByText('Save as me')).toBeTruthy();
  });

  it('off the kiosk: no dead fingerprint buttons, says where saving works', () => {
    render(<PlayerPanel savers={[saver]} canIdentify={false} onJustPlay={() => {}} />);
    expect(screen.getByText('Saving works at the garage')).toBeTruthy();
    expect(screen.queryByText('Save as me')).toBeNull();
    expect(screen.queryByLabelText('Continue as User_5')).toBeNull();
    expect(screen.getByText('Just play')).toBeTruthy();
  });

  it('a loaded save shows no choice at all', () => {
    render(<PlayerPanel current={saver} savers={[saver]} onJustPlay={() => {}} />);
    expect(screen.getByText('Saving')).toBeTruthy();
    expect(screen.queryByText('Save as me')).toBeNull();
    expect(screen.queryByText('Just play')).toBeNull();
  });

  it('owner-locked shows the owner line and no choice', () => {
    render(<PlayerPanel current={saver} locked onJustPlay={() => {}} />);
    expect(screen.getByText("User_5's game · saving")).toBeTruthy();
    expect(screen.queryByText('Just play')).toBeNull();
  });

  it('while the save list is still loading, the Continue as row holds its place empty', () => {
    const { container } = render(<PlayerPanel savers={null} onJustPlay={() => {}} />);
    const row = container.querySelector('.emu-player-panel__savers');
    expect(row).toBeTruthy();
    expect(row.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('No saved games yet')).toBeNull();
    expect(screen.getByText('Save as me')).toBeTruthy();
  });

  it('nobody has a save yet: the row says so instead of vanishing', () => {
    const { container } = render(<PlayerPanel savers={[]} onJustPlay={() => {}} />);
    expect(container.querySelector('.emu-player-panel__savers')).toBeTruthy();
    expect(screen.getByText('No saved games yet')).toBeTruthy();
    expect(screen.queryByText('Continue as')).toBeNull();
  });

  it('loading and empty rows reserve a full avatar button (hidden), a full row does not', () => {
    const placeholder = (c) => c.querySelector('.emu-player-panel__savers .emu-player-panel__placeholder.emu-player-panel__saver');
    const a = render(<PlayerPanel savers={null} />);
    expect(placeholder(a.container)?.querySelector('.emu-player-panel__avatar')).toBeTruthy();
    expect(placeholder(a.container).getAttribute('aria-hidden')).toBe('true');
    a.unmount();
    const b = render(<PlayerPanel savers={[]} />);
    expect(placeholder(b.container)).toBeTruthy();
    b.unmount();
    const c = render(<PlayerPanel savers={[saver]} />);
    expect(placeholder(c.container)).toBeNull();
  });
});
