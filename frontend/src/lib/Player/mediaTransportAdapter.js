const clamp = (value, min = 0, max = Number.POSITIVE_INFINITY) => {
  if (!Number.isFinite(value)) return min;
  if (Number.isFinite(max)) {
    if (value > max) return max;
  }
  if (value < min) return min;
  return value;
};

const isFiniteNumber = (value) => Number.isFinite(value);

export function createMediaTransportAdapter({ controller, mediaRef, getMediaEl } = {}) {
  const upstream = controller || {};

  const resolveMediaElement = () => {
    if (typeof getMediaEl === 'function') {
      try {
        const el = getMediaEl();
        if (el) return el;
      } catch (_) {
        // ignore access errors
      }
    }
    return mediaRef?.current || null;
  };

  const readDurationFromElement = () => {
    const el = resolveMediaElement();
    return isFiniteNumber(el?.duration) ? el.duration : null;
  };

  const readCurrentTimeFromElement = () => {
    const el = resolveMediaElement();
    return isFiniteNumber(el?.currentTime) ? el.currentTime : null;
  };

  const seekElementTo = (seconds) => {
    if (!isFiniteNumber(seconds)) return null;
    const el = resolveMediaElement();
    if (!el) return null;
    const duration = readDurationFromElement();
    const next = clamp(seconds, 0, duration ?? Number.POSITIVE_INFINITY);
    try {
      el.currentTime = next;
    } catch (_) {
      // ignore assignment errors
    }
    return next;
  };

  const seekElementRelative = (delta) => {
    if (!isFiniteNumber(delta)) return null;
    const current = readCurrentTimeFromElement();
    if (!isFiniteNumber(current)) {
      return seekElementTo(delta);
    }
    const duration = readDurationFromElement();
    const next = clamp(current + delta, 0, duration ?? Number.POSITIVE_INFINITY);
    return seekElementTo(next);
  };

  const playElement = () => {
    const el = resolveMediaElement();
    if (!el?.play) return null;
    try {
      const result = el.play();
      if (typeof result?.catch === 'function') {
        result.catch(() => {});
      }
      return result;
    } catch (_) {
      return null;
    }
  };

  const pauseElement = () => {
    const el = resolveMediaElement();
    if (!el?.pause) return null;
    try {
      return el.pause();
    } catch (_) {
      return null;
    }
  };

  const createPlaybackState = () => {
    const el = resolveMediaElement();
    if (!el) return null;
    const paused = Boolean(el.paused);
    return {
      isPaused: paused,
      paused,
      isEnded: Boolean(el.ended),
      currentTime: readCurrentTimeFromElement(),
      duration: readDurationFromElement()
    };
  };

  const transport = {
    ...upstream,
    getCurrentTime: () => {
      const value = upstream.getCurrentTime?.();
      if (isFiniteNumber(value)) {
        return value;
      }
      const fallback = readCurrentTimeFromElement();
      return isFiniteNumber(fallback) ? fallback : 0;
    },
    getDuration: () => {
      const value = upstream.getDuration?.();
      if (isFiniteNumber(value) && value >= 0) {
        return value;
      }
      return readDurationFromElement();
    },
    seek: (seconds) => {
      if (isFiniteNumber(seconds) && typeof upstream.seek === 'function') {
        const result = upstream.seek(seconds);
        if (isFiniteNumber(result)) {
          return result;
        }
      }
      return seekElementTo(seconds);
    },
    seekRelative: (delta) => {
      if (isFiniteNumber(delta) && typeof upstream.seekRelative === 'function') {
        const result = upstream.seekRelative(delta);
        if (isFiniteNumber(result)) {
          return result;
        }
      }
      return seekElementRelative(delta);
    },
    play: () => {
      if (typeof upstream.play === 'function') {
        return upstream.play();
      }
      return playElement();
    },
    pause: () => {
      if (typeof upstream.pause === 'function') {
        return upstream.pause();
      }
      return pauseElement();
    },
    toggle: () => {
      if (typeof upstream.toggle === 'function') {
        return upstream.toggle();
      }
      const state = createPlaybackState();
      if (!state) return null;
      return state.isPaused ? playElement() : pauseElement();
    },
    getPlaybackState: () => {
      const state = upstream.getPlaybackState?.();
      if (state && typeof state === 'object') {
        return state;
      }
      return createPlaybackState();
    }
  };

  return transport;
}
