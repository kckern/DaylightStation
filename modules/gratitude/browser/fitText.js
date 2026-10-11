import { useLayoutEffect } from 'react';

/**
 * Largest integer px in [minPx, maxPx] for which `fits(px)` holds; minPx when
 * none does. Assumes fits is monotonic (smaller text never fits worse).
 */
export function fitFontPx({ maxPx, minPx, fits }) {
  let lo = Math.ceil(minPx);
  let hi = Math.floor(maxPx);
  if (hi <= lo) return lo;
  if (fits(hi)) return hi;
  let best = lo;
  hi -= 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/**
 * Staged fit: try each stage in order (e.g. one line down to 75%, then two
 * lines down to 60%) and take the largest size from the first stage whose
 * floor fits. When no stage fits, the last stage's floor is returned and the
 * text wraps onto more lines — never clipped.
 * @param {{ maxPx: number, minPx: number, stages: {lines: number, minRatio: number}[], fitsAt: (px: number, lines: number) => boolean }} o
 */
export function fitStaged({ maxPx, minPx, stages, fitsAt }) {
  let last = Math.max(minPx, maxPx);
  for (const { lines, minRatio } of stages) {
    const floor = Math.min(maxPx, Math.max(minPx, Math.ceil(maxPx * minRatio)));
    last = floor;
    if (!fitsAt(floor, lines)) continue;
    return fitFontPx({ maxPx, minPx: floor, fits: (px) => fitsAt(px, lines) });
  }
  return last;
}

/**
 * Shrink-to-fit for every `selector` match inside `containerRef`: each element
 * starts at the font size its stylesheet declares (the maximum) and shrinks
 * only as far as needed, stage by stage (see fitStaged), with no word
 * overflowing sideways. Past the last stage's floor it wraps onto more lines —
 * text is never clipped or ellipsized.
 *
 * Re-fits when `deps` change and when the container is resized.
 */
export function useFitText(containerRef, {
  selector,
  stages = [{ lines: 1, minRatio: 0.75 }, { lines: 2, minRatio: 0.6 }],
  minPx = 14,
  lineHeight = 1.15,
}, deps = []) {
  const stagesKey = JSON.stringify(stages);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const plan = JSON.parse(stagesKey);

    const fitAll = () => {
      if (!container.isConnected) return;
      const els = [...container.querySelectorAll(selector)];
      if (!els.length) return;
      // Pass 1 (one layout): reset to the stylesheet size and read it.
      els.forEach((el) => { el.style.fontSize = ''; el.style.lineHeight = String(lineHeight); });
      const declared = els.map((el) => parseFloat(getComputedStyle(el).fontSize) || 16);
      const measure = (el, px, lines) => {
        el.style.fontSize = `${px}px`;
        return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= px * lineHeight * lines + 1;
      };
      // Pass 2: elements already fitting the first stage at full size are done.
      const firstLines = plan[0]?.lines ?? 1;
      const pending = els
        .map((el, i) => ({ el, maxPx: declared[i] }))
        .filter(({ el, maxPx }) => !(el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= maxPx * lineHeight * firstLines + 1));
      for (const { el, maxPx } of pending) {
        const px = fitStaged({ maxPx, minPx, stages: plan, fitsAt: (size, lines) => measure(el, size, lines) });
        el.style.fontSize = `${px}px`;
      }
    };

    fitAll();
    let frame = 0;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitAll); })
      : null;
    observer?.observe(container);
    document.fonts?.ready?.then(fitAll);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, selector, stagesKey, minPx, lineHeight, ...deps]);
}
