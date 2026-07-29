import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { render, fireEvent, screen } from '@testing-library/react';
import TransportButton from './TransportButton.jsx';

describe('TransportButton', () => {
  it('renders an icon-only button with its aria-label and fires onPress', () => {
    const onPress = vi.fn();
    render(<TransportButton icon="play" ariaLabel="Play" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn.querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a text label and emphasis/state classes', () => {
    render(<TransportButton label="Key +2" emphasis="primary" on onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Key +2' });
    expect(btn.className).toContain('piano-tbtn--primary');
    expect(btn.className).toContain('is-on');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('disabled blocks onPress', () => {
    const onPress = vi.fn();
    render(<TransportButton label="Tempo" disabled onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('labelFirst renders the label span before the icon (default is icon-first)', () => {
    render(<TransportButton icon="play" label="15" ariaLabel="Forward 15 seconds" labelFirst onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Forward 15 seconds' });
    expect(btn.firstElementChild.className).toContain('piano-tbtn__label');
  });

  it('SCSS enforces the 48px (3rem) kiosk floor', () => {
    // jsdom computes no layout, so assert the stylesheet source directly.
    const scss = readFileSync(fileURLToPath(new URL('./Transport.scss', import.meta.url)), 'utf8');
    expect(scss).toMatch(/\.piano-tbtn\s*\{[^}]*min-height:\s*3rem/s);
    expect(scss).toMatch(/\.piano-tbtn\s*\{[^}]*min-width:\s*3rem/s);
  });
});
