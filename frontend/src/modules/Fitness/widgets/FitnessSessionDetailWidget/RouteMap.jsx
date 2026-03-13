import React, { useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { seededHue } from '../_shared/SportIcon.jsx';

const TILE_SIZE = 256;
const TILE_URL = 'https://basemaps.cartocdn.com/dark_all';
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;

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

function fitZoom(minLat, maxLat, minLng, maxLng, viewW, viewH, padding = 50) {
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const [x1, y1] = latLngToPixel(maxLat, minLng, z);
    const [x2, y2] = latLngToPixel(minLat, maxLng, z);
    if (x2 - x1 + padding * 2 <= viewW && y2 - y1 + padding * 2 <= viewH) return z;
  }
  return MIN_ZOOM;
}

function computeTilesAndRoute(decodedPoints, zoom, centerX, centerY, viewW, viewH) {
  const pixels = decodedPoints.map(([lat, lng]) => latLngToPixel(lat, lng, zoom));

  // Offset so centerX,centerY is at viewport center
  const offsetX = viewW / 2 - centerX;
  const offsetY = viewH / 2 - centerY;

  const vpLeft = -offsetX;
  const vpTop = -offsetY;
  const tileXMin = Math.floor(vpLeft / TILE_SIZE);
  const tileXMax = Math.floor((vpLeft + viewW) / TILE_SIZE);
  const tileYMin = Math.floor(vpTop / TILE_SIZE);
  const tileYMax = Math.floor((vpTop + viewH) / TILE_SIZE);
  const maxTileIdx = Math.pow(2, zoom) - 1;

  const tiles = [];
  for (let tx = tileXMin; tx <= tileXMax; tx++) {
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      if (ty < 0 || ty > maxTileIdx) continue;
      const wx = ((tx % (maxTileIdx + 1)) + (maxTileIdx + 1)) % (maxTileIdx + 1);
      tiles.push({
        key: `${zoom}-${wx}-${ty}`,
        url: `${TILE_URL}/${zoom}/${wx}/${ty}.png`,
        left: tx * TILE_SIZE + offsetX,
        top: ty * TILE_SIZE + offsetY,
      });
    }
  }

  const routePoints = pixels.map(([px, py]) => [px + offsetX, py + offsetY]);
  return { tiles, routePoints, start: routePoints[0], end: routePoints[routePoints.length - 1] };
}

export default function RouteMap({ polyline, sessionId, distance, elevation }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(null);
  const [center, setCenter] = useState(null); // global pixel coords at current zoom
  const dragRef = useRef(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const decoded = useMemo(() => {
    if (!polyline) return null;
    const pts = decodePolyline(polyline);
    return pts.length >= 2 ? pts : null;
  }, [polyline]);

  // Compute initial zoom and center from route bounds
  const initial = useMemo(() => {
    if (!decoded || size.width === 0) return null;
    const lats = decoded.map(p => p[0]);
    const lngs = decoded.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const z = fitZoom(minLat, maxLat, minLng, maxLng, size.width, size.height);
    const pixels = decoded.map(([lat, lng]) => latLngToPixel(lat, lng, z));
    const pxs = pixels.map(p => p[0]);
    const pys = pixels.map(p => p[1]);
    const cx = (Math.min(...pxs) + Math.max(...pxs)) / 2;
    const cy = (Math.min(...pys) + Math.max(...pys)) / 2;
    return { zoom: z, centerX: cx, centerY: cy };
  }, [decoded, size.width, size.height]);

  // Set initial state once
  const initialApplied = useRef(false);
  if (initial && !initialApplied.current) {
    initialApplied.current = true;
    setZoom(initial.zoom);
    setCenter({ x: initial.centerX, y: initial.centerY });
  }

  const activeZoom = zoom ?? initial?.zoom;
  const activeCenter = center ?? (initial ? { x: initial.centerX, y: initial.centerY } : null);

  const mapData = useMemo(() => {
    if (!decoded || !activeCenter || activeZoom == null || size.width === 0) return null;
    return computeTilesAndRoute(decoded, activeZoom, activeCenter.x, activeCenter.y, size.width, size.height);
  }, [decoded, activeZoom, activeCenter?.x, activeCenter?.y, size.width, size.height]);

  // Wheel zoom — zoom toward mouse position
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!activeCenter || activeZoom == null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -1 : 1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, activeZoom + delta));
    if (newZoom === activeZoom) return;

    // Convert mouse position to global pixel at old zoom, then recompute center at new zoom
    const globalMouseX = activeCenter.x + (mouseX - size.width / 2);
    const globalMouseY = activeCenter.y + (mouseY - size.height / 2);
    const scale = Math.pow(2, newZoom - activeZoom);
    const newGlobalMouseX = globalMouseX * scale;
    const newGlobalMouseY = globalMouseY * scale;
    const newCenterX = newGlobalMouseX - (mouseX - size.width / 2);
    const newCenterY = newGlobalMouseY - (mouseY - size.height / 2);

    setZoom(newZoom);
    setCenter({ x: newCenterX, y: newCenterY });
  }, [activeCenter, activeZoom, size.width, size.height]);

  // Attach wheel as non-passive so preventDefault works
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan via drag + tap-to-zoom for touch
  const handlePointerDown = useCallback((e) => {
    if (!activeCenter) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startCenter: { ...activeCenter },
      moved: false, time: Date.now(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [activeCenter]);

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    if (dragRef.current.moved) {
      setCenter({
        x: dragRef.current.startCenter.x - dx,
        y: dragRef.current.startCenter.y - dy,
      });
    }
  }, []);

  const handlePointerUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved || !activeCenter || activeZoom == null || !containerRef.current) return;
    if (Date.now() - drag.time > 400) return; // not a tap

    // Tap: zoom in +1 and center on tap point
    const rect = containerRef.current.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const tapY = e.clientY - rect.top;
    const newZoom = Math.min(MAX_ZOOM, activeZoom + 1);
    if (newZoom === activeZoom) return;

    const globalTapX = activeCenter.x + (tapX - size.width / 2);
    const globalTapY = activeCenter.y + (tapY - size.height / 2);
    const scale = Math.pow(2, newZoom - activeZoom);
    setZoom(newZoom);
    setCenter({ x: globalTapX * scale, y: globalTapY * scale });
  }, [activeCenter, activeZoom, size.width, size.height]);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    if (!initial) return;
    initialApplied.current = false;
    setZoom(initial.zoom);
    setCenter({ x: initial.centerX, y: initial.centerY });
  }, [initial]);

  const isMovedFromInitial = initial && activeZoom != null && activeCenter &&
    (activeZoom !== initial.zoom || Math.abs(activeCenter.x - initial.centerX) > 1 || Math.abs(activeCenter.y - initial.centerY) > 1);

  const hue = seededHue(sessionId || 'default');
  const routeColor = `hsl(${hue}, 60%, 55%)`;
  const distanceKm = distance ? (distance / 1000).toFixed(1) : null;
  const elevationM = elevation ? Math.round(elevation) : null;
  const svgPoints = mapData?.routePoints?.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') || '';

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#1a1a2e',
        cursor: dragRef.current ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      {mapData && (
        <>
          <div style={{ position: 'absolute', inset: 0 }}>
            {mapData.tiles.map(t => (
              <img
                key={t.key}
                src={t.url}
                alt=""
                draggable={false}
                style={{ position: 'absolute', left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE }}
              />
            ))}
          </div>
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <polyline points={svgPoints} fill="none" stroke={routeColor} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
            <polyline points={svgPoints} fill="none" stroke={routeColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
            {mapData.start && <circle cx={mapData.start[0]} cy={mapData.start[1]} r="6" fill="#4ade80" stroke="#166534" strokeWidth="2" />}
            {mapData.end && <circle cx={mapData.end[0]} cy={mapData.end[1]} r="6" fill="#f87171" stroke="#991b1b" strokeWidth="2" />}
          </svg>
        </>
      )}
      {(distanceKm || elevationM != null) && (
        <div style={{
          position: 'absolute', bottom: 8, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: '1rem',
          color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem',
          textShadow: '0 1px 4px rgba(0,0,0,0.9)', pointerEvents: 'none',
        }}>
          {distanceKm && <span>{distanceKm} km</span>}
          {elevationM != null && elevationM > 0 && <span>{elevationM}m elev</span>}
        </div>
      )}
      {isMovedFromInitial && (
        <button
          onClick={handleDoubleClick}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 28, height: 28,
            border: 'none', borderRadius: 4,
            background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.8)',
            fontSize: '1rem', lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Reset zoom"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1v4h4" /><path d="M1 5a6 6 0 1 1 1.5 4" />
          </svg>
        </button>
      )}
      <span style={{
        position: 'absolute', bottom: 2, right: 4,
        fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
      }}>© OpenStreetMap</span>
    </div>
  );
}
