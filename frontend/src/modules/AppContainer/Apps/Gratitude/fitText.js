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
 * Shrink-to-fit for every `selector` match inside `containerRef`: each element
 * starts at the font size its stylesheet declares and shrinks only as far as
 * needed to sit within `maxLines` lines with no word overflowing sideways.
 * Below `minRatio` of the declared size it stops shrinking and wraps onto more
 * lines instead — text is never clipped or ellipsized.
 *
 * Re-fits when `deps` change and when the container is resized.
 */
export function useFitText(containerRef, { selector, maxLines = 2, minRatio = 0.6, minPx = 14, lineHeight = 1.15 }, deps = []) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const fitAll = () => {
      if (!container.isConnected) return;
      const els = [...container.querySelectorAll(selector)];
      if (!els.length) return;
      // Pass 1 (one layout): reset to the stylesheet size and read it.
      els.forEach((el) => { el.style.fontSize = ''; el.style.lineHeight = String(lineHeight); });
      const declared = els.map((el) => parseFloat(getComputedStyle(el).fontSize) || 16);
      const fitsAt = (el, px) => el.scrollWidth <= el.clientWidth + 1
        && el.scrollHeight <= px * lineHeight * maxLines + 1;
      // Pass 2: only elements that overflow at full size get searched.
      const overflowing = els.filter((el, i) => !fitsAt(el, declared[i]));
      for (const el of overflowing) {
        const maxPx = declared[els.indexOf(el)];
        const floor = Math.max(minPx, maxPx * minRatio);
        const px = fitFontPx({
          maxPx,
          minPx: floor,
          fits: (size) => { el.style.fontSize = `${size}px`; return fitsAt(el, size); },
        });
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
  }, [containerRef, selector, maxLines, minRatio, minPx, lineHeight, ...deps]);
}
