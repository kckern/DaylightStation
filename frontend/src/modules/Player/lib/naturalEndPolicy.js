// Natural-end policy seam.
//
// The Player consults one optional page-level policy at every NATURAL end of
// an item (native `ended`, segment end, at-duration watchdog — never on skip,
// failure or clear). The screen framework registers one to implement its
// session controls: sleep timer "at end of item", stop after this one, the
// next-episode countdown and end-of-queue stop/repeat/similar. Nothing
// registers one in the Media app, so its Players behave exactly as before.
//
// policy(ctx, actions) → boolean
//   ctx:     { isQueue, current, next }   (queue items; next is null at queue end)
//   actions: { advance(), stop(), finish(), restartQueue() } — always read the
//            Player's latest state, so they are safe to call later (countdown).
// Return true when the policy took responsibility for what happens next.
let current = null;

export function setNaturalEndPolicy(policy) {
  const entry = typeof policy === 'function' ? policy : null;
  current = entry;
  return () => { if (current === entry) current = null; };
}

export function getNaturalEndPolicy() {
  return current;
}
