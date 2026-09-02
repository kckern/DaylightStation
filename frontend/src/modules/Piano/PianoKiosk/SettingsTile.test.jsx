import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsTile from './SettingsTile.jsx';

vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span aria-hidden /> }));

describe('SettingsTile', () => {
  it('renders a tile button and fires onPress', () => {
    const onPress = vi.fn();
    render(<SettingsTile icon="music" label="Play test note" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Play test note' });
    expect(button).toHaveClass('piano-tbtn--tile');
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows its message as a status under the tile, toned by state', () => {
    render(<SettingsTile icon="music" label="Play test note" onPress={() => {}} message="Piano not connected." tone="failed" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Piano not connected.');
    expect(status).toHaveClass('is-failed');
  });

  it('passes emphasis, on and disabled through', () => {
    render(<SettingsTile icon="system-reboot" label="Tap again to reboot tablet" emphasis="danger" on disabled onPress={() => {}} />);
    const button = screen.getByRole('button', { name: 'Tap again to reboot tablet' });
    expect(button).toHaveClass('piano-tbtn--danger');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toBeDisabled();
  });
});
