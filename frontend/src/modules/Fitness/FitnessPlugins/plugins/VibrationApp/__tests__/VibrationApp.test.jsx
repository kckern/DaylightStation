import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import VibrationApp from '../VibrationApp.jsx';
import { FitnessContext } from '../../../../../context/FitnessContext.jsx';

const renderWithContext = (value) => {
  return renderToString(
    <FitnessContext.Provider value={value}>
      <VibrationApp />
    </FitnessContext.Provider>
  );
};

describe('VibrationApp', () => {
  it('shows connecting state when websocket not connected', () => {
    const html = renderWithContext({ connected: false, vibrationState: {} });
    assert.match(html, /Connecting to sensor network/);
  });

  it('shows empty state when no sensors', () => {
    const html = renderWithContext({ connected: true, vibrationState: {} });
    assert.match(html, /No vibration sensors configured/);
  });

  it('renders active card with pulse class', () => {
    const state = {
      bag: {
        id: 'bag',
        name: 'Punching Bag',
        type: 'punching_bag',
        vibration: true,
        intensity: 22.4,
        thresholds: { low: 5, medium: 15, high: 30 },
        axes: { x: 10, y: 5, z: 12 },
        battery: 90,
        batteryLow: false,
        lastEvent: Date.now()
      }
    };
    const html = renderWithContext({ connected: true, vibrationState: state });
    assert.match(html, /Punching Bag/);
    assert.match(html, /vibration-card--active/);
    assert.match(html, /Intensity:/);
  });
});
