#!/usr/bin/env node

/**
 * BLE Heart Rate Simulator
 * Sends simulated HR data via WebSocket for testing without hardware.
 *
 * Usage:
 *   node _extensions/fitness/simulation-heartrate.mjs --duration=60 --user=grannie --resting=72
 */

import WebSocket from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v]; })
);

const USER_ID = args.user || 'grannie';
const DURATION_S = parseInt(args.duration || '120', 10);
const RESTING_HR = parseInt(args.resting || '72', 10);
const HOST = args.host || process.env.DAYLIGHT_HOST || 'localhost';
const PORT = args.port || process.env.DAYLIGHT_PORT || '3111';

const protocol = PORT === '443' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${HOST}:${PORT}/ws`;

console.log(`💓 HR Simulator: user=${USER_ID}, duration=${DURATION_S}s, resting=${RESTING_HR}`);
console.log(`🔗 Connecting to ${wsUrl}`);

const ws = new WebSocket(wsUrl);
let elapsed = 0;

ws.on('open', () => {
  console.log('✅ Connected');

  const interval = setInterval(() => {
    elapsed += 2;
    if (elapsed > DURATION_S) {
      console.log('⏱️  Duration reached, stopping');
      clearInterval(interval);
      ws.close();
      return;
    }

    // Simulate a workout curve: ramp up, sustain, cool down
    const progress = elapsed / DURATION_S;
    let targetHR;
    if (progress < 0.2) {
      targetHR = RESTING_HR + (40 * (progress / 0.2));
    } else if (progress < 0.7) {
      const workProgress = (progress - 0.2) / 0.5;
      targetHR = RESTING_HR + 40 + (20 * workProgress);
    } else {
      const coolProgress = (progress - 0.7) / 0.3;
      targetHR = RESTING_HR + 60 - (50 * coolProgress);
    }

    const hr = Math.round(targetHR + (Math.random() - 0.5) * 6);

    const message = {
      topic: 'fitness',
      source: 'fitness',
      type: 'ant',
      profile: 'HR',
      deviceId: `ble_${USER_ID}`,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: hr,
        sensorContact: true,
        source: 'ble'
      }
    };

    ws.send(JSON.stringify(message));
    console.log(`💓 ${USER_ID}: ${hr} bpm (${Math.round(progress * 100)}%)`);
  }, 2000);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('👋 Disconnected');
  process.exit(0);
});
