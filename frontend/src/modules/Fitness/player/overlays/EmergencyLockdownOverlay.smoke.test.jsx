import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ locked: false }),
  DaylightMediaPath: (p) => p,
  DaylightImagePath: (p) => p
}));
vi.mock('@/services/WebSocketService.js', () => ({
  wsService: { subscribe: vi.fn(() => () => {}) }
}));
vi.mock('@/modules/Fitness/player/hooks/audioCuePlayer.js', () => ({
  getCueAudioElement: () => null,
  primeCueAudio: vi.fn()
}));
vi.mock('@/context/FitnessContext.jsx', () => ({
  __esModule: true,
  useFitness: () => ({ fitnessConfiguration: {}, userCollections: { all: [] } }),
}));
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  __esModule: true, playCueOnce: ({ onDone } = {}) => { onDone?.(); return true; },
}));

import EmergencyLockdownOverlay from './EmergencyLockdownOverlay.jsx';
import { IdentityProvider } from '@/modules/Fitness/identity/IdentityProvider';

const ORIGINAL_SEARCH = window.location.search;
function setSearch(s) { window.history.replaceState({}, '', `${window.location.pathname}${s}`); }

describe('EmergencyLockdownOverlay smoke', () => {
  beforeEach(() => setSearch(''));
  afterEach(() => { cleanup(); setSearch(ORIGINAL_SEARCH); });

  it('renders nothing in normal phase', () => {
    const { container } = render(<IdentityProvider><EmergencyLockdownOverlay audioPath="x.mp3" /></IdentityProvider>);
    expect(container.querySelector('.emergency-overlay')).toBeNull();
  });

  it('renders the triggering screen under the URL seam', () => {
    setSearch('?emergency=triggering');
    const { container } = render(<IdentityProvider><EmergencyLockdownOverlay audioPath="x.mp3" /></IdentityProvider>);
    expect(container.querySelector('.emergency-overlay--triggering')).not.toBeNull();
    expect(container.querySelector('.emergency-glyph')).not.toBeNull();
  });

  it('renders the locked screen under the URL seam', () => {
    setSearch('?emergency=locked');
    const { container } = render(<IdentityProvider><EmergencyLockdownOverlay audioPath="x.mp3" /></IdentityProvider>);
    expect(container.querySelector('.emergency-overlay--locked')).not.toBeNull();
    expect(container.textContent).toContain('LOCKED');
  });
});
