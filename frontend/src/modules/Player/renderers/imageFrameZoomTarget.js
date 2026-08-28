// imageFrameZoomTarget.js — Ken Burns target computation for ImageFrame.jsx
// (and TitleCardRenderer.jsx), split out so Fast Refresh can hot-reload the
// frame component on its own.
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'ImageFrame' });

/**
 * Compute Ken Burns animation target based on face data.
 * Priority: focusPerson face > center-most face > random center 60%
 */
export function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50;

  let targetX = 0.5;
  let targetY = 0.5;
  let found = false;
  let strategy = 'random';

  const allFaces = (people || []).flatMap(p =>
    (p.faces || []).map(f => ({ ...f, personName: p.name }))
  );

  if (focusPerson && allFaces.length > 0) {
    const match = allFaces.find(f =>
      f.personName?.toLowerCase() === focusPerson.toLowerCase()
    );
    if (match && match.imageWidth && match.imageHeight) {
      targetX = ((match.x1 + match.x2) / 2) / match.imageWidth;
      targetY = ((match.y1 + match.y2) / 2) / match.imageHeight;
      found = true;
      strategy = 'focus-person';
    }
  }

  if (!found && allFaces.length > 0) {
    let closest = allFaces[0];
    let closestDist = Infinity;
    for (const f of allFaces) {
      if (!f.imageWidth || !f.imageHeight) continue;
      const cx = ((f.x1 + f.x2) / 2) / f.imageWidth;
      const cy = ((f.y1 + f.y2) / 2) / f.imageHeight;
      const dist = (cx - 0.5) ** 2 + (cy - 0.5) ** 2;
      if (dist < closestDist) {
        closestDist = dist;
        closest = f;
      }
    }
    if (closest.imageWidth && closest.imageHeight) {
      targetX = ((closest.x1 + closest.x2) / 2) / closest.imageWidth;
      targetY = ((closest.y1 + closest.y2) / 2) / closest.imageHeight;
      found = true;
      strategy = 'center-face';
    }
  }

  if (!found) {
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

  logger.debug('zoom-target-computed', {
    strategy,
    focusPerson: focusPerson || null,
    faceCount: allFaces.length,
    faceNames: [...new Set(allFaces.map(f => f.personName).filter(Boolean))],
    targetX: targetX.toFixed(3),
    targetY: targetY.toFixed(3),
    zoom,
  });

  const startOffX = (0.5 - targetX) * maxTranslate * 0.3;
  const startOffY = (0.5 - targetY) * maxTranslate * 0.3;
  const endOffX = (0.5 - targetX) * maxTranslate;
  const endOffY = (0.5 - targetY) * maxTranslate;

  return {
    startX: `${startOffX.toFixed(2)}%`,
    startY: `${startOffY.toFixed(2)}%`,
    endX: `${endOffX.toFixed(2)}%`,
    endY: `${endOffY.toFixed(2)}%`,
    strategy,
  };
}
