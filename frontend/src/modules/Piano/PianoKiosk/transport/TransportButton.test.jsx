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

  it('applies tile and rail layout modifiers and the danger emphasis', () => {
    const { rerender } = render(<TransportButton icon="close" label="Reboot" layout="tile" emphasis="danger" onPress={() => {}} />);
    const button = screen.getByRole('button', { name: 'Reboot' });
    expect(button).toHaveClass('piano-tbtn--tile');
    expect(button).toHaveClass('piano-tbtn--danger');
    rerender(<TransportButton icon="close" label="Pianos" layout="rail" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pianos' })).toHaveClass('piano-tbtn--rail');
  });
  it('renders illustration art in place of the icon when art is given', () => {
    const { rerender } = render(<TransportButton icon="piano" label="Grand" art="/x/upright-piano.svg" layout="tile" onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Grand' });
    const img = btn.querySelector('img.piano-tbtn__art');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/x/upright-piano.svg');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('draggable', 'false');
    expect(btn.querySelector('.piano-icon')).toBeNull();
    rerender(<TransportButton icon="piano" label="Grand" layout="tile" onPress={() => {}} />);
    expect(btn.querySelector('.piano-tbtn__art')).toBeNull();
    expect(btn.querySelector('.piano-icon')).not.toBeNull();
  });

  it('SCSS sizes the art per layout', () => {
    const scss = readFileSync(fileURLToPath(new URL('./Transport.scss', import.meta.url)), 'utf8');
    expect(scss).toMatch(/\.piano-tbtn__art\s*\{[^}]*object-fit:\s*contain/s);
    // Nested blocks sit inside the modifier, so reach past the first `}` non-greedily.
    expect(scss).toMatch(/\.piano-tbtn--tile\s*\{.*?\.piano-tbtn__art\s*\{[^}]*3\.2em/s);
    expect(scss).toMatch(/\.piano-tbtn--rail\s*\{.*?\.piano-tbtn__art\s*\{[^}]*\b2em/s);
  });
  it('falls back to the icon when the art fails to load', () => {
    render(<TransportButton icon="piano" label="Grand" art="/x/missing.svg" layout="tile" onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Grand' });
    const img = btn.querySelector('img.piano-tbtn__art');
    expect(img).toHaveAttribute('decoding', 'async');
    fireEvent.error(img);
    expect(btn.querySelector('.piano-tbtn__art')).toBeNull();
    expect(btn.querySelector('.piano-icon')).not.toBeNull();
  });
});
