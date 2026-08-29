# Call application

`CallApp.jsx` is the phone presentation shell for the authenticated Home Line
call system. It intentionally contains no legacy `homeline:{deviceId}`
signaling or automatic one-device startup. `call/useCallController.js` owns the
cancellable attempt, while `call/callMachine.js` is the pure visible-state
reducer.

The TV surface is `modules/Input/VideoCall.jsx`. Both peers use exact,
credential-authorized `homeline-call:{callId}` subscriptions through
`useCallSignaling.js`; WebRTC media remains peer-to-peer.

The canonical behavior, API contract, recovery ladder, media verification, and
field-triage queries are documented in
[`docs/reference/call/README.md`](../../../docs/reference/call/README.md).
