#pragma once

#include <stdint.h>

namespace obdrelay {

constexpr uint16_t BLE_SAMPLE_MAX_AGE_MS = 5000;
constexpr uint8_t BLE_SPEED = 1 << 2;
constexpr uint8_t BLE_RPM = 1 << 3;
constexpr uint8_t BLE_COOLANT = 1 << 4;

inline void putLe16(uint8_t* out, uint16_t value) {
  out[0] = static_cast<uint8_t>(value);
  out[1] = static_cast<uint8_t>(value >> 8);
}

inline void encodeBleStatus(uint8_t (&out)[12], bool ecuLinked, uint32_t sampleAgeMs, uint8_t fields,
                            int16_t speedKph, int16_t rpm, int16_t coolantC, uint16_t batteryMv) {
  const bool fresh = sampleAgeMs <= BLE_SAMPLE_MAX_AGE_MS;
  out[0] = 1;
  out[1] = (fresh ? 1 | (fields & (BLE_SPEED | BLE_RPM | BLE_COOLANT)) : 0) | (ecuLinked ? 2 : 0);
  putLe16(out + 2, fresh && (fields & BLE_SPEED) ? static_cast<uint16_t>(speedKph) : 0);
  putLe16(out + 4, fresh && (fields & BLE_RPM) ? static_cast<uint16_t>(rpm) : 0);
  putLe16(out + 6, fresh && (fields & BLE_COOLANT) ? static_cast<uint16_t>(coolantC) : 0);
  putLe16(out + 8, batteryMv);
  putLe16(out + 10, sampleAgeMs >= UINT16_MAX ? UINT16_MAX : static_cast<uint16_t>(sampleAgeMs));
}

} // namespace obdrelay
