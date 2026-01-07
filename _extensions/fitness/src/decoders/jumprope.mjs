/**
 * RENPHO Jumprope BLE Decoder
 * Direction-agnostic revolution tracking for RENPHO R-Q008
 *
 * Key insight: The raw counter can count UP or DOWN depending on device mode.
 * We detect ANY change as a revolution event.
 */

export class RenphoJumpropeDecoder {
  constructor() {
    this.lastRawCounter = null;
    this.totalRevolutions = 0;
    this.connectionStartTime = null;
    this.lastPacketTime = null;
    this.pendingCarryover = 0;
  }

  /**
   * Process a raw BLE packet and extract revolution count
   * @param {Uint8Array} data - Raw BLE packet data
   * @returns {{revolutions: number, timestamp: string}|null}
   */
  processPacket(data) {
    const decoded = this.decode(data);
    if (!decoded || decoded.type !== 'main') return null;

    const rawCounter = decoded.jumpCount;
    const now = Date.now();
    this.lastPacketTime = now;

    if (this.connectionStartTime === null) {
      this.connectionStartTime = now;
    }

    if (this.lastRawCounter === null) {
      this.pendingCarryover = rawCounter <= 50 ? rawCounter : 0;
      this.lastRawCounter = rawCounter;
      return this._formatOutput();
    }

    if (rawCounter === this.lastRawCounter) {
      if (this.pendingCarryover > 0) {
        this.totalRevolutions = this.pendingCarryover;
        this.pendingCarryover = 0;
      }
      return this._formatOutput();
    }

    const delta = Math.abs(rawCounter - this.lastRawCounter);

    if (delta > 100) {
      this.totalRevolutions = 0;
      this.pendingCarryover = 0;
      this.totalRevolutions += 1;
    } else {
      this.totalRevolutions += delta;
      this.pendingCarryover = 0;
    }

    this.lastRawCounter = rawCounter;

    return this._formatOutput();
  }

  /**
   * Decode raw BLE packet
   * @param {Uint8Array} data
   * @returns {{type: string, sequenceNum: number, jumpCount: number, rawHex: string}|null}
   */
  decode(data) {
    if (!data || data.length === 0) return null;

    const packetType = data[0];

    if (packetType === 0xAD && data.length >= 20) {
      return this._decodeMainPacket(data);
    }
    if (packetType === 0xAF && data.length >= 8) {
      return this._decodeSecondaryPacket(data);
    }

    return null;
  }

  _decodeMainPacket(data) {
    // Main data packet (0xAD prefix, 20 bytes)
    // [0]: 0xAD (packet type)
    // [1]: Sequence number
    // [10-11]: Timer (not RPM)
    // [14-15]: Jump counter (little-endian, direction-dependent)
    const sequenceNum = data[1];
    const jumpCount = data[14] | (data[15] << 8);

    return {
      type: 'main',
      sequenceNum,
      jumpCount,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  _decodeSecondaryPacket(data) {
    return {
      type: 'secondary',
      sequenceNum: data[1],
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  _formatOutput() {
    return {
      revolutions: this.totalRevolutions,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format for WebSocket broadcast - minimal payload
   */
  formatForWebSocket(deviceConfig) {
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ble_jumprope',
      deviceId: deviceConfig.address,
      deviceName: deviceConfig.name,
      timestamp: new Date().toISOString(),
      data: {
        revolutions: this.totalRevolutions
      }
    };
  }

  /**
   * Reset state on BLE disconnect
   */
  reset() {
    this.lastRawCounter = null;
    this.totalRevolutions = 0;
    this.connectionStartTime = null;
    this.lastPacketTime = null;
    this.pendingCarryover = 0;
  }

  /**
   * Get current revolution count
   */
  getRevolutions() {
    return this.totalRevolutions;
  }
}
