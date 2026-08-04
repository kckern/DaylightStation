#include "SchoolCalcTransportAwareness.h"

namespace schoolcalc_relay {

TransportPresence describeTransportPresence(bool operationActive,
                                             bool peerVerifiedThisSession,
                                             bool recentLineActivity) {
  if (operationActive && peerVerifiedThisSession) {
    return { "verified", "verified_session" };
  }
  if (operationActive) return { "verifying", "negotiating" };
  if (recentLineActivity) return { "unknown", "line_activity_only" };
  return { "unknown", "unknown_idle" };
}

ForegroundListenerStatus describeForegroundListener(bool transmitEnabled,
                                                      bool listenerEnabled,
                                                      bool operationOccupied,
                                                      bool tipLow,
                                                      bool ringLow) {
  if (!transmitEnabled) return { "safety_disabled", false };
  if (!listenerEnabled) return { "disabled", false };
  if (operationOccupied) return { "occupied", false };
  if (tipLow && ringLow) return { "bus_unavailable", false };
  if (tipLow || ringLow) return { "hello_candidate", true };
  return { "armed_unknown_idle", false };
}

}  // namespace schoolcalc_relay
