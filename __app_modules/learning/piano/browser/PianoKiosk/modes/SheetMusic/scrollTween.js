// scrollTween — retargetable rAF scroll animation.
//
// Native smooth scrollIntoView CANCELS the in-flight animation whenever a new
// call lands, so per-note cursor following stutters above ~2 steps/sec
// (audit C1). This tween instead RETARGETS: a new call updates the
// destination and the running frame loop glides on from wherever it is.

const STATE = Symbol('scrollTween');

export function tweenScrollTo(el, target, { duration = 180 } = {}) {
  if (!el) return;
  const existing = el[STATE];
  const next = {
    from: { left: el.scrollLeft, top: el.scrollTop },
    to: {
      left: target.left != null ? Math.max(0, target.left) : el.scrollLeft,
      top: target.top != null ? Math.max(0, target.top) : el.scrollTop,
    },
    start: performance.now(),
    duration,
  };
  if (existing) { Object.assign(existing, next); return; } // retarget in flight
  const s = (el[STATE] = next);
  const frame = () => {
    const k = Math.min(1, (performance.now() - s.start) / s.duration);
    const e = 1 - (1 - k) ** 3; // ease-out cubic
    el.scrollLeft = s.from.left + (s.to.left - s.from.left) * e;
    el.scrollTop = s.from.top + (s.to.top - s.from.top) * e;
    if (k < 1) s.raf = requestAnimationFrame(frame);
    else el[STATE] = null;
  };
  s.raf = requestAnimationFrame(frame);
}

export function cancelScrollTween(el) {
  const s = el?.[STATE];
  if (s) { cancelAnimationFrame(s.raf); el[STATE] = null; }
}

export default { tweenScrollTo, cancelScrollTween };
