#include "TiLinkTransport.h"
#include "SchoolCalcWire.h"

#include <esp_timer.h>
#include <string.h>

TiLinkTransport::TiLinkTransport(uint8_t tipSensePin, uint8_t tipSinkPin,
                                 uint8_t ringSensePin, uint8_t ringSinkPin,
                                 bool transmitEnabled)
  : tipSensePin_(tipSensePin), tipSinkPin_(tipSinkPin),
    ringSensePin_(ringSensePin), ringSinkPin_(ringSinkPin),
    transmitEnabled_(transmitEnabled) {}

void TiLinkTransport::begin() {
  pinMode(tipSensePin_, INPUT);
  pinMode(ringSensePin_, INPUT);
  release();
}

void TiLinkTransport::release() {
  // The external 100k pulldowns keep the MOSFETs off. INPUT avoids even a
  // momentary GPIO high output during ESP32 reset/reconfiguration.
  pinMode(tipSinkPin_, INPUT);
  pinMode(ringSinkPin_, INPUT);
}

bool TiLinkTransport::tipLow() const { return digitalRead(tipSensePin_) == LOW; }
bool TiLinkTransport::ringLow() const { return digitalRead(ringSensePin_) == LOW; }
bool TiLinkTransport::bothHigh() const { return !tipLow() && !ringLow(); }

void TiLinkTransport::assertTip() {
  digitalWrite(tipSinkPin_, HIGH); // high only drives the external FET gate
  pinMode(tipSinkPin_, OUTPUT);    // which pulls the calculator TIP low
}

void TiLinkTransport::assertRing() {
  digitalWrite(ringSinkPin_, HIGH); // high only drives the external FET gate
  pinMode(ringSinkPin_, OUTPUT);    // which pulls the calculator RING low
}

void TiLinkTransport::fail(Error error) {
  lastError_ = error;
  portENTER_CRITICAL(&metricsMux_);
  metrics_.errors++;
  metrics_.lastActivityMs = millis();
  switch (error) {
    case Error::EdgeTimeout: metrics_.edgeTimeouts++; break;
    case Error::BusBusy: metrics_.busBusyErrors++; break;
    case Error::Checksum: metrics_.checksumErrors++; break;
    case Error::UnexpectedPacket: metrics_.unexpectedPackets++; break;
    default: break;
  }
  portEXIT_CRITICAL(&metricsMux_);
  release();
}

void TiLinkTransport::recordPacket(bool outbound, uint8_t machineId,
                                   uint8_t command, uint16_t declaredLength,
                                   uint16_t dataLength, uint32_t encodedBytes) {
  portENTER_CRITICAL(&metricsMux_);
  if (outbound) {
    metrics_.packetsTx++;
    metrics_.bytesTx += encodedBytes;
  } else {
    metrics_.packetsRx++;
    metrics_.bytesRx += encodedBytes;
  }
  metrics_.lastActivityMs = millis();
  metrics_.lastPacketOutbound = outbound;
  metrics_.lastMachineId = machineId;
  metrics_.lastCommand = command;
  metrics_.lastDeclaredLength = declaredLength;
  metrics_.lastDataLength = dataLength;
  portEXIT_CRITICAL(&metricsMux_);
}

TiLinkTransport::Metrics TiLinkTransport::metrics() const {
  portENTER_CRITICAL(&metricsMux_);
  const Metrics snapshot = metrics_;
  portEXIT_CRITICAL(&metricsMux_);
  return snapshot;
}

void TiLinkTransport::reclassifyIdleTimeoutAsBusBusy() {
  // waitBothHigh already counted the underlying timeout. Add the public
  // operation classification without counting the same failed wait twice.
  lastError_ = Error::BusBusy;
  portENTER_CRITICAL(&metricsMux_);
  metrics_.busBusyErrors++;
  metrics_.lastActivityMs = millis();
  portEXIT_CRITICAL(&metricsMux_);
  release();
}

bool TiLinkTransport::waitBothHigh(uint32_t timeoutUs) {
  const int64_t deadline = esp_timer_get_time() + timeoutUs;
  while (!bothHigh()) {
    if (esp_timer_get_time() >= deadline) { fail(Error::EdgeTimeout); return false; }
  }
  return true;
}

bool TiLinkTransport::waitForOtherLow(bool sentTip, uint32_t timeoutUs) {
  const int64_t deadline = esp_timer_get_time() + timeoutUs;
  while (sentTip ? !ringLow() : !tipLow()) {
    if (esp_timer_get_time() >= deadline) { fail(Error::EdgeTimeout); return false; }
  }
  return true;
}

bool TiLinkTransport::waitForSenderRelease(bool senderTip, uint32_t timeoutUs) {
  const int64_t deadline = esp_timer_get_time() + timeoutUs;
  while (senderTip ? tipLow() : ringLow()) {
    if (esp_timer_get_time() >= deadline) { fail(Error::EdgeTimeout); return false; }
  }
  return true;
}

bool TiLinkTransport::sendBit(uint8_t bit) {
  if (!waitBothHigh(EDGE_TIMEOUT_US)) return false;
  const bool sendTip = bit == 0;  // TI sends 0 on tip/red; 1 on ring/white.
  if (sendTip) assertTip(); else assertRing();
  if (!waitForOtherLow(sendTip, EDGE_TIMEOUT_US)) return false;
  if (sendTip) pinMode(tipSinkPin_, INPUT); else pinMode(ringSinkPin_, INPUT);
  return waitBothHigh(EDGE_TIMEOUT_US);
}

bool TiLinkTransport::receiveStart(uint8_t& bit, uint32_t timeoutUs) {
  const int64_t deadline = esp_timer_get_time() + timeoutUs;
  while (bothHigh()) {
    if (esp_timer_get_time() >= deadline) { fail(Error::EdgeTimeout); return false; }
  }
  const bool tip = tipLow();
  const bool ring = ringLow();
  if (tip == ring) { fail(Error::InvalidEdge); return false; }
  bit = tip ? 0 : 1;
  return true;
}

bool TiLinkTransport::receiveBit(uint8_t& bit, uint32_t timeoutUs) {
  if (!receiveStart(bit, timeoutUs)) return false;
  const bool senderTip = bit == 0;
  if (senderTip) assertRing(); else assertTip();
  if (!waitForSenderRelease(senderTip, EDGE_TIMEOUT_US)) return false;
  if (senderTip) pinMode(ringSinkPin_, INPUT); else pinMode(tipSinkPin_, INPUT);
  return waitBothHigh(EDGE_TIMEOUT_US);
}

bool TiLinkTransport::sendByte(uint8_t value) {
  for (uint8_t bit = 0; bit < 8; ++bit) {
    if (!sendBit((value >> bit) & 1)) return false;
  }
  return true;
}

bool TiLinkTransport::receiveByte(uint8_t& value, uint32_t timeoutUs) {
  value = 0;
  for (uint8_t bit = 0; bit < 8; ++bit) {
    uint8_t received = 0;
    if (!receiveBit(received, bit == 0 ? timeoutUs : EDGE_TIMEOUT_US)) return false;
    value |= received << bit;
  }
  return true;
}

bool TiLinkTransport::sendPacket(uint8_t machineId, uint8_t command, const uint8_t* data, uint16_t length) {
  if (!sendByte(machineId) || !sendByte(command) || !sendByte(length & 0xff) || !sendByte(length >> 8)) return false;
  uint16_t checksum = 0;
  for (uint16_t i = 0; i < length; ++i) {
    checksum = static_cast<uint16_t>(checksum + data[i]);
    if (!sendByte(data[i])) return false;
  }
  if (length > 0 && (!sendByte(checksum & 0xff) || !sendByte(checksum >> 8))) return false;
  recordPacket(true, machineId, command, length, length,
               static_cast<uint32_t>(schoolcalc_wire::encodedPacketSize(command, length)));
  return true;
}

bool TiLinkTransport::receivePacket(uint8_t& machineId, uint8_t& command, uint8_t* data, uint16_t& length,
                                    uint16_t maxLength, uint32_t firstByteTimeoutUs) {
  if (!receiveByte(machineId, firstByteTimeoutUs) || !receiveByte(command, EDGE_TIMEOUT_US)) return false;
  uint8_t lo = 0, hi = 0;
  if (!receiveByte(lo, EDGE_TIMEOUT_US) || !receiveByte(hi, EDGE_TIMEOUT_US)) return false;
  length = static_cast<uint16_t>(lo | (static_cast<uint16_t>(hi) << 8));
  // ACK/CTS/ERR/EOT packets have no body even when the length field echoes the
  // preceding packet length. Treating an echoed ACK length as data deadlocks
  // silent variable transfers while waiting for bytes that do not exist.
  if (!schoolcalc_wire::commandCarriesData(command) || length == 0) {
    recordPacket(false, machineId, command, length, 0, 4);
    return true;
  }
  if (length > maxLength) { fail(Error::PacketTooLarge); return false; }
  uint16_t checksum = 0;
  for (uint16_t i = 0; i < length; ++i) {
    if (!receiveByte(data[i], EDGE_TIMEOUT_US)) return false;
    checksum = static_cast<uint16_t>(checksum + data[i]);
  }
  if (length == 0) return true;
  uint8_t sumLo = 0, sumHi = 0;
  if (!receiveByte(sumLo, EDGE_TIMEOUT_US) || !receiveByte(sumHi, EDGE_TIMEOUT_US)) return false;
  if (checksum != static_cast<uint16_t>(sumLo | (static_cast<uint16_t>(sumHi) << 8))) {
    fail(Error::Checksum); return false;
  }
  recordPacket(false, machineId, command, length, length,
               static_cast<uint32_t>(schoolcalc_wire::encodedPacketSize(command, length)));
  return true;
}

bool TiLinkTransport::receivePacketWithRetry(uint8_t& machineId, uint8_t& command,
                                              uint8_t* data, uint16_t& length,
                                              uint16_t maxLength,
                                              uint32_t firstByteTimeoutUs) {
  for (uint8_t attempt = 0; attempt <= MAX_PACKET_RETRIES; ++attempt) {
    if (receivePacket(machineId, command, data, length, maxLength, firstByteTimeoutUs)) {
      lastError_ = Error::None;
      return true;
    }
    if (lastError_ != Error::Checksum || attempt == MAX_PACKET_RETRIES) break;
    lastError_ = Error::None;
    if (!sendPacket(HOST_ID, CMD_ERR, nullptr, 0)) return false;
  }
  if (lastError_ == Error::Checksum) fail(Error::RetriesExhausted);
  return false;
}

bool TiLinkTransport::receiveTiControl(uint8_t& command, uint8_t* data,
                                       uint16_t& length, uint16_t maxLength) {
  uint8_t machineId = 0;
  if (!receivePacketWithRetry(machineId, command, data, length, maxLength, PACKET_TIMEOUT_US)) {
    return false;
  }
  if (machineId != TI86_ID) { fail(Error::UnexpectedPacket); return false; }
  return true;
}

bool TiLinkTransport::sendPacketAwaitAck(uint8_t command, const uint8_t* data,
                                         uint16_t length) {
  for (uint8_t attempt = 0; attempt <= MAX_PACKET_RETRIES; ++attempt) {
    if (!sendPacket(HOST_ID, command, data, length)) return false;
    uint8_t responseCommand = 0;
    uint16_t responseLength = 0;
    if (!receiveTiControl(responseCommand, nullptr, responseLength)) return false;
    if (responseCommand == CMD_ACK) return true;
    if (responseCommand != CMD_ERR) { fail(Error::UnexpectedPacket); return false; }
  }
  fail(Error::RetriesExhausted);
  return false;
}

bool TiLinkTransport::sendStringDataAwaitAck(const uint8_t* payload,
                                             uint16_t payloadLength) {
  const uint16_t dataLength = static_cast<uint16_t>(payloadLength + 2);
  const uint8_t lengthLow = static_cast<uint8_t>(payloadLength & 0xFF);
  const uint8_t lengthHigh = static_cast<uint8_t>(payloadLength >> 8);
  for (uint8_t attempt = 0; attempt <= MAX_PACKET_RETRIES; ++attempt) {
    if (!sendByte(HOST_ID) || !sendByte(CMD_DATA)
        || !sendByte(dataLength & 0xFF) || !sendByte(dataLength >> 8)
        || !sendByte(lengthLow) || !sendByte(lengthHigh)) return false;
    uint16_t checksum = static_cast<uint16_t>(lengthLow + lengthHigh);
    for (uint16_t index = 0; index < payloadLength; ++index) {
      checksum = static_cast<uint16_t>(checksum + payload[index]);
      if (!sendByte(payload[index])) return false;
    }
    if (!sendByte(checksum & 0xFF) || !sendByte(checksum >> 8)) return false;
    recordPacket(true, HOST_ID, CMD_DATA, dataLength, dataLength,
                 static_cast<uint32_t>(dataLength) + 6);
    uint8_t responseCommand = 0;
    uint16_t responseLength = 0;
    if (!receiveTiControl(responseCommand, nullptr, responseLength)) return false;
    if (responseCommand == CMD_ACK) return true;
    if (responseCommand != CMD_ERR) { fail(Error::UnexpectedPacket); return false; }
  }
  fail(Error::RetriesExhausted);
  return false;
}

bool TiLinkTransport::captureScreenshot(uint8_t output[1024]) {
  lastError_ = Error::None;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (!waitBothHigh(EDGE_TIMEOUT_US)) { reclassifyIdleTimeoutAsBusBusy(); return false; }

  // Documented silent screenshot transaction:
  // 06 6D 00 00 -> 86 56 00 00 -> 86 15 00 04 + 1024 bytes + sum -> 06 56 00 00
  if (!sendPacket(HOST_ID, CMD_SCREENSHOT, nullptr, 0)) return false;
  uint8_t machineId = 0, command = 0;
  uint16_t length = 0;
  if (!receivePacket(machineId, command, nullptr, length, 0, PACKET_TIMEOUT_US)) return false;
  if (machineId != TI86_ID || command != CMD_ACK || length != 0) { fail(Error::UnexpectedPacket); return false; }
  if (!receivePacket(machineId, command, output, length, MAX_PACKET_BYTES, PACKET_TIMEOUT_US)) return false;
  if (machineId != TI86_ID || command != CMD_DATA || length != 1024) { fail(Error::UnexpectedPacket); return false; }
  if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;
  release();
  return true;
}

bool TiLinkTransport::readStringVariable(const char* name, uint8_t* output,
                                         uint16_t outputCapacity,
                                         uint16_t& outputLength, bool& found) {
  lastError_ = Error::None;
  outputLength = 0;
  found = false;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (output == nullptr || outputCapacity < 2) { fail(Error::BufferTooSmall); return false; }
  if (!waitBothHigh(EDGE_TIMEOUT_US)) { reclassifyIdleTimeoutAsBusBusy(); return false; }

  uint8_t requestHeader[schoolcalc_wire::PADDED_VARIABLE_HEADER_BYTES];
  if (schoolcalc_wire::encodePaddedVariableHeader(
        0, schoolcalc_wire::TYPE_STRING, name, requestHeader)
      != schoolcalc_wire::DecodeStatus::Ok) {
    fail(Error::InvalidVariable); return false;
  }
  if (!sendPacketAwaitAck(CMD_REQ, requestHeader, sizeof(requestHeader))) return false;

  uint8_t headerBytes[schoolcalc_wire::PADDED_VARIABLE_HEADER_BYTES];
  uint8_t command = 0;
  uint16_t headerLength = 0;
  if (!receiveTiControl(command, headerBytes, headerLength, sizeof(headerBytes))) return false;
  if (command == CMD_EXIT) {
    if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;
    lastError_ = Error::NotFound;
    release();
    return true;
  }
  if (command != schoolcalc_wire::CMD_VAR) { fail(Error::UnexpectedPacket); return false; }

  schoolcalc_wire::VariableHeader header{};
  if (schoolcalc_wire::decodeVariableHeader(headerBytes, headerLength, header)
        != schoolcalc_wire::DecodeStatus::Ok
      || header.type != schoolcalc_wire::TYPE_STRING
      || strcmp(header.name, name) != 0) {
    fail(Error::InvalidVariable); return false;
  }
  if (header.dataLength > outputCapacity) { fail(Error::BufferTooSmall); return false; }
  if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)
      || !sendPacketAwaitAck(CMD_CTS, nullptr, 0)) return false;

  uint16_t variableDataLength = 0;
  if (!receiveTiControl(command, output, variableDataLength, outputCapacity)) return false;
  if (command != CMD_DATA || variableDataLength != header.dataLength) {
    fail(Error::UnexpectedPacket); return false;
  }
  const uint8_t* payload = nullptr;
  uint16_t payloadLength = 0;
  if (schoolcalc_wire::unwrapStringPayload(
        output, variableDataLength, payload, payloadLength)
      != schoolcalc_wire::DecodeStatus::Ok) {
    fail(Error::InvalidVariable); return false;
  }
  memmove(output, payload, payloadLength);
  outputLength = payloadLength;
  found = true;
  if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;
  lastError_ = Error::None;
  release();
  return true;
}

bool TiLinkTransport::writeStringVariable(const char* name, const uint8_t* payload,
                                          uint16_t payloadLength) {
  lastError_ = Error::None;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (payloadLength > 0 && payload == nullptr) { fail(Error::InvalidVariable); return false; }
  if (payloadLength > 0xFFFD) { fail(Error::PacketTooLarge); return false; }
  if (!waitBothHigh(EDGE_TIMEOUT_US)) { reclassifyIdleTimeoutAsBusBusy(); return false; }

  const uint16_t variableDataLength = static_cast<uint16_t>(payloadLength + 2);
  uint8_t header[schoolcalc_wire::PADDED_VARIABLE_HEADER_BYTES];
  if (schoolcalc_wire::encodePaddedVariableHeader(
        variableDataLength, schoolcalc_wire::TYPE_STRING, name, header)
      != schoolcalc_wire::DecodeStatus::Ok) {
    fail(Error::InvalidVariable); return false;
  }
  if (!sendPacketAwaitAck(CMD_RTS, header, sizeof(header))) return false;

  uint8_t command = 0;
  uint8_t rejection[1] = { 0 };
  uint16_t responseLength = 0;
  if (!receiveTiControl(command, rejection, responseLength, sizeof(rejection))) return false;
  if (command == CMD_EXIT) {
    const uint8_t reason = responseLength == 1 ? rejection[0] : 0;
    if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;
    fail(reason == 0x03 ? Error::OutOfMemory : Error::Rejected);
    return false;
  }
  if (command != CMD_CTS) { fail(Error::UnexpectedPacket); return false; }
  if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;

  // Emit the TI String length and immutable payload directly into the packet;
  // a second artifact-sized heap buffer would make large transfers fragile.
  if (!sendStringDataAwaitAck(payload, payloadLength)) return false;
  if (!sendPacket(HOST_ID, CMD_EOT, nullptr, 0)) return false;
  lastError_ = Error::None;
  release();
  return true;
}

bool TiLinkTransport::sendRemoteKey(uint8_t scanCode) {
  lastError_ = Error::None;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (!waitBothHigh(EDGE_TIMEOUT_US)) { reclassifyIdleTimeoutAsBusBusy(); return false; }

  uint8_t packet[4];
  schoolcalc_wire::encodeDirectKeyCommand(scanCode, packet);
  for (uint8_t index = 0; index < sizeof(packet); ++index) {
    if (!sendByte(packet[index])) return false;
  }
  recordPacket(true, HOST_ID, CMD_KEY, scanCode, 0, sizeof(packet));

  // TI-85/86 Silent Link acknowledges a remote key twice. The length/status
  // field may be non-zero but ACK never carries a body; receivePacket already
  // applies that documented control-packet rule.
  for (uint8_t acknowledgement = 0; acknowledgement < 2; ++acknowledgement) {
    uint8_t command = 0;
    uint16_t status = 0;
    if (!receiveTiControl(command, nullptr, status) || command != CMD_ACK) {
      if (lastError_ == Error::None) fail(Error::UnexpectedPacket);
      return false;
    }
  }
  lastError_ = Error::None;
  release();
  return true;
}

bool TiLinkTransport::sendForegroundFrame(const uint8_t* frame,
                                          uint16_t frameLength) {
  lastError_ = Error::None;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (frame == nullptr || frameLength == 0 || frameLength > MAX_PACKET_BYTES) {
    fail(Error::PacketTooLarge);
    return false;
  }
  if (!waitBothHigh(EDGE_TIMEOUT_US)) { reclassifyIdleTimeoutAsBusBusy(); return false; }
  if (!sendPacketAwaitAck(CMD_DATA, frame, frameLength)) return false;
  lastError_ = Error::None;
  release();
  return true;
}

bool TiLinkTransport::receiveForegroundFrame(uint8_t* output,
                                             uint16_t outputCapacity,
                                             uint16_t& outputLength) {
  lastError_ = Error::None;
  outputLength = 0;
  release();
  if (!transmitEnabled_) { fail(Error::Disabled); return false; }
  if (output == nullptr || outputCapacity == 0) {
    fail(Error::BufferTooSmall);
    return false;
  }
  uint8_t command = 0;
  if (!receiveTiControl(command, output, outputLength, outputCapacity)) return false;
  if (command != CMD_DATA || outputLength == 0) {
    fail(Error::UnexpectedPacket);
    return false;
  }
  if (!sendPacket(HOST_ID, CMD_ACK, nullptr, 0)) return false;
  lastError_ = Error::None;
  release();
  return true;
}

const char* TiLinkTransport::lastErrorText() const {
  switch (lastError_) {
    case Error::None: return "none";
    case Error::Disabled: return "transmit disabled in relay configuration";
    case Error::BusBusy: return "TI lines were not both idle/high before transmit";
    case Error::EdgeTimeout: return "timed out waiting for TI link handshake edge";
    case Error::InvalidEdge: return "invalid TI link edge: both lines asserted or released";
    case Error::PacketTooLarge: return "received TI packet exceeds configured test buffer";
    case Error::Checksum: return "TI packet data checksum failed";
    case Error::UnexpectedPacket: return "unexpected TI packet during link transaction";
    case Error::InvalidVariable: return "TI variable header or String payload is invalid";
    case Error::BufferTooSmall: return "TI variable exceeds the relay buffer";
    case Error::NotFound: return "TI variable does not exist";
    case Error::Rejected: return "TI calculator rejected the variable transfer";
    case Error::OutOfMemory: return "TI calculator reported out of memory";
    case Error::RetriesExhausted: return "TI packet checksum retry limit was exhausted";
  }
  return "unknown";
}
