import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerSelect } from './PlayerSelect.jsx';

const savers = [
  { userId: 'user_5', name: 'User_5', avatarSrc: '/s.png' },
  { userId: 'user_3', name: 'User_3', avatarSrc: '/m.png' },
];

describe('PlayerSelect', () => {
  it('hidden state shows only a re-open toggle', () => {
    const onReopen = vi.fn();
    render(<PlayerSelect visible={false} savers={savers} onReopen={onReopen} />);
    expect(screen.queryByText('Continue as…')).toBeNull();
    fireEvent.click(screen.getByLabelText('Players'));
    expect(onReopen).toHaveBeenCalled();
  });

  it('lists savers and fires onLoad / onClaim / onDismiss', () => {
    const onLoad = vi.fn(); const onClaim = vi.fn(); const onDismiss = vi.fn();
    render(<PlayerSelect visible savers={savers} onLoad={onLoad} onClaim={onClaim} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Continue as User_5'));
    expect(onLoad).toHaveBeenCalledWith('user_5');
    fireEvent.click(screen.getByText('Save my game'));
    expect(onClaim).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows a message and an empty-saver hint', () => {
    render(<PlayerSelect visible savers={[]} message="That's not User_5." onLoad={() => {}} onClaim={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("That's not User_5.")).toBeTruthy();
    expect(screen.getByText('No saved games yet')).toBeTruthy();
  });
});
