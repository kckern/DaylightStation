/**
 * Simulates real-time fitness data (HR, cadence) for testing
 *
 * Based on pattern from _extensions/fitness/simulation.mjs
 */

import WebSocket from 'ws';

export class FitnessSimulator {
  constructor(wsUrl = 'ws://localhost:3112/ws') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.running = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  start(devices = []) {
    this.running = true;
    // Implementation based on _extensions/fitness/simulation.mjs
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }

  sendHeartRate(deviceId, bpm) {
    if (!this.ws || !this.running) return;

    this.ws.send(JSON.stringify({
      topic: 'fitness',
      source: 'test-simulator',
      type: 'ant',
      profile: 'HR',
      deviceId,
      data: { ComputedHeartRate: bpm },
    }));
  }
}
