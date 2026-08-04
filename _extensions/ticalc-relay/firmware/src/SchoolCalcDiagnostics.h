#pragma once

#include <stddef.h>
#include <stdint.h>

namespace schoolcalc_diagnostics {

static constexpr size_t EVENT_CAPACITY = 48;
static constexpr size_t EVENT_NAME_BYTES = 28;
static constexpr size_t EVENT_DETAIL_BYTES = 96;

enum class Severity : uint8_t {
  Debug = 0,
  Info = 1,
  Warning = 2,
  Error = 3,
};

enum class Subsystem : uint8_t {
  System = 0,
  Wifi = 1,
  WebSocket = 2,
  HttpApi = 3,
  TiElectrical = 4,
  TiPacket = 5,
  TiSession = 6,
  BleKeyboard = 7,
  InputQueue = 8,
};

// One deliberately payload-free diagnostic event. The numeric fields have
// stable names in JSON and may be unused (zero): correlation joins a job or
// input sequence, bytes measures transfer size, status carries an HTTP/TI/HID
// status code, and durationMs measures the completed operation.
struct Event {
  uint32_t sequence = 0;
  uint32_t atMs = 0;
  Severity severity = Severity::Info;
  Subsystem subsystem = Subsystem::System;
  char name[EVENT_NAME_BYTES]{};
  char detail[EVENT_DETAIL_BYTES]{};
  uint32_t correlation = 0;
  uint32_t bytes = 0;
  int32_t status = 0;
  uint32_t durationMs = 0;
};

/** Fixed, allocation-free, oldest-overwritten operational journal. */
class Journal {
public:
  uint32_t record(uint32_t atMs, Subsystem subsystem, Severity severity,
                  const char* name, const char* detail = nullptr,
                  uint32_t correlation = 0, uint32_t bytes = 0,
                  int32_t status = 0, uint32_t durationMs = 0);
  size_t copyOldest(Event* output, size_t capacity) const;
  void clear();

  size_t size() const { return count_; }
  size_t capacity() const { return EVENT_CAPACITY; }
  uint32_t totalRecorded() const { return totalRecorded_; }
  uint32_t overwrittenCount() const { return overwrittenCount_; }
  uint32_t nextSequence() const { return nextSequence_; }

private:
  Event events_[EVENT_CAPACITY]{};
  size_t head_ = 0;
  size_t count_ = 0;
  uint32_t nextSequence_ = 1;
  uint32_t totalRecorded_ = 0;
  uint32_t overwrittenCount_ = 0;
};

const char* severityText(Severity severity);
const char* subsystemText(Subsystem subsystem);

}  // namespace schoolcalc_diagnostics
