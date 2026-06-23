import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const midi = vi.hoisted(() => ({ connected: true }));
const sound = vi.hoisted(() => ({ activeName: 'Grand Piano' }));

vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./PianoSoundContext.jsx', () => ({ usePianoSound: () => sound }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ basePath: '/piano' }) }));
vi.mock('./PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumbBar: () => ({ crumbs: [] }) }));
vi.mock('./PianoSettingsSheet.jsx', () => ({ default: ({ open }) => (open ? <div>SETTINGS-OPEN</div> : null) }));
vi.mock('./icons/Icon.jsx', () => ({ default: () => null }));

import { PianoChrome } from './PianoChrome.jsx';

const renderChrome = (props = {}) =>
  render(<MemoryRouter><PianoChrome {...props} /></MemoryRouter>);

describe('PianoChrome', () => {
  it('shows the active voice in the status chip', () => {
    renderChrome({ modeLabel: 'Courses', modeKey: 'videos' });
    expect(screen.getByText('Grand Piano')).toBeTruthy();
  });

  it('renders the mode breadcrumb crumb', () => {
    renderChrome({ modeLabel: 'Courses', modeKey: 'videos' });
    expect(screen.getByText('Courses')).toBeTruthy();
  });

  it('opens the settings sheet when the chip is tapped', () => {
    renderChrome();
    expect(screen.queryByText('SETTINGS-OPEN')).toBeNull();
    fireEvent.click(screen.getByLabelText('Settings'));
    expect(screen.getByText('SETTINGS-OPEN')).toBeTruthy();
  });
});
