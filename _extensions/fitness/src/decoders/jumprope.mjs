/**
 * RENPHO Jumprope BLE Decoder
 * Decodes data packets from RENPHO R-Q008 jumprope
 */

export class RenphoJumpropeDecoder {
  constructor() {
    this.sessionData = {
      startTime: null,
      endTime: null,
      totalJumps: 0,
      maxRPM: 0,
      avgRPM: 0,
      rpmReadings: [],
      duration: 0
    };
  }

  decodeMainPacket(data) {
    // Main data packet (0xAD prefix, 20 bytes)
    // Format analysis:
    // [0]: 0xAD (packet type)
    // [1]: Jump sequence counter
    // [10-11]: RPM - rope rotations per minute (little-endian)
    // [14-15]: Total jumps counter (little-endian)
    
    const sequenceNum = data[1];
    const rpm = data[10] | (data[11] << 8);
    const jumpCount = data[14] | (data[15] << 8);
    const estimatedCalories = Math.round(jumpCount * 0.1);
    
    return {
      type: 'main',
      sequenceNum,
      rpm,
      jumpCount,
      estimatedCalories,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  decodeSecondaryPacket(data) {
    // Secondary packet (0xAF prefix, 8 bytes)
    const sequenceNum = data[1];
    return {
      type: 'secondary',
      sequenceNum,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  decode(data) {
    if (data.length === 0) return null;
    
    const packetType = data[0];
    
    if (packetType === 0xAD && data.length >= 20) {
      return this.decodeMainPacket(data);
    } else if (packetType === 0xAF && data.length >= 8) {
      return this.decodeSecondaryPacket(data);
    }
    
    return null;
  }

  updateSession(decodedData) {
    if (!decodedData || decodedData.type !== 'main') return;
    
    const { rpm, jumpCount } = decodedData;
    
    // Initialize session on first packet
    if (!this.sessionData.startTime) {
      this.sessionData.startTime = new Date().toISOString();
      console.log('🏃 Jump rope workout session started!');
    }
    
    // Update session data
    this.sessionData.totalJumps = jumpCount;
    
    if (rpm > 0 && rpm < 300) {
      this.sessionData.rpmReadings.push(rpm);
      this.sessionData.maxRPM = Math.max(this.sessionData.maxRPM, rpm);
      
      // Calculate average
      const sum = this.sessionData.rpmReadings.reduce((a, b) => a + b, 0);
      this.sessionData.avgRPM = Math.round(sum / this.sessionData.rpmReadings.length);
    }
    
    // Calculate duration
    if (this.sessionData.startTime) {
      const start = new Date(this.sessionData.startTime);
      this.sessionData.duration = Math.round((Date.now() - start) / 1000);
    }
  }

  formatForWebSocket(deviceConfig) {
    // Format data to match the fitness server's expected format
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ble_jumprope',
      deviceId: deviceConfig.address,
      deviceName: deviceConfig.name,
      timestamp: new Date().toISOString(),
      data: {
        jumps: this.sessionData.totalJumps,
        rpm: this.sessionData.rpmReadings.slice(-1)[0] || 0,
        avgRPM: this.sessionData.avgRPM,
        maxRPM: this.sessionData.maxRPM,
        duration: this.sessionData.duration,
        calories: Math.round(this.sessionData.totalJumps * 0.1)
      }
    };
  }

  getSessionData() {
    return {
      ...this.sessionData,
      calories: Math.round(this.sessionData.totalJumps * 0.1)
    };
  }
}
