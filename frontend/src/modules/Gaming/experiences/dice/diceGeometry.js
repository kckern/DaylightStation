import * as THREE from 'three';

export function geometryFor(sides) {
  if (sides === 4) return new THREE.TetrahedronGeometry(1.4);
  if (sides === 6) return new THREE.BoxGeometry(2, 2, 2);
  if (sides === 8) return new THREE.OctahedronGeometry(1.4);
  if (sides === 10) {
    const vertices = [0, 0, 1.45, 0, 0, -1.45]; const ring = 10;
    for (let index = 0; index < ring; index += 1) { const angle = (index * Math.PI * 2) / ring; vertices.push(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, index % 2 ? -.32 : .32); }
    const indices = [];
    for (let index = 0; index < ring; index += 1) { const current = index + 2; const next = ((index + 1) % ring) + 2; indices.push(0, current, next, 1, next, current); }
    return new THREE.PolyhedronGeometry(vertices, indices, 1.4, 0);
  }
  if (sides === 12) return new THREE.DodecahedronGeometry(1.4);
  return new THREE.IcosahedronGeometry(1.4);
}

export function percentileFaces(value) {
  return value === 100 ? [0, 0] : [Math.floor(value / 10) * 10, value % 10];
}
