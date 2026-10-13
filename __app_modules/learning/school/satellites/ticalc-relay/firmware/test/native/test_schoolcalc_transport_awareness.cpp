#include "SchoolCalcTransportAwareness.h"

#include <assert.h>
#include <string.h>

using namespace schoolcalc_relay;

void runSchoolCalcTransportAwarenessTests() {
  TransportPresence state = describeTransportPresence(false, false, false);
  assert(strcmp(state.connection, "unknown") == 0);
  assert(strcmp(state.evidence, "unknown_idle") == 0);

  state = describeTransportPresence(false, false, true);
  assert(strcmp(state.connection, "unknown") == 0);
  assert(strcmp(state.evidence, "line_activity_only") == 0);

  state = describeTransportPresence(true, false, false);
  assert(strcmp(state.connection, "verifying") == 0);
  assert(strcmp(state.evidence, "negotiating") == 0);

  state = describeTransportPresence(true, true, false);
  assert(strcmp(state.connection, "verified") == 0);
  assert(strcmp(state.evidence, "verified_session") == 0);

  // Verification is deliberately session-scoped. Once work ends, even a
  // remembered verified peer cannot be reported as currently connected.
  state = describeTransportPresence(false, true, false);
  assert(strcmp(state.connection, "unknown") == 0);
  assert(strcmp(state.evidence, "unknown_idle") == 0);

  ForegroundListenerStatus listener = describeForegroundListener(
    false, true, false, false, false);
  assert(strcmp(listener.state, "safety_disabled") == 0);
  assert(!listener.shouldAcceptHello);

  listener = describeForegroundListener(true, false, false, false, false);
  assert(strcmp(listener.state, "disabled") == 0);
  assert(!listener.shouldAcceptHello);

  listener = describeForegroundListener(true, true, true, true, false);
  assert(strcmp(listener.state, "occupied") == 0);
  assert(!listener.shouldAcceptHello);

  listener = describeForegroundListener(true, true, false, false, false);
  assert(strcmp(listener.state, "armed_unknown_idle") == 0);
  assert(!listener.shouldAcceptHello);

  listener = describeForegroundListener(true, true, false, true, true);
  assert(strcmp(listener.state, "bus_unavailable") == 0);
  assert(!listener.shouldAcceptHello);

  listener = describeForegroundListener(true, true, false, true, false);
  assert(strcmp(listener.state, "hello_candidate") == 0);
  assert(listener.shouldAcceptHello);

  listener = describeForegroundListener(true, true, false, false, true);
  assert(strcmp(listener.state, "hello_candidate") == 0);
  assert(listener.shouldAcceptHello);
}
