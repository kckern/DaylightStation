import React, { useMemo } from 'react';
import { seededHue } from '../_shared/sportIconUtils.js';
import { TILE_SIZE, tileUrl, DARK_TILE_FILTER, MAP_ATTRIBUTION, MAP_ATTRIBUTION_URL } from '../_shared/mapTiles.js';


function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function latLngToPixel(lat, lng, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;
  return [x, y];
}

function fitZoom(minLat, maxLat, minLng, maxLng, viewW, viewH, padding = 20) {
  for (let z = 18; z >= 1; z--) {
    const [x1, y1] = latLngToPixel(maxLat, minLng, z);
    const [x2, y2] = latLngToPixel(minLat, maxLng, z);
    if (x2 - x1 + padding * 2 <= viewW && y2 - y1 + padding * 2 <= viewH) return z;
  }
  return 1;
}

const W = 80;
const H = 120;

export default function MiniRouteMap({ polyline, sessionId }) {
  const mapData = useMemo(() => {
    if (!polyline) return null;
    const points = decodePolyline(polyline);
    if (points.length < 2) return null;

    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const zoom = fitZoom(minLat, maxLat, minLng, maxLng, W, H);
    const pixels = points.map(([lat, lng]) => latLngToPixel(lat, lng, zoom));

    const pxs = pixels.map(p => p[0]);
    const pys = pixels.map(p => p[1]);
    const minPx = Math.min(...pxs), maxPx = Math.max(...pxs);
    const minPy = Math.min(...pys), maxPy = Math.max(...pys);
    const offsetX = (W - (maxPx - minPx)) / 2 - minPx;
    const offsetY = (H - (maxPy - minPy)) / 2 - minPy;

    const vpLeft = -offsetX;
    const vpTop = -offsetY;
    const tileXMin = Math.floor(vpLeft / TILE_SIZE);
    const tileXMax = Math.floor((vpLeft + W) / TILE_SIZE);
    const tileYMin = Math.floor(vpTop / TILE_SIZE);
    const tileYMax = Math.floor((vpTop + H) / TILE_SIZE);
    const maxTileIdx = Math.pow(2, zoom) - 1;

    const tiles = [];
    for (let tx = tileXMin; tx <= tileXMax; tx++) {
      for (let ty = tileYMin; ty <= tileYMax; ty++) {
        if (ty < 0 || ty > maxTileIdx) continue;
        const wx = ((tx % (maxTileIdx + 1)) + (maxTileIdx + 1)) % (maxTileIdx + 1);
        tiles.push({
          key: `${zoom}-${wx}-${ty}`,
          url: tileUrl(zoom, wx, ty),
          left: tx * TILE_SIZE + offsetX,
          top: ty * TILE_SIZE + offsetY,
        });
      }
    }

    const routePoints = pixels.map(([px, py]) => [px + offsetX, py + offsetY]);
    return { tiles, svgPoints: routePoints.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') };
  }, [polyline]);

  if (!mapData) return null;

  const hue = seededHue(sessionId || 'default');
  const routeColor = `hsl(${hue}, 60%, 55%)`;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: '6px', background: '#1a1a2e' }}>
      <div style={{ position: 'absolute', inset: 0, filter: DARK_TILE_FILTER }}>
        {mapData.tiles.map(t => (
          <img key={t.key} src={t.url} alt="" draggable={false} style={{
            position: 'absolute', left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE,
          }} />
        ))}
      </div>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <polyline points={mapData.svgPoints} fill="none" stroke={routeColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      </svg>
      <span style={{
        position: 'absolute', bottom: 1, right: 3,
        fontSize: '0.45rem', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
      }} title={MAP_ATTRIBUTION_URL}>{MAP_ATTRIBUTION}</span>
    </div>
  );
}
