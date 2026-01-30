/**
 * Fitness Test Simulation Framework
 * 
 * Programmable HR/device simulation for test cases.
 * Allows precise control over heart rate patterns, timing, and multi-user scenarios.
 * 
 * @example
 * // Simple constant HR test
 * const sim = new FitnessSimulator({ wsUrl: 'ws://localhost:3112/ws' });
 * await sim.connect();
 * await sim.runScenario({
 *   duration: 30,
 *   users: { alice: { hr: 95 } }  // Low HR to trigger governance
 * });
 * 
 * @example
 * // Complex multi-phase scenario
 * await sim.runScenario({
 *   duration: 120,
 *   users: {
 *     alice: {
 *       pattern: 'sequence',
 *       sequence: [
 *         { hr: 95, duration: 30 },   // Low zone - triggers warning
 *         { hr: 165, duration: 60 },  // High zone - clears warning
 *         { hr: 100, duration: 30 }   // Drop again
 *       ]
 *     },
 *     bob: { hr: 150, variance: 5 }   // Steady high HR
 *   }
 * });
 */

import WebSocket from 'ws';

// Device mappings - uses real household device IDs for dev server testing
// These map to the actual devices in data/household/apps/fitness/config.yml
export const TEST_DEVICES = {
  alice: { deviceId: 40475, userId: 'kckern', name: 'KC' },        // Real device
  bob: { deviceId: 28812, userId: 'felix', name: 'Felix' },        // Real device
  charlie: { deviceId: 28688, userId: 'milo', name: 'Milo' }       // Real device
};

export const TEST_CADENCE_DEVICES = {
  bike: { deviceId: 54321, equipmentId: 'equipment_bike', name: 'Test Bike' }
};

// Heart rate zone thresholds (from production config)
// See: data/household/apps/fitness/config.yml
export const HR_ZONES = {
  cool: { min: 0, max: 99, name: 'Cool', id: 'cool', color: 'blue', governed: false },
  active: { min: 100, max: 119, name: 'Active', id: 'active', color: 'green', governed: true },
  warm: { min: 120, max: 139, name: 'Warm', id: 'warm', color: 'yellow', governed: true },
  hot: { min: 140, max: 159, name: 'Hot', id: 'hot', color: 'orange', governed: true },
  fire: { min: 160, max: 200, name: 'On Fire', id: 'fire', color: 'red', governed: true }
};

// Preset HR patterns for common test scenarios
export const HR_PATTERNS = {
  // Steady states by zone
  cool: { hr: 80, variance: 5 },          // Below governance threshold
  active: { hr: 110, variance: 5 },        // Just above threshold
  warm: { hr: 130, variance: 5 },
  hot: { hr: 150, variance: 5 },
  fire: { hr: 170, variance: 5 },
  
  // Governance trigger patterns
  belowGovernance: { hr: 85, variance: 3 },     // Triggers lock/warning
  aboveGovernance: { hr: 115, variance: 5 },    // Satisfies governance
  
  // Dynamic patterns
  warmup: {
    pattern: 'ramp',
    startHr: 90,
    endHr: 140,
    durationRatio: 1.0
  },
  cooldown: {
    pattern: 'ramp',
    startHr: 160,
    endHr: 100,
    durationRatio: 1.0
  },
  interval: {
    pattern: 'oscillate',
    lowHr: 120,
    highHr: 170,
    cycleDuration: 30
  },
  dropout: {
    pattern: 'sequence',
    sequence: [
      { hr: 140, duration: 20 },
      { hr: null, duration: 10 },  // null = no signal (dropout)
      { hr: 145, duration: 20 }
    ]
  }
};

/**
 * Governance Test Scenarios - Pre-built scenarios for specific test cases
 * Zone thresholds: cool (<100), active (100+), warm (120+), hot (140+), fire (160+)
 */
export const GOVERNANCE_SCENARIOS = {
  // Trigger yellow warning then clear it
  warningAndClear: {
    description: 'Start in cool zone (warning), then rise to active (clears)',
    duration: 90,
    users: {
      alice: {
        pattern: 'sequence',
        sequence: [
          { hr: 80, duration: 40 },   // Cool zone - warning triggered
          { hr: 120, duration: 50 }   // Active zone - warning cleared
        ]
      }
    }
  },
  
  // Trigger red lockout
  lockout: {
    description: 'Stay in cool zone until grace period expires (lockout)',
    duration: 60,
    users: {
      alice: { hr: 80, variance: 3 }  // Stay below 100 bpm
    }
  },
  
  // Multi-user mixed compliance
  mixedCompliance: {
    description: 'One user in active zone, one in cool zone',
    duration: 60,
    users: {
      alice: { hr: 120, variance: 5 },  // Active zone - compliant
      bob: { hr: 80, variance: 3 }      // Cool zone - non-compliant
    }
  },
  
  // Rapid zone transitions
  rapidTransitions: {
    description: 'Quick zone changes to test debouncing',
    duration: 60,
    users: {
      alice: {
        pattern: 'oscillate',
        lowHr: 80,    // Cool zone
        highHr: 120,  // Active zone
        cycleDuration: 10  // Fast cycling
      }
    }
  },
  
  // All users compliant
  allCompliant: {
    description: 'All users in active zone or above',
    duration: 30,
    users: {
      alice: { hr: 120, variance: 5 },
      bob: { hr: 130, variance: 5 },
      charlie: { hr: 115, variance: 5 }
    }
  },
  
  // Signal dropout during session
  signalDropout: {
    description: 'Heart rate signal loss mid-session',
    duration: 45,
    users: {
      alice: {
        pattern: 'sequence',
        sequence: [
          { hr: 120, duration: 15 },   // Active - compliant
          { hr: null, duration: 15 },  // Signal lost
          { hr: 115, duration: 15 }    // Signal recovered
        ]
      }
    }
  },
  
  // Full lifecycle: lock → unlock → warning → lock → unlock
  fullLifecycle: {
    description: 'Complete governance lifecycle test',
    duration: 150,
    users: {
      alice: {
        pattern: 'sequence',
        sequence: [
          { hr: 80, duration: 15 },    // Cool → lock screen
          { hr: 120, duration: 25 },   // Active → unlock, play video
          { hr: 80, duration: 40 },    // Cool → warning → lockout (30s grace)
          { hr: 125, duration: 30 },   // Active → unlock again
          { hr: 140, duration: 40 }    // Warm → stable playback
        ]
      }
    }
  }
};

/**
 * Heart rate pattern generator
 */
class HRPatternGenerator {
  constructor(config) {
    this.config = config;
    this.startTime = null;
  }
  
  /**
   * Get HR value for current elapsed time
   * @param {number} elapsedSeconds - Seconds since pattern started
   * @returns {number|null} - Heart rate or null for dropout
   */
  getHR(elapsedSeconds) {
    const { pattern, hr, variance } = this.config;
    
    // Simple constant HR
    if (hr !== undefined && !pattern) {
      if (hr === null) return null; // Signal dropout
      return this._addVariance(hr, variance || 0);
    }
    
    // Pattern-based HR
    switch (pattern) {
      case 'constant':
        return this._addVariance(this.config.hr, variance || 0);
        
      case 'ramp':
        return this._rampPattern(elapsedSeconds);
        
      case 'oscillate':
        return this._oscillatePattern(elapsedSeconds);
        
      case 'sequence':
        return this._sequencePattern(elapsedSeconds);
        
      case 'random':
        return this._randomPattern();
        
      default:
        return this._addVariance(hr || 120, variance || 5);
    }
  }
  
  _addVariance(baseHr, variance) {
    if (baseHr === null) return null;
    const delta = (Math.random() - 0.5) * 2 * variance;
    return Math.max(40, Math.min(220, Math.round(baseHr + delta)));
  }
  
  _rampPattern(elapsedSeconds) {
    const { startHr, endHr, durationRatio = 1.0 } = this.config;
    const rampDuration = this._getTotalDuration() * durationRatio;
    const progress = Math.min(1, elapsedSeconds / rampDuration);
    const hr = startHr + (endHr - startHr) * progress;
    return this._addVariance(hr, this.config.variance || 3);
  }
  
  _oscillatePattern(elapsedSeconds) {
    const { lowHr, highHr, cycleDuration = 30 } = this.config;
    const cycleProgress = (elapsedSeconds % cycleDuration) / cycleDuration;
    // Sinusoidal oscillation
    const amplitude = (highHr - lowHr) / 2;
    const midpoint = (highHr + lowHr) / 2;
    const hr = midpoint + amplitude * Math.sin(cycleProgress * Math.PI * 2);
    return this._addVariance(hr, this.config.variance || 3);
  }
  
  _sequencePattern(elapsedSeconds) {
    const { sequence } = this.config;
    if (!Array.isArray(sequence) || sequence.length === 0) {
      return 120;
    }
    
    let accumulated = 0;
    for (const step of sequence) {
      if (elapsedSeconds < accumulated + step.duration) {
        // We're in this step
        if (step.hr === null) return null; // Dropout
        const stepElapsed = elapsedSeconds - accumulated;
        
        // Support ramp within sequence step
        if (step.startHr !== undefined && step.endHr !== undefined) {
          const progress = stepElapsed / step.duration;
          const hr = step.startHr + (step.endHr - step.startHr) * progress;
          return this._addVariance(hr, step.variance || 3);
        }
        
        return this._addVariance(step.hr, step.variance || 3);
      }
      accumulated += step.duration;
    }
    
    // Past end of sequence - repeat last value
    const lastStep = sequence[sequence.length - 1];
    return lastStep.hr === null ? null : this._addVariance(lastStep.hr, lastStep.variance || 3);
  }
  
  _randomPattern() {
    const { minHr = 90, maxHr = 180 } = this.config;
    return Math.round(minHr + Math.random() * (maxHr - minHr));
  }
  
  _getTotalDuration() {
    // Used for ramp pattern - needs to be set externally
    return this.config._totalDuration || 60;
  }
  
  setTotalDuration(duration) {
    this.config._totalDuration = duration;
  }
}

/**
 * Programmable Fitness Simulator for Tests
 */
export class FitnessTestSimulator {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || 'ws://localhost:3112/ws';
    this.ws = null;
    this.connected = false;
    this.updateInterval = options.updateInterval || 2000; // ms between updates
    this.intervals = [];
    this.generators = new Map(); // userId -> HRPatternGenerator
    this.beatCounts = new Map(); // deviceId -> beat count
    this.onStateChange = options.onStateChange || null;
    this.verbose = options.verbose ?? true;
  }
  
  /**
   * Connect to WebSocket server
   */
  async connect() {
    if (this.connected) return;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);
      
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        if (this.verbose) console.log('🔗 Test simulator connected to WebSocket');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (this.onStateChange && msg.topic === 'fitness') {
            this.onStateChange(msg);
          }
        } catch {
          // Ignore parse errors
        }
      });
      
      this.ws.on('close', () => {
        this.connected = false;
        if (this.verbose) console.log('⚠️  Test simulator WebSocket closed');
      });
      
      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
  
  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.stopSimulation();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
  
  /**
   * Run a simulation scenario
   * @param {Object} scenario - Scenario configuration
   * @param {number} scenario.duration - Total duration in seconds
   * @param {Object} scenario.users - User HR configurations keyed by user alias (alice, bob, charlie)
   * @param {Object} [scenario.cadence] - Optional cadence device configurations
   * @returns {Promise} - Resolves when scenario completes
   */
  async runScenario(scenario) {
    if (!this.connected) {
      await this.connect();
    }
    
    const { duration, users = {}, cadence = {} } = scenario;
    
    if (this.verbose) {
      console.log(`🚀 Running test scenario: ${scenario.description || 'Custom'}`);
      console.log(`   Duration: ${duration}s, Users: ${Object.keys(users).join(', ')}`);
    }
    
    // Set up generators for each user
    this.generators.clear();
    for (const [alias, config] of Object.entries(users)) {
      const device = TEST_DEVICES[alias];
      if (!device) {
        console.warn(`⚠️  Unknown user alias: ${alias}`);
        continue;
      }
      
      // Handle preset patterns
      const resolvedConfig = typeof config === 'string' 
        ? { ...HR_PATTERNS[config] }
        : { ...config };
      
      const generator = new HRPatternGenerator(resolvedConfig);
      generator.setTotalDuration(duration);
      this.generators.set(alias, generator);
      this.beatCounts.set(device.deviceId, 0);
    }
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        if (elapsed >= duration) {
          this.stopSimulation();
          if (this.verbose) console.log('✅ Test scenario complete');
          resolve({ duration: elapsed, users: Object.keys(users) });
          return;
        }
        
        // Send HR data for each user
        for (const [alias, generator] of this.generators) {
          const device = TEST_DEVICES[alias];
          const hr = generator.getHR(elapsed);
          
          if (hr !== null) {
            this._sendHeartRate(device, hr, elapsed);
          }
          // null HR = dropout, don't send anything
        }
      }, this.updateInterval);
      
      this.intervals.push(interval);
    });
  }
  
  /**
   * Run a predefined governance test scenario
   * @param {string} scenarioName - Name from GOVERNANCE_SCENARIOS
   */
  async runGovernanceScenario(scenarioName) {
    const scenario = GOVERNANCE_SCENARIOS[scenarioName];
    if (!scenario) {
      throw new Error(`Unknown governance scenario: ${scenarioName}`);
    }
    return this.runScenario(scenario);
  }
  
  /**
   * Send a single HR reading (for manual control)
   */
  sendHR(userAlias, heartRate) {
    const device = TEST_DEVICES[userAlias];
    if (!device) {
      throw new Error(`Unknown user alias: ${userAlias}`);
    }
    this._sendHeartRate(device, heartRate, Date.now() / 1000);
  }
  
  /**
   * Stop all simulation intervals
   */
  stopSimulation() {
    this.intervals.forEach(i => clearInterval(i));
    this.intervals = [];
  }
  
  /**
   * Internal: Send heart rate data over WebSocket
   */
  _sendHeartRate(device, heartRate, elapsedSeconds) {
    if (!this.connected || !this.ws) return;
    
    const beatCount = (this.beatCounts.get(device.deviceId) || 0) + Math.round(heartRate / 30);
    this.beatCounts.set(device.deviceId, beatCount);
    
    const message = {
      topic: 'fitness',
      source: 'fitness-simulator',  // Backend expects 'fitness' or 'fitness-simulator'
      type: 'ant',
      timestamp: new Date().toISOString(),
      profile: 'HR',
      deviceId: device.deviceId,
      dongleIndex: 0,
      data: {
        ManId: 255,
        SerialNumber: device.deviceId,
        HwVersion: 5,
        SwVersion: 1,
        ModelNum: 2,
        BatteryLevel: 100,
        BatteryVoltage: 4.2,
        BatteryStatus: 'Good',
        DeviceID: device.deviceId,
        Channel: 0,
        BeatTime: Math.floor(elapsedSeconds * 1024) % 65536,
        BeatCount: beatCount,
        ComputedHeartRate: heartRate,
        PreviousBeat: Math.floor((elapsedSeconds - 1) * 1024) % 65536,
        OperatingTime: Math.floor(elapsedSeconds * 1000)
      }
    };
    
    this.ws.send(JSON.stringify(message));
    
    if (this.verbose) {
      console.log(`  💓 ${device.name}: ${heartRate} bpm`);
    }
  }
}

/**
 * Quick helper to run a scenario without managing simulator lifecycle
 */
export async function runTestScenario(scenario, options = {}) {
  const sim = new FitnessTestSimulator(options);
  try {
    await sim.connect();
    return await sim.runScenario(scenario);
  } finally {
    sim.disconnect();
  }
}

/**
 * Quick helper to run a governance scenario by name
 */
export async function runGovernanceTest(scenarioName, options = {}) {
  const sim = new FitnessTestSimulator(options);
  try {
    await sim.connect();
    return await sim.runGovernanceScenario(scenarioName);
  } finally {
    sim.disconnect();
  }
}

export default FitnessTestSimulator;
