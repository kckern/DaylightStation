#!/usr/bin/env node
/**
 * Jump Rope Simulator - Generates realistic jump rope BLE data
 *
 * Usage:
 *   node simulation-jumprope.mjs [options]
 *
 * Options:
 *   --duration=SECONDS  Simulation duration (default: 120)
 *   --device=DEVICE_ID  Custom device ID
 *   --countdown         Start in countdown mode (counter decreases)
 *   --switch-mode       Switch between modes mid-simulation
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Load .env file manually
const __filename = new URL(import.meta.url).pathname;
const rootDir = path.resolve(path.dirname(__filename), '..', '..');

const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
  console.log('📄 Loaded .env from project root');
}

// Configuration
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const UPDATE_INTERVAL = 500; // Send data every 500ms (realistic BLE update rate)

// Parse arguments
const durationArg = process.argv.find(a => a.startsWith('--duration='));
const deviceArg = process.argv.find(a => a.startsWith('--device='));
const countdownArg = process.argv.includes('--countdown');
const switchModeArg = process.argv.includes('--switch-mode');

const SIMULATION_DURATION = durationArg
  ? parseInt(durationArg.split('=')[1], 10) * 1000
  : 120 * 1000; // Default 2 minutes

const DEVICE_ID = deviceArg
  ? deviceArg.split('=')[1]
  : '12:34:5B:E1:DD:85'; // Default from config

const DEVICE_NAME = 'R-Q008';

/**
 * Jump rope workout phases for realistic simulation
 */
const WORKOUT_PHASES = [
  { name: 'warmup', duration: 15, targetRPM: 60, rpmVariability: 10 },
  { name: 'steady', duration: 30, targetRPM: 100, rpmVariability: 15 },
  { name: 'interval_fast', duration: 20, targetRPM: 140, rpmVariability: 20 },
  { name: 'recovery', duration: 15, targetRPM: 80, rpmVariability: 10 },
  { name: 'interval_fast', duration: 20, targetRPM: 150, rpmVariability: 25 },
  { name: 'recovery', duration: 15, targetRPM: 70, rpmVariability: 10 },
  { name: 'steady', duration: 30, targetRPM: 110, rpmVariability: 15 },
  { name: 'cooldown', duration: 15, targetRPM: 50, rpmVariability: 8 }
];

class JumpropeSimulator {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.startTime = null;
    this.interval = null;
    
    // Session state
    this.totalRevolutions = 0;
    this.rawCounter = countdownArg ? 500 : 0;
    this.countdownMode = countdownArg;
    this.shouldSwitchMode = switchModeArg;
    this.modeSwitched = false;
    this.currentRPM = 0;
    this.maxRPM = 0;
    this.rpmReadings = [];
    this.lastJumpTime = null;
    
    // Simulate occasional trips/misses
    this.tripProbability = 0.02; // 2% chance per update
    this.isTripped = false;
    this.tripRecoveryTime = 0;
  }

  async connect() {
    const protocol = DAYLIGHT_PORT == 443 ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${DAYLIGHT_HOST}:${DAYLIGHT_PORT}/ws`;
    
    console.log(`🔗 Connecting to DaylightStation WebSocket: ${wsUrl}`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to DaylightStation WebSocket');
        this.connected = true;
        resolve();
      });
      
      this.ws.on('close', () => {
        console.log('⚠️  WebSocket connection closed');
        this.connected = false;
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });
    });
  }

  /**
   * Get the current workout phase based on elapsed time
   */
  getCurrentPhase(elapsedSeconds) {
    let accumulated = 0;
    const totalPhaseDuration = WORKOUT_PHASES.reduce((sum, p) => sum + p.duration, 0);
    
    // Loop phases if simulation is longer
    const effectiveTime = elapsedSeconds % totalPhaseDuration;
    
    for (const phase of WORKOUT_PHASES) {
      accumulated += phase.duration;
      if (effectiveTime < accumulated) {
        return phase;
      }
    }
    return WORKOUT_PHASES[WORKOUT_PHASES.length - 1];
  }

  /**
   * Generate realistic RPM with smooth transitions
   */
  generateRPM(elapsedSeconds) {
    const phase = this.getCurrentPhase(elapsedSeconds);
    
    // Handle trip recovery
    if (this.isTripped) {
      this.tripRecoveryTime -= UPDATE_INTERVAL / 1000;
      if (this.tripRecoveryTime <= 0) {
        this.isTripped = false;
        console.log('🔄 Recovered from trip');
      }
      return 0; // No jumps during trip
    }
    
    // Random trip simulation
    if (Math.random() < this.tripProbability) {
      this.isTripped = true;
      this.tripRecoveryTime = 1.5 + Math.random() * 1.5; // 1.5-3 seconds recovery
      console.log('💫 Tripped! Recovering...');
      return 0;
    }
    
    // Smooth transition toward target RPM
    const targetRPM = phase.targetRPM;
    const transitionSpeed = 0.15; // How fast to approach target
    
    if (this.currentRPM === 0) {
      this.currentRPM = targetRPM * 0.7; // Start at 70% of target
    }
    
    // Gradually move toward target
    this.currentRPM += (targetRPM - this.currentRPM) * transitionSpeed;
    
    // Add natural variation
    const variation = (Math.random() - 0.5) * phase.rpmVariability;
    let rpm = Math.round(this.currentRPM + variation);
    
    // Clamp to realistic range
    rpm = Math.max(0, Math.min(200, rpm));
    
    return rpm;
  }

  /**
   * Send jump rope data via WebSocket
   */
  sendJumpropeData() {
    if (!this.connected || !this.ws) return;

    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    if (this.shouldSwitchMode && !this.modeSwitched && elapsedSeconds > 30) {
      this.countdownMode = !this.countdownMode;
      this.rawCounter = this.countdownMode ? 500 : 0;
      this.modeSwitched = true;
      console.log(`🔄 Mode switched to ${this.countdownMode ? 'countdown' : 'count up'}`);
    }

    const rpm = this.generateRPM(elapsedSeconds);

    const jumpsThisInterval = Math.round(rpm / (60 / (UPDATE_INTERVAL / 1000)));

    if (this.countdownMode) {
      this.rawCounter -= jumpsThisInterval;
      if (this.rawCounter < 0) this.rawCounter = 0;
    } else {
      this.rawCounter += jumpsThisInterval;
    }

    this.totalRevolutions += jumpsThisInterval;

    if (rpm > 0) {
      this.rpmReadings.push(rpm);
      this.maxRPM = Math.max(this.maxRPM, rpm);
    }

    const message = {
      topic: 'fitness',
      source: 'fitness-simulator',
      type: 'ble_jumprope',
      deviceId: DEVICE_ID,
      deviceName: DEVICE_NAME,
      timestamp: new Date().toISOString(),
      data: {
        revolutions: this.totalRevolutions
      }
    };

    this.ws.send(JSON.stringify(message));

    if (elapsedSeconds % 2 === 0 && this.lastLoggedSecond !== elapsedSeconds) {
      this.lastLoggedSecond = elapsedSeconds;
      const phase = this.getCurrentPhase(elapsedSeconds);
      const mode = this.countdownMode ? '(countdown)' : '(count up)';
      console.log(`🦘 [${elapsedSeconds}s] ${phase.name} ${mode}: ${this.totalRevolutions} revs @ ~${rpm} RPM`);
    }
  }

  startSimulation() {
    console.log(`\n🚀 Starting jump rope simulation`);
    console.log(`📊 Device: ${DEVICE_NAME} (${DEVICE_ID})`);
    console.log(`⏱️  Duration: ${SIMULATION_DURATION / 1000} seconds`);
    console.log(`📡 Update interval: ${UPDATE_INTERVAL}ms`);
    console.log('');
    console.log('Workout phases:');
    WORKOUT_PHASES.forEach(p => {
      console.log(`  - ${p.name}: ${p.duration}s @ ~${p.targetRPM} RPM`);
    });
    console.log('');
    
    this.startTime = Date.now();
    this.lastLoggedSecond = -1;
    
    // Send data at regular intervals
    this.interval = setInterval(() => {
      this.sendJumpropeData();
    }, UPDATE_INTERVAL);

    // Stop simulation after duration
    setTimeout(() => {
      this.stopSimulation();
    }, SIMULATION_DURATION);
  }

  stopSimulation() {
    console.log('\n🛑 Stopping jump rope simulation');
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    if (this.ws) {
      this.ws.close();
    }
    
    // Print summary
    const durationSec = Math.floor((Date.now() - this.startTime) / 1000);
    const avgRPM = this.rpmReadings.length > 0
      ? Math.round(this.rpmReadings.reduce((a, b) => a + b, 0) / this.rpmReadings.length)
      : 0;
    
    console.log('\n📈 Simulation Summary:');
    console.log(`  ⏱️  Duration: ${durationSec} seconds`);
    console.log(`  🦘 Total revolutions: ${this.totalRevolutions}`);
    console.log(`  📊 Average RPM: ${avgRPM}`);
    console.log(`  🔥 Max RPM: ${this.maxRPM}`);
    console.log(`  🔥 Calories: ${Math.round(this.totalRevolutions * 0.1)}`);
    console.log(`  📉 Revolutions/min: ${Math.round(this.totalRevolutions / (durationSec / 60))}`);
    
    console.log('\n✅ Simulation complete!');
    process.exit(0);
  }
}

// Main execution
async function main() {
  console.log('🦘 Jump Rope BLE Simulator');
  console.log('==========================');
  
  const simulator = new JumpropeSimulator();
  
  try {
    await simulator.connect();
    simulator.startSimulation();
  } catch (error) {
    console.error('💥 Failed to start simulation:', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT, stopping simulation...');
  process.exit(0);
});

// Start the simulation
main();
