#include "TilemHostArduinoShim.h"

#include "Arduino.h"
#include "TilemBlackLinkBridge.h"
#include "esp_timer.h"

#include <chrono>
#include <thread>

namespace {

using Clock = std::chrono::steady_clock;
const Clock::time_point startedAt = Clock::now();

struct Pins {
  schoolcalc_tilem::TilemBlackLinkBridge* bridge = nullptr;
  uint8_t tipSense = 0;
  uint8_t tipSink = 0;
  uint8_t ringSense = 0;
  uint8_t ringSink = 0;
  bool tipSinkOutput = false;
  bool ringSinkOutput = false;
  bool tipSinkValue = false;
  bool ringSinkValue = false;
  uint8_t hostByte = 0;
  uint8_t hostByteBits = 0;
  uint8_t hostCommand = 0;
  uint8_t hostLengthLow = 0;
  uint16_t hostPacketBytes = 0;
  uint16_t hostPacketExpectedBytes = 0;
} pins;

void applyTip() {
  if (pins.bridge != nullptr) pins.bridge->setRelayTipAsserted(pins.tipSinkOutput && pins.tipSinkValue);
}

void applyRing() {
  if (pins.bridge != nullptr) pins.bridge->setRelayRingAsserted(pins.ringSinkOutput && pins.ringSinkValue);
}

bool beginHostSendBit(bool& hostOriginated) {
  if (pins.bridge == nullptr) return false;
  // A calculator-held line marks the host's acknowledgement while receiving
  // calculator data. Only a host-originated bit must wait for receiver entry.
  hostOriginated = !pins.bridge->tipLow() && !pins.bridge->ringLow();
  if (!hostOriginated) return true;
  if (pins.hostByteBits == 0 && pins.hostPacketBytes == 0
      && !pins.bridge->waitForCalculatorReceiveSignal(100)) return false;
  // `waitBothHigh()` has just observed the shared release. Preserve that
  // state long enough for the TI's complementary link_wait_exact to see it
  // too before this GPIO asserts the next bit.
  std::this_thread::sleep_for(std::chrono::microseconds(1000));
  return true;
}

void recordHostSendBit(bool tipAsserted) {
  if (tipAsserted) {
    // TI wire bytes are least-significant-bit first; TIP/red encodes zero.
    pins.hostByte &= static_cast<uint8_t>(~(1u << pins.hostByteBits));
  } else {
    pins.hostByte |= static_cast<uint8_t>(1u << pins.hostByteBits);
  }
  if (++pins.hostByteBits != 8) return;

  const uint8_t value = pins.hostByte;
  const uint16_t index = pins.hostPacketBytes++;
  if (index == 1) pins.hostCommand = value;
  else if (index == 2) pins.hostLengthLow = value;
  else if (index == 3) {
    const uint16_t length = static_cast<uint16_t>(pins.hostLengthLow | (static_cast<uint16_t>(value) << 8));
    // Foreground traffic uses ordinary TI DATA packets and four-byte control
    // packets. The body checksum exists only for DATA.
    pins.hostPacketExpectedBytes = pins.hostCommand == 0x15
      ? static_cast<uint16_t>(length + 6) : 4;
  }
  pins.hostByte = 0;
  pins.hostByteBits = 0;
  if (pins.hostPacketExpectedBytes != 0 && pins.hostPacketBytes >= pins.hostPacketExpectedBytes) {
    pins.hostCommand = 0;
    pins.hostLengthLow = 0;
    pins.hostPacketBytes = 0;
    pins.hostPacketExpectedBytes = 0;
  }
}

}  // namespace

namespace schoolcalc_tilem {

void installHostArduinoShim(TilemBlackLinkBridge& bridge,
                            uint8_t tipSensePin, uint8_t tipSinkPin,
                            uint8_t ringSensePin, uint8_t ringSinkPin) {
  pins = Pins{ &bridge, tipSensePin, tipSinkPin, ringSensePin, ringSinkPin };
  applyTip();
  applyRing();
}

void clearHostArduinoShim() {
  if (pins.bridge != nullptr) {
    pins.bridge->setRelayTipAsserted(false);
    pins.bridge->setRelayRingAsserted(false);
  }
  pins = Pins{};
}

}  // namespace schoolcalc_tilem

int digitalRead(uint8_t pin) {
  if (pins.bridge == nullptr) return HIGH;
  if (pin == pins.tipSense) return pins.bridge->tipLow() ? LOW : HIGH;
  if (pin == pins.ringSense) return pins.bridge->ringLow() ? LOW : HIGH;
  return HIGH;
}

void digitalWrite(uint8_t pin, uint8_t value) {
  if (pin == pins.tipSink) {
    pins.tipSinkValue = value == HIGH;
    applyTip();
  } else if (pin == pins.ringSink) {
    pins.ringSinkValue = value == HIGH;
    applyRing();
  }
}

void pinMode(uint8_t pin, uint8_t mode) {
  if (pin == pins.tipSink) {
    bool hostOriginated = false;
    if (mode == OUTPUT && !pins.tipSinkOutput && !beginHostSendBit(hostOriginated)) return;
    pins.tipSinkOutput = mode == OUTPUT;
    applyTip();
    if (mode == OUTPUT && hostOriginated) recordHostSendBit(true);
  } else if (pin == pins.ringSink) {
    bool hostOriginated = false;
    if (mode == OUTPUT && !pins.ringSinkOutput && !beginHostSendBit(hostOriginated)) return;
    pins.ringSinkOutput = mode == OUTPUT;
    applyRing();
    if (mode == OUTPUT && hostOriginated) recordHostSendBit(false);
  }
}

uint32_t millis() {
  return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - startedAt).count());
}

void delay(uint32_t milliseconds) {
  std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
}

int64_t esp_timer_get_time() {
  return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - startedAt).count();
}
