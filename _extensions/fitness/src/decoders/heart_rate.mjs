/**
 * BLE Heart Rate Measurement Decoder (GATT 0x2A37)
 *
 * Parses standard BLE HR Measurement characteristic packets.
 *
 * Packet format:
 *   Byte 0: Flags
 *     - Bit 0: HR format (0 = UINT8, 1 = UINT16)
 *     - Bits 1-2: Sensor contact status
 *   Byte 1 (or 1-2): Heart rate value
 *   Remaining: RR-intervals (optional, ignored)
 */
export class BleHeartRateDecoder {
  constructor() {
    this.lastHR = 0;
    this.sensorContact = false;
    this.lastPacketTime = null;
  }

  processPacket(data) {
    if (!data || data.length < 2) return null;

    const flags = data[0];
    const isUint16 = flags & 0x01;
    const sensorContactSupported = (flags >> 1) & 0x01;
    const sensorContactDetected = (flags >> 2) & 0x01;

    let hr;
    if (isUint16) {
      if (data.length < 3) return null;
      hr = data[1] | (data[2] << 8);
    } else {
      hr = data[1];
    }

    if (hr === 0 || hr > 250) return null;

    this.lastHR = hr;
    this.sensorContact = sensorContactSupported ? !!sensorContactDetected : true;
    this.lastPacketTime = Date.now();

    return {
      hr: this.lastHR,
      sensorContact: this.sensorContact,
      timestamp: new Date().toISOString()
    };
  }

  formatForWebSocket(userId) {
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ant',
      profile: 'HR',
      deviceId: `ble_${userId}`,
      timestamp: new Date().toISOString(),
      data: {
        ComputedHeartRate: this.lastHR,
        sensorContact: this.sensorContact,
        source: 'ble'
      }
    };
  }

  reset() {
    this.lastHR = 0;
    this.sensorContact = false;
    this.lastPacketTime = null;
  }
}
