import React, { useMemo } from 'react';

function MediaThumb({ photo, style }) {
  return (
    <div
      className={`photo-thumb${photo.type === 'video' ? ' photo-thumb--video' : ''}`}
      style={style}
    >
      <img src={photo.thumbnail} alt="" loading="lazy" />
      {photo.type === 'video' && <span className="video-badge">▶</span>}
      {photo.people?.length > 0 && (
        <div className="photo-people">{photo.people.join(', ')}</div>
      )}
    </div>
  );
}

/**
 * Compute a CSS grid layout based on photo count.
 * Returns { gridStyle, items } where items have gridArea assignments.
 */
function computeLayout(photos) {
  const count = photos.length;

  // 1 photo: fill the whole cell
  if (count === 1) {
    return {
      gridStyle: { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' },
      items: [{ photo: photos[0], style: {} }],
    };
  }

  // 2 photos: side by side
  if (count === 2) {
    return {
      gridStyle: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' },
      items: photos.map(p => ({ photo: p, style: {} })),
    };
  }

  // 3 photos: one large left, two stacked right
  if (count === 3) {
    return {
      gridStyle: {
        gridTemplateColumns: '2fr 1fr',
        gridTemplateRows: '1fr 1fr',
      },
      items: [
        { photo: photos[0], style: { gridRow: '1 / 3' } },
        { photo: photos[1], style: {} },
        { photo: photos[2], style: {} },
      ],
    };
  }

  // 4 photos: 2x2 grid
  if (count === 4) {
    return {
      gridStyle: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' },
      items: photos.map(p => ({ photo: p, style: {} })),
    };
  }

  // 5 photos: one large top-left spanning 2 rows, 3 small on right + 1 bottom-left
  if (count === 5) {
    return {
      gridStyle: {
        gridTemplateColumns: '2fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr',
      },
      items: [
        { photo: photos[0], style: { gridRow: '1 / 3' } },
        { photo: photos[1], style: {} },
        { photo: photos[2], style: {} },
        { photo: photos[3], style: {} },
        { photo: photos[4], style: {} },
      ],
    };
  }

  // 6 photos: 3x2 grid
  if (count === 6) {
    return {
      gridStyle: { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' },
      items: photos.map(p => ({ photo: p, style: {} })),
    };
  }

  // 7-8: hero left spanning full height, rest in a grid on the right
  if (count <= 8) {
    const hero = photos[0];
    const rest = photos.slice(1);
    const cols = Math.ceil(rest.length / 2);
    return {
      gridStyle: {
        gridTemplateColumns: `2fr ${Array(cols).fill('1fr').join(' ')}`,
        gridTemplateRows: '1fr 1fr',
      },
      items: [
        { photo: hero, style: { gridRow: '1 / 3' } },
        ...rest.map(p => ({ photo: p, style: {} })),
      ],
    };
  }

  // 9+: dense auto-fill grid, 3 columns with auto rows
  return {
    gridStyle: {
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridAutoRows: '1fr',
    },
    items: photos.map(p => ({ photo: p, style: {} })),
  };
}

export default function PhotoWall({ photos }) {
  const layout = useMemo(() => {
    if (!photos || photos.length === 0) return null;
    return computeLayout(photos);
  }, [photos]);

  if (!layout) {
    return null;
  }

  return (
    <div className="photo-wall" style={layout.gridStyle}>
      {layout.items.map(({ photo, style }) => (
        <MediaThumb key={photo.id} photo={photo} style={style} />
      ))}
    </div>
  );
}
