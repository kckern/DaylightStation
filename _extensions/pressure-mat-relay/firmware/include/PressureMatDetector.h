#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

// The same deterministic detector runs on ESP and in native replay tests.
// Occupancy is an inference, not a weight measurement. A settled/rearmed signal
// is explicitly UNKNOWN, never an invented physical release.
class PressureMatDetector {
 public:
  struct Config {
    float pressDelta = .12f;
    float pressGradient = .08f;
    float stompDelta = .48f;
    float stompGradient = .20f;
    float releaseRatio = .5f;
    uint32_t armWindowMs = 5000;
    uint32_t releaseDebounceMs = 150;
    uint32_t rearmAfterMs = 5000;
    uint32_t quietWindowMs = 2500;
    uint32_t maxSampleGapMs = 500;
  };
  struct Events { bool pressed = false, released = false, stomped = false, rearmed = false; };
  struct State {
    bool initialized = false, occupied = false, occupancyKnown = false;
    bool rearmed = false, classifiedStomp = false;
    float voltage = 0, restVoltage = 0, delta = 0, gradient = 0;
    float peakDelta = 0, peakGradient = 0;
    uint32_t steps = 0, stomps = 0, transitions = 0, rearms = 0, pressDurationMs = 0;
  };

  void configure(const Config& config) { config_ = config; }
  const State& state() const { return state_; }
  const char* phase() const {
    return !state_.initialized ? "initializing" : state_.rearmed ? "rearmed"
      : state_.occupied ? "pressed" : "ready";
  }
  void recalibrate() {
    // Re-zero does not erase this boot's physical counters.
    const auto steps = state_.steps, stomps = state_.stomps;
    const auto transitions = state_.transitions, rearms = state_.rearms;
    state_ = State{};
    state_.steps = steps; state_.stomps = stomps;
    state_.transitions = transitions; state_.rearms = rearms;
    pressArmed_ = releasePending_ = false;
  }

  Events sample(float voltage, uint32_t now) {
    Events events;
    if (!std::isfinite(voltage) || voltage < 0 || voltage > 3.3f) return events;
    if (!state_.initialized) {
      state_.initialized = true;
      state_.voltage = state_.restVoltage = voltage;
      state_.occupancyKnown = false; // Boot may occur hanging or under a load.
      lastAt_ = now;
      resetQuiet(voltage, now);
      return events;
    }
    const uint32_t elapsed = now - lastAt_; // unsigned arithmetic survives millis wrap
    if (elapsed == 0) return events;
    const float previous = state_.voltage;
    state_.voltage = voltage;
    state_.gradient = (voltage - previous) * 1000.f / elapsed;
    lastAt_ = now;

    if (elapsed > config_.maxSampleGapMs) {
      // A network/OTA stall is not a measurable pressure edge. Establish a new
      // reference, preserving counts, and allow the next real edge immediately.
      rearm(events, voltage, now);
      return events;
    }

    const float quietTolerance = std::max(.01f, config_.pressDelta * .25f);
    quietLow_ = std::min(quietLow_, voltage);
    quietHigh_ = std::max(quietHigh_, voltage);
    if (quietHigh_ - quietLow_ > quietTolerance) resetQuiet(voltage, now);
    if (now - quietAt_ >= config_.quietWindowMs
        && std::fabs(voltage - quietReference_) > config_.pressDelta * .05f) resetQuiet(voltage, now);

    if (state_.occupied) {
      state_.pressDurationMs = now - pressAt_;
      low_ = std::min(low_, voltage);
      state_.delta = std::max(0.f, state_.restVoltage - voltage);
      state_.peakDelta = std::max(state_.peakDelta, state_.delta);
      state_.peakGradient = std::max(state_.peakGradient, -state_.gradient);
      classifyStomp(events);

      // Infer release from net recovery, not a sufficiently fast single frame.
      // The low-water reference does not chase a slow recovery upward.
      if (voltage - low_ >= config_.pressDelta * config_.releaseRatio) {
        if (!releasePending_) { releasePending_ = true; releaseAt_ = now; }
        if (now - releaseAt_ >= config_.releaseDebounceMs) {
          state_.occupied = false;
          state_.occupancyKnown = true;
          state_.transitions++;
          state_.delta = 0;
          events.released = true;
          pressArmed_ = releasePending_ = false;
          resetQuiet(voltage, now);
        }
      } else releasePending_ = false;

      if (state_.occupied && state_.pressDurationMs >= config_.rearmAfterMs
          && now - quietAt_ >= config_.quietWindowMs) rearm(events, voltage, now);
      return events;
    }

    if (pressArmed_ && now - armAt_ > config_.armWindowMs) pressArmed_ = false;
    if (!pressArmed_ && state_.gradient <= -config_.pressGradient) {
      pressArmed_ = true;
      armAt_ = now;
      state_.restVoltage = previous;
      pressThreshold_ = previous - config_.pressDelta;
      armedPeakGradient_ = -state_.gradient;
    }
    if (pressArmed_) armedPeakGradient_ = std::max(armedPeakGradient_, -state_.gradient);
    if (pressArmed_ && voltage <= pressThreshold_) {
      state_.occupied = state_.occupancyKnown = true;
      state_.rearmed = false;
      state_.steps++;
      state_.transitions++;
      state_.classifiedStomp = false;
      state_.delta = std::max(0.f, state_.restVoltage - voltage);
      state_.peakDelta = state_.delta;
      state_.peakGradient = armedPeakGradient_;
      state_.pressDurationMs = 0;
      pressAt_ = now;
      low_ = voltage;
      pressArmed_ = releasePending_ = false;
      resetQuiet(voltage, now);
      events.pressed = true;
      // Classify on the following frame so the pressed message establishes
      // counters before the stomp increment (including for a new subscriber).
    }
    return events;
  }

 private:
  Config config_;
  State state_;
  bool pressArmed_ = false, releasePending_ = false;
  uint32_t lastAt_ = 0, armAt_ = 0, pressAt_ = 0, releaseAt_ = 0, quietAt_ = 0;
  float pressThreshold_ = 0, low_ = 0, quietLow_ = 0, quietHigh_ = 0, quietReference_ = 0, armedPeakGradient_ = 0;
  void resetQuiet(float voltage, uint32_t now) {
    quietLow_ = quietHigh_ = quietReference_ = voltage;
    quietAt_ = now;
  }
  void rearm(Events& events, float voltage, uint32_t now) {
    if (!state_.rearmed) { state_.rearms++; events.rearmed = true; }
    state_.occupied = state_.occupancyKnown = false;
    state_.rearmed = true;
    state_.delta = state_.gradient = 0;
    state_.restVoltage = voltage;
    pressArmed_ = releasePending_ = false;
    resetQuiet(voltage, now);
  }
  void classifyStomp(Events& events) {
    if (!state_.classifiedStomp && state_.peakDelta >= config_.stompDelta && state_.peakGradient >= config_.stompGradient) {
      state_.classifiedStomp = true;
      state_.stomps++;
      events.stomped = true;
    }
  }
};
