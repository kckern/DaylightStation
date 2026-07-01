import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useMediaKeyboardHandler } from './useMediaKeyboardHandler.js';
import {
  isPlayerKeyboardActive,
  __resetPlayerKeyboardOwnership,
} from './playerKeyboardOwnership.js';

function Harness({ config }) {
  useMediaKeyboardHandler(config);
  return null;
}

describe('useMediaKeyboardHandler — player keyboard ownership', () => {
  beforeEach(() => __resetPlayerKeyboardOwnership());

  it('a fullscreen video claims ownership while mounted and releases on unmount', () => {
    expect(isPlayerKeyboardActive()).toBe(false);
    const { unmount } = render(<Harness config={{ isVideo: true, type: 'video' }} />);
    expect(isPlayerKeyboardActive()).toBe(true);
    unmount();
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('an audio-only player does NOT claim ownership (menu stays live beneath it)', () => {
    render(<Harness config={{ isVideo: false, type: 'audio' }} />);
    expect(isPlayerKeyboardActive()).toBe(false);
  });

  it('a video with ignoreKeys does NOT claim ownership', () => {
    render(<Harness config={{ isVideo: true, ignoreKeys: true, type: 'video' }} />);
    expect(isPlayerKeyboardActive()).toBe(false);
  });
});
