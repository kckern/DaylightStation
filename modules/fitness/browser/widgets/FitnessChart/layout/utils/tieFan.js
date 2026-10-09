/**
 * Detect avatars sharing (approximately) the same endpoint — a tie — and fan them
 * horizontally around that endpoint with a single shared value label.
 *
 * Tied avatars otherwise stack into an unreadable blob with a duplicated, often
 * clipped, value label (audit Sin 4 + Sin 7). This runs AFTER the LayoutManager
 * and overrides offsets for tied groups using each avatar's BASE (x, y) endpoint.
 *
 * @param {Array<{id,x,y,value}>} avatars
 * @param {Object} opts
 * @param {number} opts.spacing  horizontal gap between fanned members (px)
 * @param {number} [opts.xTol=2] x tolerance for "same endpoint"
 * @param {number} [opts.yTol=2] y tolerance for "same endpoint"
 * @returns {Array} new avatar objects with offsetX/offsetY and labelHidden set
 */
export function resolveTieFan(avatars = [], opts = {}) {
  const { spacing = 64, xTol = 2, yTol = 2 } = opts;
  if (!Array.isArray(avatars) || avatars.length === 0) return avatars;

  const groups = [];
  for (const a of avatars) {
    const g = groups.find((grp) =>
      Math.abs(grp.x - a.x) <= xTol && Math.abs(grp.y - a.y) <= yTol);
    if (g) g.members.push(a);
    else groups.push({ x: a.x, y: a.y, members: [a] });
  }

  const out = [];
  for (const g of groups) {
    if (g.members.length < 2) {
      out.push({ ...g.members[0], offsetX: g.members[0].offsetX || 0, offsetY: g.members[0].offsetY || 0 });
      continue;
    }
    const members = [...g.members].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const n = members.length;
    members.forEach((m, k) => {
      const offsetX = (k - (n - 1) / 2) * spacing;
      out.push({ ...m, offsetX, offsetY: 0, tied: true, labelHidden: k !== n - 1 });
    });
  }
  return out;
}
