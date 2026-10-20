/**
 * useBarcodeScanner — the rear camera, read for a retail barcode.
 *
 * Shared by Health (food UPCs) and School (book ISBNs). It owns the camera
 * and nothing else: the native `BarcodeDetector` where the browser has one, a
 * lazily loaded `@zxing/browser` reader where it does not, and the stream's
 * whole lifecycle. It reports ONE decode per start and then releases the
 * camera, so a caller never debounces a barcode held in front of the lens.
 * What a decoded value means — a UPC, an ISBN, nothing — is the caller's
 * business; to scan again after rejecting one, change `restartKey`.
 *
 * `cameraState`: `idle` (inactive) | `starting` | `live` | `denied`. Denied
 * covers a refused permission AND a browser with no camera API: both mean
 * "type the number instead".
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const RETAIL_BARCODE_FORMATS = Object.freeze(['upc_a', 'upc_e', 'ean_13', 'ean_8']);

/**
 * @param {object} args
 * @param {boolean} args.active - camera on while true
 * @param {{current: HTMLVideoElement|null}} args.videoRef - the element the caller renders
 * @param {(value: string) => void} args.onDecode - called once per start
 * @param {string[]} [args.formats]
 * @param {unknown} [args.restartKey] - change it to start a fresh scan
 * @param {{info?: Function, warn?: Function}|null} [args.logger]
 */
export function useBarcodeScanner({
  active, videoRef, onDecode, formats = RETAIL_BARCODE_FORMATS, restartKey = 0, logger = null,
}) {
  const [cameraState, setCameraState] = useState('idle');
  const callback = useRef(onDecode);
  callback.current = onDecode;
  const stopRef = useRef(() => {});

  useEffect(() => {
    if (!active) {
      setCameraState('idle');
      return undefined;
    }
    let stream = null;
    let stopped = false;
    let fired = false;
    let zxingControls = null;
    const stop = () => {
      stopped = true;
      zxingControls?.stop?.();
      stream?.getTracks?.().forEach((track) => track.stop());
    };
    stopRef.current = stop;
    const emit = (value, via) => {
      if (stopped || fired) return;
      fired = true;
      logger?.info?.(`decode.${via}`, {});
      stop();
      callback.current?.(value);
    };

    setCameraState('starting');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API in this browser');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) throw new Error('no video element to show the camera in');
        video.srcObject = stream;
        await video.play();
        if (stopped) return;
        setCameraState('live');

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: [...formats] });
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (stopped) return; // closed while detect() was in flight
              if (codes.length) { emit(codes[0].rawValue, 'native'); return; }
            } catch { /* frame not ready */ }
            if (!stopped) requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) emit(result.getText(), 'zxing');
          });
          // A decode that fired before the controls existed could not stop them.
          if (stopped) zxingControls?.stop?.();
        }
      } catch (error) {
        logger?.warn?.('camera.unavailable', { error: error?.message });
        if (!stopped) {
          stop();
          setCameraState('denied');
        }
      }
    })();

    return stop;
    // `formats`, `logger` and `videoRef` are fixed per caller; restarting the
    // camera because a caller re-created an array would flash the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, restartKey]);

  const stop = useCallback(() => stopRef.current(), []);
  return { cameraState, stop };
}

export default useBarcodeScanner;
