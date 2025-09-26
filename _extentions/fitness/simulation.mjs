#!/usr/bin/env node

import WebSocket from 'ws';

// Configuration
const DAYLIGHT_HOST = process.env.DAYLIGHT_HOST || 'localhost';
const DAYLIGHT_PORT = process.env.DAYLIGHT_PORT || 3112;
const SIMULATION_DURATION = 60 * 1000; // 1 minute in milliseconds
const UPDATE_INTERVAL = 2000; // Send data every 2 seconds

// Simulated device data for 2 people with 2 sensors each
const devices = [
  // Person 1 - Heart Rate Monitor
  {
    deviceId: 12345,
    profile: 'HR',
    type: 'heart_rate',
    serialNumber: 12345,
    baseHeartRate: 75,
    variability: 15,
    batteryLevel: 85,
    beatCount: 0
  },
  // Person 1 - Speed Sensor  
  {
    deviceId: 23456,
    profile: 'SPD', 
    type: 'speed',
    serialNumber: 23456,
    baseSpeed: 25, // km/h
    variability: 5,
    batteryLevel: 92,
    revolutionCount: 0,
    distance: 0
  },
  // Person 2 - Heart Rate Monitor
  {
    deviceId: 34567,
    profile: 'HR',
    type: 'heart_rate', 
    serialNumber: 34567,
    baseHeartRate: 68,
    variability: 12,
    batteryLevel: 78,
    beatCount: 0
  },
  // Person 2 - Power Meter with Cadence
  {
    deviceId: 45678,
    profile: 'PWR',
    type: 'power',
    serialNumber: 45678,
    basePower: 180,
    powerVariability: 30,
    baseCadence: 85,
    cadenceVariability: 10,
    batteryLevel: 65,
    revolutionCount: 0
  }
];

class FitnessSimulator {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.startTime = Date.now();
    this.intervals = [];
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

  sendFitnessData(deviceData) {
    if (!this.connected || !this.ws) return;

    const message = {
      topic: 'fitness',
      source: 'fitness-simulator',
      type: 'ant',
      timestamp: new Date().toISOString(),
      profile: deviceData.profile,
      deviceId: deviceData.deviceId,
      dongleIndex: 0, // Simulated dongle
      data: deviceData.data
    };

    this.ws.send(JSON.stringify(message));
    console.log(`📊 Sent ${deviceData.profile} data for device ${deviceData.deviceId}`);
  }

  generateHeartRateData(device, elapsedSeconds) {
    // Simulate workout intensity curve (starts low, builds up, then steady)
    let intensityFactor = 1.0;
    if (elapsedSeconds < 10) {
      intensityFactor = 0.7 + (elapsedSeconds / 10) * 0.3; // Warm up
    } else if (elapsedSeconds > 45) {
      intensityFactor = 1.1; // High intensity finish
    }

    const targetHR = Math.round(device.baseHeartRate * intensityFactor);
    const variation = (Math.random() - 0.5) * device.variability;
    const heartRate = Math.max(50, Math.round(targetHR + variation));
    
    device.beatCount += Math.round(heartRate / 30); // Approximate beats in 2 seconds
    const beatTime = (elapsedSeconds * 1024) % 65536; // ANT+ beat time format

    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      HwVersion: 5,
      SwVersion: 1,
      ModelNum: 2,
      BatteryLevel: device.batteryLevel,
      BatteryVoltage: 4.15625,
      BatteryStatus: "Good",
      DeviceID: device.deviceId,
      Channel: 0,
      BeatTime: beatTime,
      BeatCount: device.beatCount,
      ComputedHeartRate: heartRate,
      PreviousBeat: beatTime - 1024,
      OperatingTime: elapsedSeconds * 1000
    };
  }

  generateSpeedData(device, elapsedSeconds) {
    // Simulate varying speed during workout
    let speedFactor = 1.0;
    if (elapsedSeconds < 15) {
      speedFactor = 0.6 + (elapsedSeconds / 15) * 0.4; // Gradual speed increase
    } else if (elapsedSeconds > 45) {
      speedFactor = 1.2; // Sprint finish
    }

    const targetSpeed = device.baseSpeed * speedFactor;
    const variation = (Math.random() - 0.5) * device.variability;
    const speedKmh = Math.max(5, targetSpeed + variation);
    const speedMs = speedKmh / 3.6;
    
    // Update cumulative values
    device.distance += speedMs * 2; // 2 second intervals
    device.revolutionCount += Math.round(speedMs * 2 / 2.1); // Assume ~2.1m wheel circumference
    
    const eventTime = (elapsedSeconds * 1024) % 65536; // ANT+ event time format

    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      BatteryStatus: "Good",
      BatteryLevel: device.batteryLevel,
      DeviceID: device.deviceId,
      Channel: 0,
      SpeedEventTime: eventTime,
      CumulativeSpeedRevolutionCount: device.revolutionCount,
      CalculatedDistance: Math.round(device.distance),
      CalculatedSpeed: parseFloat(speedMs.toFixed(2))
    };
  }

  generatePowerData(device, elapsedSeconds) {
    // Simulate power curve with intervals
    let powerFactor = 1.0;
    let cadenceFactor = 1.0;
    
    // Create interval training pattern
    const intervalPhase = Math.floor(elapsedSeconds / 15) % 3;
    if (intervalPhase === 0) {
      powerFactor = 0.7; // Recovery
      cadenceFactor = 0.9;
    } else if (intervalPhase === 1) {
      powerFactor = 1.3; // High intensity
      cadenceFactor = 1.1;
    } else {
      powerFactor = 1.0; // Steady state
      cadenceFactor = 1.0;
    }

    const targetPower = device.basePower * powerFactor;
    const powerVariation = (Math.random() - 0.5) * device.powerVariability;
    const power = Math.max(50, Math.round(targetPower + powerVariation));
    
    const targetCadence = device.baseCadence * cadenceFactor;
    const cadenceVariation = (Math.random() - 0.5) * device.cadenceVariability;
    const cadence = Math.max(60, Math.round(targetCadence + cadenceVariation));
    
    device.revolutionCount += Math.round(cadence / 30); // Approximate revolutions in 2 seconds

    return {
      ManId: 255,
      SerialNumber: device.serialNumber,
      BatteryStatus: "Good", 
      BatteryLevel: device.batteryLevel,
      DeviceID: device.deviceId,
      Channel: 0,
      InstantaneousPower: power,
      Cadence: cadence,
      PedalPowerBalance: 50, // Balanced pedaling
      CumulativeCrankRevolutionCount: device.revolutionCount,
      EventCount: Math.floor(elapsedSeconds / 2)
    };
  }

  startSimulation() {
    console.log(`🚀 Starting fitness simulation for ${SIMULATION_DURATION / 1000} seconds`);
    console.log(`📊 Simulating ${devices.length} devices:`);
    
    devices.forEach(device => {
      console.log(`  - Device ${device.deviceId}: ${device.profile} (${device.type})`);
    });
    
    // Set up intervals for each device
    devices.forEach(device => {
      const interval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        
        let data;
        if (device.type === 'heart_rate') {
          data = this.generateHeartRateData(device, elapsedSeconds);
        } else if (device.type === 'speed') {
          data = this.generateSpeedData(device, elapsedSeconds);
        } else if (device.type === 'power') {
          data = this.generatePowerData(device, elapsedSeconds);
        }
        
        if (data) {
          this.sendFitnessData({
            profile: device.profile,
            deviceId: device.deviceId,
            data: data
          });
        }
      }, UPDATE_INTERVAL);
      
      this.intervals.push(interval);
    });

    // Stop simulation after duration
    setTimeout(() => {
      this.stopSimulation();
    }, SIMULATION_DURATION);
  }

  stopSimulation() {
    console.log('🛑 Stopping fitness simulation');
    
    // Clear all intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
    }
    
    // Print summary
    console.log('\n📈 Simulation Summary:');
    devices.forEach(device => {
      if (device.type === 'heart_rate') {
        console.log(`  Heart Rate ${device.deviceId}: ${device.beatCount} beats total`);
      } else if (device.type === 'speed') {
        console.log(`  Speed ${device.deviceId}: ${(device.distance / 1000).toFixed(2)}km distance`);
      } else if (device.type === 'power') {
        console.log(`  Power ${device.deviceId}: ${device.revolutionCount} crank revolutions`);
      }
    });
    
    console.log('\n✅ Simulation complete!');
    process.exit(0);
  }
}

// Main execution
async function main() {
  console.log('🎯 ANT+ Fitness Data Simulator');
  console.log('===============================');
  
  const simulator = new FitnessSimulator();
  
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
