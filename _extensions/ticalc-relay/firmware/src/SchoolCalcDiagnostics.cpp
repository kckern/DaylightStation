#include "SchoolCalcDiagnostics.h"

#include <stdio.h>
#include <string.h>

namespace schoolcalc_diagnostics {

uint32_t Journal::record(uint32_t atMs, Subsystem subsystem, Severity severity,
                         const char* name, const char* detail,
                         uint32_t correlation, uint32_t bytes,
                         int32_t status, uint32_t durationMs) {
  if (nextSequence_ == 0) nextSequence_ = 1;
  size_t target = (head_ + count_) % EVENT_CAPACITY;
  if (count_ == EVENT_CAPACITY) {
    target = head_;
    head_ = (head_ + 1) % EVENT_CAPACITY;
    overwrittenCount_ += 1;
  } else {
    count_ += 1;
  }
  Event& event = events_[target];
  event = Event{};
  event.sequence = nextSequence_++;
  event.atMs = atMs;
  event.severity = severity;
  event.subsystem = subsystem;
  snprintf(event.name, sizeof(event.name), "%s", name == nullptr ? "unknown" : name);
  snprintf(event.detail, sizeof(event.detail), "%s", detail == nullptr ? "" : detail);
  event.correlation = correlation;
  event.bytes = bytes;
  event.status = status;
  event.durationMs = durationMs;
  totalRecorded_ += 1;
  return event.sequence;
}

size_t Journal::copyOldest(Event* output, size_t capacity) const {
  if (output == nullptr || capacity == 0) return 0;
  const size_t copied = count_ < capacity ? count_ : capacity;
  // When the caller requests a truncated snapshot, return the newest `capacity`
  // records while preserving chronological order.
  const size_t skipped = count_ - copied;
  for (size_t index = 0; index < copied; ++index) {
    output[index] = events_[(head_ + skipped + index) % EVENT_CAPACITY];
  }
  return copied;
}

void Journal::clear() {
  memset(events_, 0, sizeof(events_));
  head_ = 0;
  count_ = 0;
  // Lifetime counters and sequence remain monotonic across a user-visible
  // clear, so a diagnostic client can detect the gap.
}

const char* severityText(Severity severity) {
  switch (severity) {
    case Severity::Debug: return "debug";
    case Severity::Info: return "info";
    case Severity::Warning: return "warning";
    case Severity::Error: return "error";
  }
  return "unknown";
}

const char* subsystemText(Subsystem subsystem) {
  switch (subsystem) {
    case Subsystem::System: return "system";
    case Subsystem::Wifi: return "wifi";
    case Subsystem::WebSocket: return "websocket";
    case Subsystem::HttpApi: return "http_api";
    case Subsystem::TiElectrical: return "ti_electrical";
    case Subsystem::TiPacket: return "ti_packet";
    case Subsystem::TiSession: return "ti_session";
    case Subsystem::BleKeyboard: return "ble_keyboard";
    case Subsystem::InputQueue: return "input_queue";
  }
  return "unknown";
}

}  // namespace schoolcalc_diagnostics
