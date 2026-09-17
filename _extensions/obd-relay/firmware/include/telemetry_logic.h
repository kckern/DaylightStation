#pragma once

#include <stdint.h>

#include <stddef.h>
#include <stdint.h>

namespace obdrelay {

constexpr int32_t DISTANCE_COUNTER_SATURATED = 65535;

inline double odometerKmFromRaw(int32_t rawTenthsKm) {
  return rawTenthsKm < 0 ? -1.0 : static_cast<double>(rawTenthsKm) / 10.0;
}

inline bool distanceCounterUsable(int32_t km) {
  return km >= 0 && km < DISTANCE_COUNTER_SATURATED;
}

inline bool isLegalVinChar(char c) {
  if (c >= '0' && c <= '9') return true;
  if (c < 'A' || c > 'Z') return false;
  return c != 'I' && c != 'O' && c != 'Q';
}

inline bool isValidVin(const char* vin) {
  if (!vin) return false;
  size_t n = 0;
  while (vin[n]) {
    if (n >= 17 || !isLegalVinChar(vin[n])) return false;
    ++n;
  }
  return n == 17;
}

inline bool shouldFastSleep(float maxVoltage, bool motion, bool ecuAnswered,
                            float wakeSleepVoltage) {
  return maxVoltage > 0 && maxVoltage <= wakeSleepVoltage && !motion && !ecuAnswered;
}

// Engine-off confirmation vote, with hysteresis. True = start or keep the
// engine-off timer; false = cancel it. ATRV answers in 0.1 V steps, and a
// battery just after a drive rests right at the 13.0 V threshold — a single
// threshold let every 13.0 reading cancel the timer, keeping the device awake
// a median 4.4 min (p90 14 min, max 30 min) after parking. Once the timer runs,
// only a charging-level reading cancels it.
inline bool engineOffVote(float volts, bool timerRunning, float offBelowV,
                          float resumeAtV) {
  if (volts < offBelowV) return true;
  return timerRunning && volts < resumeAtV;
}

struct LinkFailureTracker {
  uint8_t consecutiveFullFailures = 0;

  bool observe(uint8_t answered, uint8_t failureLimit = 3) {
    if (answered) {
      consecutiveFullFailures = 0;
      return false;
    }
    if (consecutiveFullFailures < 0xff) ++consecutiveFullFailures;
    return consecutiveFullFailures >= failureLimit;
  }

  void reset() { consecutiveFullFailures = 0; }
};

}  // namespace obdrelay
