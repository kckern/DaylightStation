/**
 * htmlAudioClip — a Clip handle backed by an HTMLAudioElement.
 *
 * Conforms to the AudioMixer Clip contract: { play(), stop(), setVolume(v), onEnded(cb) }.
 *
 * The Audio constructor is injected (defaulting to the global `Audio`) so tests
 * can pass a fake — jsdom's Audio implementation is unreliable for these props.
 *
 * @param {string} url
 * @param {{loop?: boolean}} [opts]
 * @param {{AudioCtor?: any}} [injected]
 * @returns {{play():void, stop():void, setVolume(v:number):void, onEnded(cb:Function):void}}
 */
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function createHtmlAudioClip(
  url,
  { loop = false } = {},
  { AudioCtor = typeof Audio !== 'undefined' ? Audio : null } = {}
) {
  // Graceful degradation: with no Audio available, return a no-op clip.
  if (!AudioCtor) {
    return {
      play() {},
      stop() {},
      setVolume() {},
      onEnded() {},
    };
  }

  const el = new AudioCtor(url);
  el.loop = !!loop;

  return {
    play() {
      el.play();
    },
    stop() {
      el.pause();
      el.currentTime = 0;
    },
    setVolume(v) {
      el.volume = clamp01(v);
    },
    onEnded(cb) {
      el.addEventListener('ended', cb);
    },
  };
}

export default createHtmlAudioClip;
