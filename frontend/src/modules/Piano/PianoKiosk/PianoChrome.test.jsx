import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const connection = vi.hoisted(() => ({ health: { state: 'ready', copy: 'ready' } }));
const longPressSpy = vi.hoisted(() => vi.fn());
const breadcrumbBar = vi.hoisted(() => ({ crumbs: [] }));

vi.mock('./PianoConnectionContext.jsx', () => ({
  usePianoConnection: () => connection,
}));
vi.mock('./PianoSoundContext.jsx', () => ({ usePianoSound: () => ({ activeName: 'Grand Piano' }) }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ basePath: '/piano' }) }));
vi.mock('./PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumbBar: () => breadcrumbBar }));
vi.mock('../ui/icons/Icon.jsx', () => ({ default: ({ name }) => <span data-icon={name} /> }));
vi.mock('./PianoUserChip.jsx', () => ({ default: () => <button type="button">Player</button> }));
vi.mock('./PianoLinkBanner.jsx', () => ({ default: () => null }));
vi.mock('./SoundPanel.jsx', () => ({ default: ({ open }) => open ? <div>Sound sheet</div> : null }));
vi.mock('./OperatorDrawer.jsx', () => ({ default: ({ open }) => open ? <div>Piano maintenance</div> : null }));
vi.mock('./useLongPress.js', () => ({
  useLongPress: (onLongPress, options) => {
    longPressSpy(onLongPress, options);
    return { onPointerDown: vi.fn(), onPointerUp: vi.fn() };
  },
}));

import { PianoChrome } from './PianoChrome.jsx';

const renderChrome = (props = {}) => render(<MemoryRouter><PianoChrome {...props} /></MemoryRouter>);

describe('PianoChrome', () => {
  beforeEach(() => { longPressSpy.mockClear(); breadcrumbBar.crumbs = []; Object.assign(connection.health, { state: 'ready', copy: 'ready' }); });

  it('exposes one sound chip with canonical health copy and no Settings gear', () => {
    renderChrome();
    expect(screen.getByRole('button', { name: 'Change sound, Grand Piano. Piano ready' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Settings/i })).toBeNull();
  });

  it('opens Sound on tap and Piano maintenance on the 550ms hold contract', () => {
    renderChrome();
    const [onHold, options] = longPressSpy.mock.calls[0];
    expect(options.holdMs ?? 550).toBe(550);
    act(() => options.onTap());
    expect(screen.getByText('Sound sheet')).toBeTruthy();
    act(() => onHold());
    expect(screen.getByText('Piano maintenance')).toBeTruthy();
  });

  it('uses partial health in the accessible name without exposing maintenance hints', () => {
    connection.health.state = 'input-only';
    connection.health.copy = 'input-only';
    renderChrome();
    const chip = screen.getByRole('button', { name: /Piano input-only/ });
    expect(chip.getAttribute('aria-label')).not.toMatch(/hold|maintenance|operator/i);
  });

  it('keeps breadcrumb thumbnails, icons, and current actions intact', () => {
    const action = vi.fn();
    breadcrumbBar.crumbs = [{ label: 'Song', image: '/song.jpg' }, { label: 'Listen', icon: 'mode-listen', onClick: action }];
    renderChrome({ modeLabel: 'Music', modeKey: 'music' });
    expect(screen.getByText('Music')).toBeTruthy();
    expect(document.querySelector('img')).toHaveAttribute('src', '/song.jpg');
    fireEvent.click(screen.getByRole('button', { name: /Listen/i }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
