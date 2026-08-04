#pragma once

namespace schoolcalc_relay {

struct TransportPresence {
  const char* connection;
  const char* evidence;
};

struct ForegroundListenerStatus {
  const char* state;
  bool shouldAcceptHello;
};

// Passive idle-high is never attachment proof. A verified peer applies only
// while its transaction is active; after the session, connection returns to
// unknown and last-seen age remains separate historical evidence.
TransportPresence describeTransportPresence(bool operationActive,
                                             bool peerVerifiedThisSession,
                                             bool recentLineActivity);

// The listener may claim the bus only after observing exactly one asserted
// line while no explicit TI operation owns the transport. Both-high is the
// normal unknown-idle state, not peer proof; both-low means no usable idle bus
// (an unplugged divider input or an electrical fault) and is never treated as a
// foreground start.
ForegroundListenerStatus describeForegroundListener(bool transmitEnabled,
                                                      bool listenerEnabled,
                                                      bool operationOccupied,
                                                      bool tipLow,
                                                      bool ringLow);

}  // namespace schoolcalc_relay
