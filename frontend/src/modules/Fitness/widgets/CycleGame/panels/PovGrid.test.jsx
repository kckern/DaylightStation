import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// jsdom has no WebGL: mock the three.js stack + camera-controls so the component
// mounts and we can assert the React-owned avatar overlay (the contract tests cover).
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }),
}));

vi.mock('camera-controls', () => {
  class CC {
    constructor() { this.mouseButtons = {}; this.touches = {}; this.distance = 10; }
    setLookAt() {} update() {} getTarget(v) { return v || { x: 0, y: 0, z: 0 }; } dispose() {}
  }
  CC.install = () => {};
  CC.ACTION = { NONE: 0 };
  return { default: CC };
});

vi.mock('three', () => {
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    applyMatrix4() { return this; }
    project() { return this; }
  }
  class Geom {
    constructor() { this.attributes = {}; }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    setFromPoints() { return this; }
    setDrawRange() {}
    dispose() {}
  }
  class Obj3D { constructor() { this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 }; this.visible = true; this.frustumCulled = true; } }
  return {
    Scene: class { constructor() { this.fog = null; } add() {} remove() {} },
    Fog: class {},
    Color: class {},
    DoubleSide: 2,
    PerspectiveCamera: class { constructor() { this.position = new V3(); this.aspect = 1; this.fov = 55; this.matrixWorldInverse = {}; } updateProjectionMatrix() {} },
    WebGLRenderer: class { constructor() { this.domElement = document.createElement('canvas'); } setPixelRatio() {} setSize() {} render() {} dispose() {} },
    BufferGeometry: Geom,
    PlaneGeometry: class { dispose() {} },
    Float32BufferAttribute: class { constructor() { this.needsUpdate = false; } },
    BufferAttribute: class { constructor() { this.needsUpdate = false; } },
    LineBasicMaterial: class { constructor() { this.color = { setHex() {} }; this.opacity = 1; } },
    ShaderMaterial: class { constructor(o) { this.uniforms = (o && o.uniforms) || {}; } dispose() {} },
    Mesh: Obj3D,
    LineSegments: Obj3D,
    Line: Obj3D,
    Vector3: V3,
  };
});

import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'Ada', cumulativeDistanceM: 120 },
  b: { displayName: 'Ben', cumulativeDistanceM: 80 },
  c: { displayName: 'Cy', cumulativeDistanceM: 0 }, // not moved
};

describe('PovGrid (three.js shell)', () => {
  beforeEach(() => cleanup());

  it('renders the race-pov root', () => {
    const { getByTestId } = render(<PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />);
    expect(getByTestId('race-pov')).toBeTruthy();
  });

  it('renders one card per moved, non-DNF rider', () => {
    const { getAllByTestId } = render(<PovGrid riderIds={['a', 'b', 'c']} riders={riders} riderLive={{}} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(2); // c has 0 distance
  });

  it('excludes DNF riders', () => {
    const { getAllByTestId } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{ b: { dnf: true } }} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(1);
  });

  it('marks ghost riders', () => {
    const field = { a: { displayName: 'Ada', cumulativeDistanceM: 50, isGhost: true } };
    const { getByTestId } = render(<PovGrid riderIds={['a']} riders={field} riderLive={{}} />);
    expect(getByTestId('pov-marker').className).toContain('is-ghost');
  });

  it('shows a distance label per card', () => {
    const { getByText } = render(<PovGrid riderIds={['a']} riders={{ a: { displayName: 'Ada', cumulativeDistanceM: 120 } }} riderLive={{}} />);
    expect(getByText(/120/)).toBeTruthy();
  });

  it('applies the canonical cg-ghost class to ghost markers on the POV', () => {
    cleanup();
    const riders = {
      a: { displayName: 'Ada', cumulativeDistanceM: 120, isGhost: false },
      g: { displayName: 'Ghost', cumulativeDistanceM: 90, isGhost: true }
    };
    const riderLive = { a: { avatarSrc: '' }, g: { avatarSrc: '' } };
    const { container } = render(
      <PovGrid riderIds={['a', 'g']} riders={riders} riderLive={riderLive} />
    );
    const markers = container.querySelectorAll('.cg-pov__marker');
    const ghost = [...markers].find((m) => m.className.includes('is-ghost'));
    expect(ghost).toBeTruthy();
    expect(ghost.className).toContain('cg-ghost');
  });
});
