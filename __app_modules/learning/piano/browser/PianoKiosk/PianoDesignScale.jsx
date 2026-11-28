import { useEffect, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-design-scale' });
  return _logger;
}

const KEYBOARD_MARGIN = 16; // CSS px kept between the focused field and the keyboard

function isEditable(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(type);
}

/**
 * Fixed design canvas for the kiosk (piano.yml `display.designWidth/Height`,
 * default 1280×800 — the SM-T590 tablet's CSS viewport). The whole app lays
 * out at the design resolution and scales uniformly to fit the real viewport,
 * so a desktop browser shows exactly the tablet's layout (letterboxed when
 * aspect differs). On the tablet itself the scale is 1 — a no-op.
 *
 * ON-SCREEN KEYBOARD. On the tablet, focusing a text field (Composer's song
 * title) raises Android's keyboard and the WebView resizes to the top half:
 * innerHeight 800 → ~400. Rescaling to that would shrink the WHOLE app to 50%
 * in a letterboxed box above the keyboard (seen live 2026-11-27). A
 * height-only shrink while an editable element has focus is the keyboard, not
 * a new screen, so the scale is held: the canvas pins to the top and lifts
 * only as far as needed to keep the focused field above the keyboard. The
 * next resize with no keyboard recomputes as before.
 *
 * Cue from the screen framework's physical-size telemetry: normalize on CSS
 * pixels at a declared design size rather than chasing every viewport.
 * Disabled (children pass through untouched) when either dimension is unset.
 */
export default function PianoDesignScale({ width, height, children }) {
  const enabled = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const [layout, setLayout] = useState({ scale: 1, keyboard: false, lift: 0 });
  const canvasRef = useRef(null);
  const lastRef = useRef({ w: 0, h: 0, scale: 1, keyboard: false });

  useEffect(() => {
    if (!enabled) return undefined;
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const last = lastRef.current;
      const focused = document.activeElement;
      // last.w/h stay the full (keyboard-down) size while holding, so the
      // keyboard closing (h back to full) or a rotation (w changes) releases.
      const holding = last.w > 0 && w === last.w && h < last.h && isEditable(focused);

      if (holding) {
        let lift = 0;
        const canvas = canvasRef.current;
        if (canvas && focused?.getBoundingClientRect) {
          const top = canvas.getBoundingClientRect().top;
          const el = focused.getBoundingClientRect();
          // Field bottom relative to the canvas top (already in scaled px).
          const bottom = el.bottom - top;
          lift = Math.max(0, bottom - (h - KEYBOARD_MARGIN));
        }
        if (!last.keyboard) logger().info('keyboard.hold', { scale: last.scale, innerHeight: h, fullHeight: last.h, lift });
        lastRef.current = { ...last, keyboard: true };
        setLayout({ scale: last.scale, keyboard: true, lift });
        return;
      }

      const scale = Math.min(w / width, h / height);
      if (last.keyboard) logger().info('keyboard.release', { innerHeight: h, scale });
      lastRef.current = { w, h, scale, keyboard: false };
      setLayout({ scale, keyboard: false, lift: 0 });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [enabled, width, height]);

  if (!enabled) return children;
  const { scale, keyboard, lift } = layout;
  return (
    <div className={`piano-design-viewport${keyboard ? ' is-keyboard-open' : ''}`}>
      <div
        ref={canvasRef}
        className="piano-design-canvas"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: keyboard ? `translateY(${-lift}px) scale(${scale})` : `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
