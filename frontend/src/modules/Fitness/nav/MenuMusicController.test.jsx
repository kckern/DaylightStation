import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on the underlying hook so we can assert exactly what isActive it receives.
const useMenuMusicSpy = vi.fn();
vi.mock('./useMenuMusic.js', () => ({
  __esModule: true,
  default: (opts) => useMenuMusicSpy(opts)
}));

let mockCtx;
vi.mock('../../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => mockCtx
}));

vi.mock('../identity/IdentityProvider', () => ({
  useIdentity: () => ({ phase: 'normal' })
}));

import MenuMusicController from './MenuMusicController.jsx';

describe('MenuMusicController — ducking', () => {
  beforeEach(() => {
    useMenuMusicSpy.mockClear();
    mockCtx = { voiceMemoOverlayState: { open: false }, feedbackRecordingActive: false };
  });

  it('stays active when nothing is recording', () => {
    render(<MenuMusicController isActive trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('ducks while the voice-memo overlay is open', () => {
    mockCtx.voiceMemoOverlayState = { open: true };
    render(<MenuMusicController isActive trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it('ducks while the feedback panel is recording — the reported bug (music kept playing during Feedback recording)', () => {
    mockCtx.feedbackRecordingActive = true;
    render(<MenuMusicController isActive trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it('resumes once feedback recording ends', () => {
    mockCtx.feedbackRecordingActive = true;
    const { rerender } = render(<MenuMusicController isActive trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenLastCalledWith(expect.objectContaining({ isActive: false }));
    mockCtx = { ...mockCtx, feedbackRecordingActive: false };
    rerender(<MenuMusicController isActive trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenLastCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('does not override an externally-inactive isActive', () => {
    mockCtx.feedbackRecordingActive = false;
    render(<MenuMusicController isActive={false} trackChangeKey="a" volume={0.1} trackUrls={['x.mp3']} />);
    expect(useMenuMusicSpy).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });
});
