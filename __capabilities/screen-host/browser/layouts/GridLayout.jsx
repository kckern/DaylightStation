import React from 'react';

/**
 * GridLayout - CSS Grid-based layout engine
 *
 * Children should have data-row, data-col, data-colspan, data-rowspan attributes
 * for positioning, or be wrapped with position config.
 */
export function GridLayout({
  columns = 2,
  rows = 2,
  gap = '1rem',
  children,
  className = ''
}) {
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap,
    width: '100%',
    height: '100%'
  };

  // Wrap each child with positioning
  const positionedChildren = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;

    const row = child.props['data-row'] || 1;
    const col = child.props['data-col'] || 1;
    const colspan = child.props['data-colspan'] || 1;
    const rowspan = child.props['data-rowspan'] || 1;

    const wrapperStyle = {
      gridColumn: colspan > 1 ? `${col} / span ${colspan}` : `${col}`,
      gridRow: rowspan > 1 ? `${row} / span ${rowspan}` : `${row}`
    };

    return (
      <div className="screen-grid-cell" style={wrapperStyle}>
        {child}
      </div>
    );
  });

  return (
    <div className={`screen-grid-layout ${className}`} style={gridStyle}>
      {positionedChildren}
    </div>
  );
}

export default GridLayout;
