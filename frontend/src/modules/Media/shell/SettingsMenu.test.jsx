import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsMenu } from './SettingsMenu.jsx';

const onResetSession = vi.fn();

describe('SettingsMenu', () => {
  beforeEach(() => { onResetSession.mockClear(); });

  test('renders the trigger button', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    expect(screen.getByTestId('settings-menu-trigger')).toBeInTheDocument();
  });

  test('opens the menu when trigger clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    expect(screen.getByTestId('settings-menu-panel')).toBeInTheDocument();
    expect(screen.getByTestId('settings-reset-session')).toBeInTheDocument();
  });

  test('calls onResetSession when the reset item is clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(screen.getByTestId('settings-reset-session'));
    expect(onResetSession).toHaveBeenCalledTimes(1);
  });

  test('closes the menu after an item is clicked', () => {
    render(<SettingsMenu onResetSession={onResetSession} />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(screen.getByTestId('settings-reset-session'));
    expect(screen.queryByTestId('settings-menu-panel')).not.toBeInTheDocument();
  });
});
