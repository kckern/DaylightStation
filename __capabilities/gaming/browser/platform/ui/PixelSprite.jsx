import React from 'react';

// Grid -> SVG pixel art. A grid is rows of cells: arrays of numbers (0 = empty)
// or strings ('.' and ' ' = empty). The renderer owns no art: each game keeps
// its own grids. Cells take `currentColor` unless `palette` maps their value
// to a fill. With x/y/width/height it nests inside a parent <svg>; without
// them it is a standalone svg sized by CSS.
const isEmpty = (cell) => cell == null || cell === 0 || cell === '.' || cell === ' ';

/** Filled cells of a grid, row by row: [{ x, y, value }]. */
export function pixelRects(grid) {
  const rects = [];
  (grid || []).forEach((row, y) => {
    Array.from(row || []).forEach((value, x) => {
      if (!isEmpty(value)) rects.push({ x, y, value });
    });
  });
  return rects;
}

export default function PixelSprite({ grid, palette, className = '', x, y, width, height, ...rest }) {
  const rows = grid?.length || 0;
  const columns = rows ? Math.max(...grid.map((row) => row?.length || 0)) : 0;
  if (!rows || !columns) return null;
  return (
    <svg
      className={className || undefined}
      viewBox={`0 0 ${columns} ${rows}`}
      x={x}
      y={y}
      width={width}
      height={height}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {pixelRects(grid).map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill={palette?.[cell.value]} />
      ))}
    </svg>
  );
}
