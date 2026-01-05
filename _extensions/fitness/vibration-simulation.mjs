#!/usr/bin/env node

import mqtt from 'mqtt';
import fs from 'fs';
import path from 'path';

// Lightweight .env loader (no dependency)
const __filename = new URL(import.meta.url).pathname;
const rootDir = path.resolve(path.dirname(__filename), '..', '..');
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (!key || rest.length === 0) return;
    const value = rest.join('=').replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
  console.log('📄 Loaded .env from project root');
}

// Config framework
import { resolveConfigPaths } from '../../backend/lib/config/pathResolver.mjs';
import { loadAllConfig } from '../../backend/lib/config/loader.mjs';
import { configService } from '../../backend/lib/config/ConfigService.mjs';
import { userDataService } from '../../backend/lib/config/UserDataService.mjs';
import { loadFile } from '../../backend/lib/io.mjs';

const SIMULATION_DURATION = 180 * 1000;
const ACTIVE_PULSE_MS = 100;

const isDocker = fs.existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: rootDir });
if (configPaths.error) {
  console.error('Configuration error:', configPaths.error);
  process.exit(1);
}

const configResult = loadAllConfig({
  configDir: configPaths.configDir,
  dataDir: configPaths.dataDir,
  isDocker,
  isDev: !isDocker
});
process.env = { ...process.env, isDocker, ...configResult.config };

function loadEquipmentConfig() {
  try {
    const householdId = configService.getDefaultHouseholdId();
    const scoped = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
    if (scoped?.equipment) return scoped.equipment;
    const legacy = loadFile('fitness/config');
    return legacy?.equipment || [];
  } catch (err) {
    console.error('Failed to load equipment config:', err.message);
    return [];
  }
}

function getMqttConfig() {
  const cfg = process.env.mqtt || {};
  const host = process.env.MQTT_HOST || cfg.host || '127.0.0.1';
  const port = Number(process.env.MQTT_PORT || cfg.port || 1883);
  return { host, port };
}

function getVibrationSensors(equipment) {
  return (equipment || [])
    .filter((e) => e?.sensor?.type === 'vibration' && e.sensor.mqtt_topic)
    .map((e) => ({
      id: e.id,
      name: e.name || e.id,
      topic: e.sensor.mqtt_topic,
      thresholds: e.thresholds || { low: 5, medium: 15, high: 30 }
    }));
}

function generateVibrationData(intensity = 'medium') {
  const map = {
    light: { base: 3, variance: 2 },
    medium: { base: 10, variance: 6 },
    hard: { base: 25, variance: 10 }
  };
  const { base, variance } = map[intensity] || map.medium;
  const rand = () => (Math.random() - 0.5) * 2 * (base + Math.random() * variance);
  return {
    vibration: true,
    x_axis: rand(),
    y_axis: rand(),
    z_axis: rand(),
    battery: 80 + Math.floor(Math.random() * 15),
    battery_low: false,
    linkquality: 120 + Math.floor(Math.random() * 80)
  };
}

function generateIdleData() {
  return {
    vibration: false,
    x_axis: 0,
    y_axis: 0,
    z_axis: 0,
    linkquality: 120
  };
}

class VibrationSimulator {
  constructor(mode = 'random') {
    this.mode = mode;
    this.client = null;
    this.sensors = [];
    this.timers = [];
    this.running = false;
  }

  async init() {
    this.sensors = getVibrationSensors(loadEquipmentConfig());
        if (!this.sensors.length) {
          console.warn('Warning: No vibration sensors found in config');
    }

    const mqttCfg = getMqttConfig();
    const url = `mqtt://${mqttCfg.host}:${mqttCfg.port}`;
    this.client = mqtt.connect(url);

    await new Promise((resolve, reject) => {
      this.client.once('connect', () => {
            console.log(`Connected to MQTT at ${url}`);
        resolve();
      });
      this.client.once('error', reject);
    });
  }

  publish(sensor, payload) {
    if (!this.client || !sensor?.topic) return;
    this.client.publish(sensor.topic, JSON.stringify(payload));
    if (payload.vibration) {
      const ix = Math.round((payload.x_axis ?? 0) * 10) / 10;
      const iy = Math.round((payload.y_axis ?? 0) * 10) / 10;
      const iz = Math.round((payload.z_axis ?? 0) * 10) / 10;
      console.log(`mqtt → ${sensor.id} (${sensor.topic}) intensity=${payload.__intensity || 'n/a'} axes=[${ix}, ${iy}, ${iz}]`);
    }
  }

  fire(sensor, intensity = 'medium') {
    const hit = { ...generateVibrationData(intensity), __intensity: intensity };
    this.publish(sensor, hit);
    setTimeout(() => this.publish(sensor, generateIdleData()), ACTIVE_PULSE_MS);
  }

  startRandomMode() {
    const loop = () => {
      if (!this.running) return;
      const delay = 2000 + Math.random() * 6000;
      const sensor = this.sensors[Math.floor(Math.random() * this.sensors.length)] || null;
      if (sensor) {
        const bucket = Math.random();
        const intensity = bucket > 0.7 ? 'hard' : bucket > 0.3 ? 'medium' : 'light';
        this.fire(sensor, intensity);
      }
      this.timers.push(setTimeout(loop, delay));
    };
    loop();
  }

  startWorkoutMode() {
    const phases = [
      { label: 'warmup', duration: 40_000, intensity: 'light', interval: 2500 },
      { label: 'active', duration: 70_000, intensity: 'medium', interval: 1400 },
      { label: 'peak', duration: 30_000, intensity: 'hard', interval: 1000 },
      { label: 'cooldown', duration: 40_000, intensity: 'light', interval: 2800 }
    ];
    let phaseIdx = 0;
    let phaseEnd = Date.now() + phases[0].duration;

    const loop = () => {
      if (!this.running) return;
      const now = Date.now();
      if (now >= phaseEnd && phaseIdx < phases.length - 1) {
        phaseIdx += 1;
        phaseEnd = now + phases[phaseIdx].duration;
        console.log(`Phase: ${phases[phaseIdx].label}`);
      }
      const current = phases[phaseIdx];
      const sensor = this.sensors[Math.floor(Math.random() * this.sensors.length)] || null;
      if (sensor) this.fire(sensor, current.intensity);
      this.timers.push(setTimeout(loop, current.interval));
    };
    console.log(`Phase: ${phases[0].label}`);
    loop();
  }

  startDemoMode() {
    let index = 0;
    const loop = () => {
      if (!this.running) return;
      const sensor = this.sensors[index % Math.max(1, this.sensors.length)];
      if (sensor) this.fire(sensor, 'medium');
      index += 1;
      this.timers.push(setTimeout(loop, 1500));
    };
    loop();
  }

  start() {
    this.running = true;
    if (this.sensors.length === 0) {
      console.warn('Warning: No sensors to simulate; exiting.');
      return;
    }
    switch (this.mode) {
      case 'workout':
        this.startWorkoutMode();
        break;
      case 'demo':
        this.startDemoMode();
        break;
      default:
        this.startRandomMode();
    }
    setTimeout(() => this.stop(), SIMULATION_DURATION);
  }

  stop() {
    if (!this.running) return;
    console.log('\nStopping simulation...');
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.client) this.client.end();
    console.log('Simulation complete');
  }
}

const mode = process.argv[2] || 'random';
const simulator = new VibrationSimulator(mode);

console.log('============================================================');
console.log(' Vibration Sensor Simulator');
console.log('============================================================');
console.log(` Mode: ${mode}`);
console.log(` Duration: ${(SIMULATION_DURATION / 1000)}s`);
console.log('============================================================');

simulator.init()
  .then(() => simulator.start())
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });

process.on('SIGINT', () => simulator.stop());
process.on('SIGTERM', () => simulator.stop());
