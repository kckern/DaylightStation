import React, { useMemo } from 'react';
import { seededHue } from '../_shared/SportIcon.jsx';

/**
 * Decode a Google Encoded Polyline string to [lat, lng] pairs.
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Project lat/lng points to SVG coordinates.
 */
function projectPoints(points, width, height, padding = 20) {
  if (points.length === 0) return [];

  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const drawW = width - padding * 2;
  const drawH = height - padding * 2;
  const scale = Math.min(drawW / lngRange, drawH / latRange);

  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;

  return points.map(([lat, lng]) => [
    width / 2 + (lng - cx) * scale,
    height / 2 - (lat - cy) * scale,
  ]);
}

export default function StravaRouteMap({ polyline, sessionId, distance, elevation }) {
  const { svgPoints, start, end } = useMemo(() => {
    if (!polyline) return { svgPoints: '', start: null, end: null };
    const decoded = decodePolyline(polyline);
    if (decoded.length < 2) return { svgPoints: '', start: null, end: null };

    const projected = projectPoints(decoded, 400, 300);
    const svgPoints = projected.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return {
      svgPoints,
      start: projected[0],
      end: projected[projected.length - 1],
    };
  }, [polyline]);

  if (!svgPoints) return null;

  const hue = seededHue(sessionId || 'default');
  const routeColor = `hsl(${hue}, 60%, 55%)`;

  const distanceKm = distance ? (distance / 1000).toFixed(1) : null;
  const elevationM = elevation ? Math.round(elevation) : null;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)',
      borderRadius: '8px',
    }}>
      <svg viewBox="0 0 400 300" style={{ width: '100%', maxHeight: '80%' }}>
        <polyline
          points={svgPoints}
          fill="none"
          stroke={routeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        <polyline
          points={svgPoints}
          fill="none"
          stroke={routeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.15"
        />
        {start && (
          <circle cx={start[0]} cy={start[1]} r="6" fill="#4ade80" stroke="#166534" strokeWidth="2" />
        )}
        {end && (
          <circle cx={end[0]} cy={end[1]} r="6" fill="#f87171" stroke="#991b1b" strokeWidth="2" />
        )}
      </svg>
      {(distanceKm || elevationM) && (
        <div style={{ display: 'flex', gap: '1rem', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          {distanceKm && <span>{distanceKm} km</span>}
          {elevationM != null && elevationM > 0 && <span>{elevationM}m elev</span>}
        </div>
      )}
    </div>
  );
}
