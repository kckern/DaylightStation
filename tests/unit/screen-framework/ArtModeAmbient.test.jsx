import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Capture the topics ArtMode subscribes to.
let capturedTopics = null;
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn((topics) => { capturedTopics = topics; }),
}));

// Stub the heavy / IO deps so ArtMode mounts cheaply.
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => new Promise(() => {})), // never resolves: skip load() side effects
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({}),
}));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';
import { ScreenAmbientProvider } from '../../../frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx';

const officeAmbient = {
  topic: 'ambient:office',
  defaultLux: 36,
  curve: [{ lux: 0, dim: 0.9 }, { lux: 30, dim: 0.32 }, { lux: 200, dim: 0.05 }],
};

describe('ArtMode ambient subscription', () => {
  beforeEach(() => { capturedTopics = null; });

  it('subscribes to the screen ambient topic, not the hardcoded one', () => {
    render(
      <ScreenAmbientProvider value={officeAmbient}>
        <ArtMode placard={false} />
      </ScreenAmbientProvider>
    );
    expect(capturedTopics).toEqual(['ambient:office']);
  });

  it('falls back to the preset ambient topic when no screen ambient', () => {
    render(
      <ScreenAmbientProvider value={null}>
        <ArtMode placard={false} ambient={{ curve: [{ lux: 0, dim: 0.5 }], defaultLux: 80 }} />
      </ScreenAmbientProvider>
    );
    expect(capturedTopics).toEqual(['ambient']);
  });
});
