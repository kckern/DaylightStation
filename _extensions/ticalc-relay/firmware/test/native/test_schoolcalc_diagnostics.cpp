#include "SchoolCalcDiagnostics.h"

#include <assert.h>
#include <string.h>

using namespace schoolcalc_diagnostics;

void runSchoolCalcDiagnosticsTests() {
  Journal journal;
  assert(journal.size() == 0 && journal.nextSequence() == 1);
  assert(journal.record(10, Subsystem::Wifi, Severity::Info,
                        "connected", "10.0.0.2", 7, 12, 200, 15) == 1);
  Event event[EVENT_CAPACITY]{};
  assert(journal.copyOldest(event, EVENT_CAPACITY) == 1);
  assert(event[0].sequence == 1 && event[0].atMs == 10);
  assert(strcmp(event[0].name, "connected") == 0);
  assert(event[0].correlation == 7 && event[0].bytes == 12
         && event[0].status == 200 && event[0].durationMs == 15);

  for (size_t index = 0; index < EVENT_CAPACITY + 3; ++index) {
    journal.record(static_cast<uint32_t>(20 + index), Subsystem::TiPacket,
                   Severity::Debug, "rx_packet");
  }
  assert(journal.size() == EVENT_CAPACITY);
  assert(journal.overwrittenCount() == 4);
  assert(journal.totalRecorded() == EVENT_CAPACITY + 4);
  assert(journal.copyOldest(event, EVENT_CAPACITY) == EVENT_CAPACITY);
  for (size_t index = 1; index < EVENT_CAPACITY; ++index) {
    assert(event[index].sequence == event[index - 1].sequence + 1);
  }

  Event newest[2]{};
  assert(journal.copyOldest(newest, 2) == 2);
  assert(newest[1].sequence == journal.nextSequence() - 1);
  assert(newest[0].sequence + 1 == newest[1].sequence);
  const uint32_t next = journal.nextSequence();
  journal.clear();
  assert(journal.size() == 0 && journal.nextSequence() == next);
  assert(journal.totalRecorded() == EVENT_CAPACITY + 4);
  assert(strcmp(severityText(Severity::Error), "error") == 0);
  assert(strcmp(subsystemText(Subsystem::BleKeyboard), "ble_keyboard") == 0);
}
