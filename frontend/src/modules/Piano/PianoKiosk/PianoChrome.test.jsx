import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const midi = vi.hoisted(() => ({ connected: true, status: 'connected', connect: vi.fn() }));
const sound = vi.hoisted(() => ({ activeName: 'Grand Piano' }));
const longPressHandlers = vi.hoisted(() => ({ onPointerDown: vi.fn(), onPointerUp: vi.fn() }));
const longPressSpy = vi.hoisted(() => vi.fn());
const breadcrumbBar = vi.hoisted(() => ({ crumbs: [] }));

vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./PianoSoundContext.jsx', () => ({ usePianoSound: () => sound }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ basePath: '/piano' }) }));
vi.mock('./PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumbBar: () => breadcrumbBar }));
vi.mock('./icons/Icon.jsx', () => ({ default: ({ name }) => <span className="piano-icon" data-icon={name} /> }));
vi.mock('./SoundPanel.jsx', () => ({ default: ({ open }) => (open ? <div>SOUND-PANEL-OPEN</div> : null) }));
vi.mock('./OperatorDrawer.jsx', () => ({ default: ({ open }) => (open ? <div>OPERATOR-DRAWER-OPEN</div> : null) }));
vi.mock('./useLongPress.js', () => ({
  useLongPress: (onLongPress, opts) => {
    longPressSpy(onLongPress, opts);
    return longPressHandlers;
  },
}));

import { PianoChrome } from './PianoChrome.jsx';

const renderChrome = (props = {}) =>
  render(<MemoryRouter><PianoChrome {...props} /></MemoryRouter>);

describe('PianoChrome', () => {
  beforeEach(() => {
    longPressSpy.mockClear();
    breadcrumbBar.crumbs = [];
  });

  it('shows the active voice in the status chip', () => {
    renderChrome({ modeLabel: 'Courses', modeKey: 'videos' });
    expect(screen.getByText('Grand Piano')).toBeTruthy();
  });

  it('renders the mode breadcrumb crumb', () => {
    renderChrome({ modeLabel: 'Courses', modeKey: 'videos' });
    expect(screen.getByText('Courses')).toBeTruthy();
  });

  it('wires the chip to useLongPress: tap opens SoundPanel, long-press opens OperatorDrawer', () => {
    renderChrome();
    expect(longPressSpy).toHaveBeenCalled();
    const [onLongPress, opts] = longPressSpy.mock.calls[0];

    expect(screen.queryByText('SOUND-PANEL-OPEN')).toBeNull();
    act(() => opts.onTap());
    expect(screen.getByText('SOUND-PANEL-OPEN')).toBeTruthy();

    expect(screen.queryByText('OPERATOR-DRAWER-OPEN')).toBeNull();
    act(() => onLongPress());
    expect(screen.getByText('OPERATOR-DRAWER-OPEN')).toBeTruthy();
  });

  it('opens the Operator Drawer from the visible Settings gear (no long-press needed)', () => {
    renderChrome();
    expect(screen.queryByText('OPERATOR-DRAWER-OPEN')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    expect(screen.getByText('OPERATOR-DRAWER-OPEN')).toBeTruthy();
  });

  it('hides the inline Reconnect affordance when connected', () => {
    midi.connected = true;
    midi.status = 'connected';
    renderChrome();
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('shows an inline Reconnect affordance when disconnected, and it calls connect', () => {
    midi.connected = false;
    midi.status = 'no-input';
    midi.connect = vi.fn();
    renderChrome();
    const reconnectBtn = screen.getByText('Reconnect');
    expect(reconnectBtn).toBeTruthy();
    fireEvent.click(reconnectBtn);
    expect(midi.connect).toHaveBeenCalled();
  });

  it('renders crumb thumbnails and icons, and a clickable current crumb', () => {
    const spy = vi.fn();
    breadcrumbBar.crumbs = [
      { label: 'Super Mario Theme', image: '/img/mario.jpg' },
      { label: 'Listen', icon: 'mode-listen', onClick: spy },
    ];
    renderChrome();

    const img = document.querySelector('.piano-chrome__crumb-thumb');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/img/mario.jpg');

    const modeCrumb = screen.getByRole('button', { name: /listen/i });
    expect(modeCrumb.querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(modeCrumb);
    expect(spy).toHaveBeenCalled();
  });
});
