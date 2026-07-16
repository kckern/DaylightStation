// Pure resolver for the Player host. Given the current claims, pick the winner:
// highest priority, ties broken by the most-recently-added claim (highest seq).
// Null-element claims are ignored (a claimant that isn't mounted / isn't active).
export function resolveActiveHost(claims) {
  let best = null;
  for (const c of claims) {
    if (!c || c.el == null) continue;
    if (
      best == null ||
      c.priority > best.priority ||
      (c.priority === best.priority && c.seq > best.seq)
    ) {
      best = c;
    }
  }
  return best ? best.el : null;
}

export default resolveActiveHost;
