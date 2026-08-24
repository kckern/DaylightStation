import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { diceRendererKind } from '@shared-gaming/mechanics/dice.mjs';
import { geometryFor, percentileFaces } from './diceGeometry.js';

function WebGlDie({ sides, value, delay = 0, onFailure }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current; if (!element) return undefined;
    let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (error) { onFailure(error); return undefined; }
    renderer.setSize(180, 180); element.replaceChildren(renderer.domElement);
    const contextLost = (event) => { event.preventDefault(); onFailure(new Error('WebGL context lost')); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(42, 1, .1, 100); camera.position.z = 5;
    const mesh = new THREE.Mesh(geometryFor(sides), new THREE.MeshStandardMaterial({ color: 0xe6b325, roughness: .32, metalness: .2 })); scene.add(mesh);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x25305e, 3));
    let frame; const start = performance.now() + delay;
    const draw = (now) => { const progress = Math.max(0, Math.min(1, (now - start) / 700)); const eased = 1 - (1 - progress) ** 3; mesh.rotation.x = eased * Math.PI * (2 + value % 3); mesh.rotation.y = eased * Math.PI * (3 + value % 5); renderer.render(scene, camera); if (progress < 1) frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); renderer.domElement.removeEventListener('webglcontextlost', contextLost); mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose(); element.replaceChildren(); };
  }, [delay, onFailure, sides, value]);
  return <div className="dice-3d"><div ref={ref} /><span>{value}</span></div>;
}

export default function PolyhedralDice({ outcome, onFailure = null }) {
  const [rendererFailed, setRendererFailed] = React.useState(false);
  useEffect(() => setRendererFailed(false), [outcome]);
  const rendererFailure = React.useCallback((error) => { setRendererFailed(true); onFailure?.({ renderer: 'three-polyhedron', error }); }, [onFailure]);
  if (!outcome) return <div className="dice-empty">Choose dice and roll</div>;
  const webgl = typeof WebGLRenderingContext !== 'undefined'; const renderer = diceRendererKind(outcome.sides, { webgl });
  const values = outcome.sides === 100 ? outcome.rolls.flatMap(percentileFaces) : outcome.rolls;
  if (rendererFailed || renderer === 'deterministic-2d' || renderer === 'percentile-pair') return <div className={`dice-fallback dice-fallback--${renderer}`}>{values.map((value, index) => <span key={`${index}:${value}`}>{String(value).padStart(outcome.sides === 100 && index % 2 === 0 ? 2 : 1, '0')}</span>)}</div>;
  return <div className="dice-polyhedra">{values.map((value, index) => <WebGlDie key={`${index}:${value}`} sides={outcome.sides} value={value} delay={index * 70} onFailure={rendererFailure} />)}</div>;
}
