/**
 * Panel Renderer — recursive flexbox layout on canvas
 * @module 1_rendering/eink/PanelRenderer
 *
 * Server-side equivalent of the screen-framework's PanelRenderer.jsx.
 * Takes a layout tree with direction/grow/basis/children and computes
 * bounding boxes, then calls widget draw functions for leaf nodes.
 */

/**
 * Resolve a layout tree into flat regions with absolute positions.
 *
 * Each node may have:
 *   - direction: 'row' | 'column' (default 'column')
 *   - children: array of child nodes
 *   - grow: flex-grow (default 1)
 *   - basis: fixed size in px (overrides grow)
 *   - widget: string name (leaf node)
 *   - padding: number (px, applied to container)
 *   - gap: number (px between children)
 *
 * @param {Object} node - Layout tree node
 * @param {{ x: number, y: number, w: number, h: number }} box - Available region
 * @returns {Array<{ widget: string, props: Object, box: { x, y, w, h } }>} Flat list of widget regions
 */
export function resolveLayout(node, box) {
  if (!node) return [];

  // Leaf node — a widget
  if (node.widget) {
    return [{ widget: node.widget, props: node.props || {}, box }];
  }

  const children = node.children;
  if (!Array.isArray(children) || children.length === 0) return [];

  const direction = node.direction || 'column';
  const isRow = direction === 'row';
  const padding = node.padding || 0;
  const gap = node.gap || 0;

  // Apply padding to available box
  const inner = {
    x: box.x + padding,
    y: box.y + padding,
    w: box.w - padding * 2,
    h: box.h - padding * 2,
  };

  const totalAxis = isRow ? inner.w : inner.h;
  const totalGap = gap * (children.length - 1);
  const availableForFlex = totalAxis - totalGap;

  // First pass: sum up basis and grow
  let usedByBasis = 0;
  let totalGrow = 0;
  for (const child of children) {
    if (child.basis != null) {
      usedByBasis += child.basis;
    } else {
      totalGrow += (child.grow ?? 1);
    }
  }

  const remainingForGrow = Math.max(0, availableForFlex - usedByBasis);

  // Second pass: assign sizes and recurse
  let offset = 0;
  const regions = [];

  for (const child of children) {
    let size;
    if (child.basis != null) {
      size = child.basis;
    } else {
      const grow = child.grow ?? 1;
      size = totalGrow > 0 ? (grow / totalGrow) * remainingForGrow : 0;
    }

    const childBox = isRow
      ? { x: inner.x + offset, y: inner.y, w: size, h: inner.h }
      : { x: inner.x, y: inner.y + offset, w: inner.w, h: size };

    regions.push(...resolveLayout(child, childBox));
    offset += size + gap;
  }

  return regions;
}
