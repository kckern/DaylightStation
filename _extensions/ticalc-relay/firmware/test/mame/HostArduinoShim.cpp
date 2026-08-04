#include "HostArduinoShim.h"

#include "Arduino.h"
#include "MameBitSocketBridge.h"
#include "esp_timer.h"

#include <chrono>
#include <thread>

namespace {

using Clock = std::chrono::steady_clock;
const Clock::time_point startedAt = Clock::now();

struct Pins {
  schoolcalc_mame::MameBitSocketBridge* bridge = nullptr;
  uint8_t tipSense = 0;
  uint8_t tipSink = 0;
  uint8_t ringSense = 0;
  uint8_t ringSink = 0;
  bool tipSinkOutput = false;
  bool ringSinkOutput = false;
  bool tipSinkValue = false;
  bool ringSinkValue = false;
} pins;

void applyTip() {
  if (pins.bridge != nullptr) pins.bridge->setRelayTipAsserted(pins.tipSinkOutput && pins.tipSinkValue);
}

void applyRing() {
  if (pins.bridge != nullptr) pins.bridge->setRelayRingAsserted(pins.ringSinkOutput && pins.ringSinkValue);
}

}  // namespace

namespace schoolcalc_mame {

void installHostArduinoShim(MameBitSocketBridge& bridge,
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

}  // namespace schoolcalc_mame

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
    pins.tipSinkOutput = mode == OUTPUT;
    applyTip();
  } else if (pin == pins.ringSink) {
    pins.ringSinkOutput = mode == OUTPUT;
    applyRing();
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
