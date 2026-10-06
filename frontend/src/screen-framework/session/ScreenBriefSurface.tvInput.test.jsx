import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { createScreenPlayerFeatures } from './screenPlayerFeatures.js';

vi.mock('../../modules/Player/Player.jsx', () => ({ default: () => <div data-testid="clip-player" /> }));
vi.mock('../../modules/CameraFeed/CameraOverlay.jsx', () => ({ default: () => <div data-testid="camera" /> }));

import { ScreenBriefSurface } from './ScreenPlayerFeaturesHost.jsx';

beforeEach(() => resetActionBus());

describe('Show-briefly bar on a TV: D-pad and OK only', () => {
  it('Close holds focus on arrival and OK closes the brief', () => {
    const features = createScreenPlayerFeatures({ ownerId: 'tv' });
    const view = render(<ScreenBriefSurface features={features} />);
    act(() => { features.beginBrief({ kind: 'clip', contentId: 'plex:9', title: 'Doorbell', origin: null, seconds: 30 }); });
    expect(document.activeElement).toBe(view.getByTestId('screen-brief-close'));
    act(() => { getActionBus().emit('select', {}); });
    expect(view.queryByTestId('screen-brief')).toBeNull();
  });
});
