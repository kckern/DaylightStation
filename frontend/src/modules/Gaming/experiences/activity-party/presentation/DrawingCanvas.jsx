import { useEffect, useRef, useState } from 'react';
import { DrawingTabletAdapter } from '../../../platform/input/DrawingTabletAdapter.js';

export default function DrawingCanvas({ ink = '#111111', width = 6, cursor = 'crosshair', initialStrokes = [], onCheckpoint, onFinish }) {
  const canvasRef = useRef(null); const historyRef = useRef([]); const strokesRef = useRef(new Map()); const [tool, setTool] = useState('ink');
  const redraw = () => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of historyRef.current) { ctx.strokeStyle = stroke.eraser ? '#ffffff' : stroke.ink; ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.beginPath(); stroke.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y); ctx.stroke(); }
  };
  useEffect(() => { historyRef.current = structuredClone(initialStrokes); redraw(); }, [initialStrokes]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return undefined;
    const adapter = new DrawingTabletAdapter({ element: canvas, onIntent(intent) {
      const value = intent.value;
      const pointerId = intent.controller_id;
      if (intent.phase === 'press') { const stroke = { ink, width: Math.max(1, width * value.pressure), eraser: tool === 'eraser' || value.eraser, points: [value] }; strokesRef.current.set(pointerId, stroke); historyRef.current.push(stroke); redraw(); }
      else if (intent.phase === 'change') { const stroke = strokesRef.current.get(pointerId); if (stroke) { stroke.points.push(value); redraw(); } }
      else if (intent.phase === 'release') { const stroke = strokesRef.current.get(pointerId); const previous = stroke?.points.at(-1); if (stroke && previous && (previous.x !== value.x || previous.y !== value.y)) stroke.points.push(value); strokesRef.current.delete(pointerId); redraw(); onCheckpoint?.(structuredClone(historyRef.current)); }
    } });
    return adapter.connect();
  }, [ink, onCheckpoint, tool, width]);
  return <section className="party-games-drawing"><canvas ref={canvasRef} width={1280} height={720} aria-label="Drawing canvas" style={{ cursor }} />
    <nav><button type="button" onClick={() => setTool('ink')} aria-pressed={tool === 'ink'}>Ink</button><button type="button" onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'}>Eraser</button><button type="button" onClick={() => { historyRef.current.pop(); redraw(); onCheckpoint?.(structuredClone(historyRef.current)); }}>Undo</button><button type="button" onClick={() => { historyRef.current = []; redraw(); onCheckpoint?.([]); }}>Clear</button><button type="button" onClick={onFinish}>Finish</button></nav>
  </section>;
}
