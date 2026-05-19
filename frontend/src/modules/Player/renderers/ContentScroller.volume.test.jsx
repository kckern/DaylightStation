import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';
import { ScreenVolumeProvider } from '../../../screen-framework/providers/ScreenVolumeProvider.jsx';
import { _resetForTests, useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';

// Minimal parseContent stub — ContentScroller calls it but the return is not
// asserted here.
const parseContent = () => <div data-testid="content" />;

// Fire the named event on the first <audio> or <video> in the container.
function fireMediaEvent(container, type) {
  const el = container.querySelector('audio, video');
  if (!el) throw new Error(`no media element found in container for "${type}"`);
  el.dispatchEvent(new Event(type));
  return el;
}

// Probe component is hoisted so its component identity is stable across the
// test module. apiRef holds the current ScreenVolume context value; the test
// clears it at the start of its run, and Probe's effect sets it on mount.
const apiRef = { current: null };
const Probe = () => {
  const v = useScreenVolume();
  React.useEffect(() => { apiRef.current = v; }, [v]);
  return null;
};

describe('ContentScroller — master volume integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    _resetForTests();
  });

  it('applies mainVolume × master on loadedmetadata', () => {
    const { container } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <ContentScroller
          type="readalong"
          title="Test"
          assetId="test-1"
          mainMediaUrl="https://example.test/audio.mp3"
          isVideo={false}
          mainVolume={0.8}
          contentData={{ data: [] }}
          parseContent={parseContent}
        />
      </ScreenVolumeProvider>
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });

    // 0.8 × 0.5 = 0.4
    expect(mediaEl.volume).toBeCloseTo(0.4, 5);
  });

  it('defaults to master = 1 when rendered without a ScreenVolumeProvider', () => {
    const { container } = render(
      <ContentScroller
        type="readalong"
        title="Test"
        assetId="test-2"
        mainMediaUrl="https://example.test/audio.mp3"
        isVideo={false}
        mainVolume={0.6}
        contentData={{ data: [] }}
        parseContent={parseContent}
      />
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });

    expect(mediaEl.volume).toBeCloseTo(0.6, 5);
  });

  it('re-applies master × mainVolume when master changes mid-playback', () => {
    apiRef.current = null;
    const { container } = render(
      <ScreenVolumeProvider defaultMaster={0.5}>
        <Probe />
        <ContentScroller
          type="readalong"
          title="Test"
          assetId="test-3"
          mainMediaUrl="https://example.test/audio.mp3"
          isVideo={false}
          mainVolume={0.8}
          contentData={{ data: [] }}
          parseContent={parseContent}
        />
      </ScreenVolumeProvider>
    );

    let mediaEl;
    act(() => {
      mediaEl = fireMediaEvent(container, 'loadedmetadata');
    });
    // 0.8 × 0.5 = 0.4
    expect(mediaEl.volume).toBeCloseTo(0.4, 5);

    // User presses vol-up — master changes mid-playback.
    act(() => apiRef.current.setMaster(1.0));
    // 0.8 × 1.0 = 0.8
    expect(mediaEl.volume).toBeCloseTo(0.8, 5);

    // Mute — master → 0.
    act(() => apiRef.current.toggleMute());
    expect(mediaEl.volume).toBeCloseTo(0, 5);
  });
});
