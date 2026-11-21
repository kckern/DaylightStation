// remoteButtonHolds — who owns a Bluetooth remote's presses right now.
//
// Every press of a garage remote arrives twice on the fitness screen: as a
// `bt.remote.key` bus message tagged with the remote's address
// (bluetooth.subscribeRemoteKeys) and as a plain browser KeyboardEvent. Any
// layer that turns those presses into actions (a per-remote button mapping, a
// game) asks here before acting, so two layers never act on the same press.
//
//   holdRemoteButtons(reason)  every remote belongs to the caller (a game while
//                              it is mounted or in a round). Returns release().
//   claimRemote(address)       one remote belongs to the caller (the Bluetooth
//                              screen while that remote's page is open, so a
//                              press there is only tried). Returns release().
//   isRemoteHeld(address)      true when a hold or that address's claim is on:
//                              a mapping layer must perform nothing for it.
//
// Holds and claims are module-level (one fitness screen per page) and counted:
// two holders each release their own. Documented in
// __docs/reference/gaming/controller-pairing.md (Who owns a remote's presses).

const holds = new Map();
const claims = new Map();
let seq = 0;

const norm = (address) => String(address || '').toUpperCase();

/** Every remote's presses belong to the caller until release() is called. */
export function holdRemoteButtons(reason = 'hold') {
  const id = ++seq;
  holds.set(id, String(reason));
  return () => { holds.delete(id); };
}

/** One remote's presses belong to the caller until release() is called. */
export function claimRemote(address) {
  const id = ++seq;
  claims.set(id, norm(address));
  return () => { claims.delete(id); };
}

/** Reasons of the holds now on (a game name each), oldest first. */
export function remoteButtonHolds() { return [...holds.values()]; }

/** Whether one remote is claimed by address (not counting holds). */
export function isRemoteClaimed(address) {
  const a = norm(address);
  return [...claims.values()].includes(a);
}

/** Whether a mapping layer must leave this remote's presses alone. */
export function isRemoteHeld(address) {
  return holds.size > 0 || isRemoteClaimed(address);
}

/** Tests only. */
export function resetRemoteButtonHolds() { holds.clear(); claims.clear(); }
