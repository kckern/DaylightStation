// Natural-end policy seam.
//
// The Player consults one optional policy at every NATURAL end of an item
// (native `ended`, segment end, at-duration watchdog — never on skip, failure
// or clear). The screen framework registers one to implement its session
// controls: sleep timer "at end of item", stop after this one, the
// next-episode countdown and end-of-queue stop/repeat/similar.
//
// It is NOT page-global behaviour: a registration carries `isOwner(playerInstanceId)`
// and only the Player the screen's session is bound to is ever consulted. Any
// other Player on the page (a school lesson, a composite view, the Media app)
// keeps its default end behaviour. A registration without an owner check is
// never consulted.
//
// policy(ctx, actions) → boolean
//   ctx:     { isQueue, current, next }   (queue items; next is null at queue end)
//   actions: { advance(), stop(), finish(), restartQueue(), release() } — always read the
//            Player's latest state, so they are safe to call later (countdown).
//            release() lets go of a held end without stopping, so the same
//            item can complete again.
// Return true when the policy took responsibility for what happens next.
let current = null;

export function setNaturalEndPolicy(policy, { isOwner } = {}) {
  const entry = typeof policy === 'function' ? { policy, isOwner: typeof isOwner === 'function' ? isOwner : null } : null;
  current = entry;
  return () => { if (current === entry) current = null; };
}

/** The policy for this Player instance, or null when it is not the bound owner. */
export function getNaturalEndPolicy(playerInstanceId) {
  if (!current?.isOwner) return null;
  try {
    return current.isOwner(playerInstanceId) === true ? current.policy : null;
  } catch {
    return null;
  }
}
