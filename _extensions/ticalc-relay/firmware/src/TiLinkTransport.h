#pragma once

#include <Arduino.h>

// TI calculator 2-wire link transport. The ESP32 only ever drives external
// open-drain sink gates. `release()` makes both gate pins inputs so their
// hardware pulldowns keep the calculator lines high-impedance during reset.
class TiLinkTransport {
public:
  enum class Error : uint8_t {
    None,
    Disabled,
    BusBusy,
    EdgeTimeout,
    InvalidEdge,
    PacketTooLarge,
    Checksum,
    UnexpectedPacket,
    InvalidVariable,
    BufferTooSmall,
    NotFound,
    Rejected,
    OutOfMemory,
    RetriesExhausted,
  };

  struct Metrics {
    uint32_t packetsTx = 0;
    uint32_t packetsRx = 0;
    uint32_t bytesTx = 0;
    uint32_t bytesRx = 0;
    uint32_t errors = 0;
    uint32_t edgeTimeouts = 0;
    uint32_t busBusyErrors = 0;
    uint32_t checksumErrors = 0;
    uint32_t unexpectedPackets = 0;
    uint32_t lastActivityMs = 0;
    bool lastPacketOutbound = false;
    uint8_t lastMachineId = 0;
    uint8_t lastCommand = 0;
    uint16_t lastDeclaredLength = 0;
    uint16_t lastDataLength = 0;
  };

  TiLinkTransport(uint8_t tipSensePin, uint8_t tipSinkPin,
                  uint8_t ringSensePin, uint8_t ringSinkPin,
                  bool transmitEnabled);

  void begin();
  void release();
  bool captureScreenshot(uint8_t output[1024]);
  // SchoolCalc variables are ordinary TI-86 String variables (type 0Ch).
  // `readStringVariable` strips the TI string's u16 length and returns only the
  // adapter-owned payload. A missing optional variable is a successful call
  // with `found == false`; protocol or integrity errors return false.
  bool readStringVariable(const char* name, uint8_t* output,
                          uint16_t outputCapacity, uint16_t& outputLength,
                          bool& found);
  bool writeStringVariable(const char* name, const uint8_t* payload,
                           uint16_t payloadLength);
  // Inject one published TI-86 direct-key scan code. Success requires both
  // acknowledgements emitted by the TI-86; callers must retain queued input
  // until this returns true.
  bool sendRemoteKey(uint8_t scanCode);
  // Cooperative SchoolCalc mode carries one already-encoded SCF1 frame in
  // one ordinary TI DATA packet. TI packet ACK/retry remains below this seam.
  bool sendForegroundFrame(const uint8_t* frame, uint16_t frameLength);
  bool receiveForegroundFrame(uint8_t* output, uint16_t outputCapacity,
                              uint16_t& outputLength);

  Error lastError() const { return lastError_; }
  const char* lastErrorText() const;
  Metrics metrics() const;

private:
  static constexpr uint8_t HOST_ID = 0x06;
  static constexpr uint8_t TI86_ID = 0x86;
  static constexpr uint8_t CMD_ACK = 0x56;
  static constexpr uint8_t CMD_DATA = 0x15;
  static constexpr uint8_t CMD_CTS = 0x09;
  static constexpr uint8_t CMD_EXIT = 0x36;
  static constexpr uint8_t CMD_ERR = 0x5A;
  static constexpr uint8_t CMD_SCREENSHOT = 0x6D;
  static constexpr uint8_t CMD_KEY = 0x87;
  static constexpr uint8_t CMD_EOT = 0x92;
  static constexpr uint8_t CMD_REQ = 0xA2;
  static constexpr uint8_t CMD_RTS = 0xC9;
  static constexpr uint32_t EDGE_TIMEOUT_US = 1000000;
  static constexpr uint32_t PACKET_TIMEOUT_US = 3000000;
  static constexpr uint16_t MAX_PACKET_BYTES = 1024;
  static constexpr uint8_t MAX_PACKET_RETRIES = 2;

  uint8_t tipSensePin_, tipSinkPin_, ringSensePin_, ringSinkPin_;
  bool transmitEnabled_;
  Error lastError_ = Error::None;
  mutable portMUX_TYPE metricsMux_ = portMUX_INITIALIZER_UNLOCKED;
  Metrics metrics_{};

  bool tipLow() const;
  bool ringLow() const;
  bool bothHigh() const;
  void assertTip();
  void assertRing();
  bool waitBothHigh(uint32_t timeoutUs);
  bool waitForOtherLow(bool sentTip, uint32_t timeoutUs);
  bool waitForSenderRelease(bool senderTip, uint32_t timeoutUs);
  bool receiveStart(uint8_t& bit, uint32_t timeoutUs);
  bool sendBit(uint8_t bit);
  bool receiveBit(uint8_t& bit, uint32_t timeoutUs);
  bool sendByte(uint8_t value);
  bool receiveByte(uint8_t& value, uint32_t timeoutUs);
  bool sendPacket(uint8_t machineId, uint8_t command, const uint8_t* data, uint16_t length);
  bool receivePacket(uint8_t& machineId, uint8_t& command, uint8_t* data, uint16_t& length,
                     uint16_t maxLength, uint32_t firstByteTimeoutUs);
  bool receivePacketWithRetry(uint8_t& machineId, uint8_t& command, uint8_t* data,
                              uint16_t& length, uint16_t maxLength,
                              uint32_t firstByteTimeoutUs);
  bool sendPacketAwaitAck(uint8_t command, const uint8_t* data, uint16_t length);
  bool sendStringDataAwaitAck(const uint8_t* payload, uint16_t payloadLength);
  bool receiveTiControl(uint8_t& command, uint8_t* data, uint16_t& length,
                        uint16_t maxLength = 0);
  void recordPacket(bool outbound, uint8_t machineId, uint8_t command,
                    uint16_t declaredLength, uint16_t dataLength,
                    uint32_t encodedBytes);
  void reclassifyIdleTimeoutAsBusBusy();
  void fail(Error error);
};
