# Home Line — Video Calling

Home Line is the one-to-one, authenticated LAN WebRTC call between the phone
`/call` application and a TV `videocall` screen. Media is peer-to-peer; the
backend owns the expiring device lease, authorized call-specific signaling,
wake/recovery actions, and prior-state restoration.

The former device-topic protocol (`homeline:{deviceId}` signaling and
`useHomeline`) has been retired. That topic family remains in the media system
only for non-call wake/load progress. Calls use exact, credential-authorized
`homeline-call:{callId}` topics and ephemeral signaling.

See the canonical [Home Line Call System](../../call/README.md) reference for:

- API and authentication contracts
- lease expiry and participant heartbeat rules
- phone state machine and cancellation guarantees
- media verification and degraded states
- ICE and device-recovery ladders
- restoration behavior and field-triage log queries
