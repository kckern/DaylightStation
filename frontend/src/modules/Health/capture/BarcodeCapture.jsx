import { useEffect, useRef, useState } from 'react';
import { Button, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('barcode-capture');

/**
 * Camera barcode scan with a manual-UPC field that is ALWAYS present —
 * it is the permission-denied fallback and the test seam: both paths call
 * the same onDecode(upc, bucket).
 *
 * `bucket` names which meal launched this scan (set by the caller before
 * opening the sheet); it is forwarded back unchanged on decode so the
 * caller can apply it without needing to track "which button opened this
 * modal" itself. Undefined for the footer's clock-based launch.
 */
export function BarcodeCapture({ open, onClose, onDecode, busy, bucket }) {
  const videoRef = useRef(null);
  const [manualUpc, setManualUpc] = useState('');
  const [cameraState, setCameraState] = useState('starting'); // starting | live | denied

  useEffect(() => {
    if (!open) return undefined;
    let stream, stopped = false, zxingControls = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState('live');

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8'] });
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (stopped) return; // sheet closed while detect() was in flight — don't fire a spurious submit
              if (codes.length) { logger.info('decode.native', {}); return onDecode(codes[0].rawValue, bucket); }
            } catch { /* frame not ready */ }
            if (stopped) return;
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result && !stopped) { logger.info('decode.zxing', {}); onDecode(result.getText(), bucket); }
          });
        }
      } catch (err) {
        logger.warn('camera.unavailable', { error: err?.message });
        setCameraState('denied');
      }
    })();

    return () => {
      stopped = true;
      zxingControls?.stop?.();
      stream?.getTracks?.().forEach((t) => t.stop());
    };
  }, [open, onDecode]);

  return (
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      {cameraState !== 'denied' ? (
        <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 9 }} />
      ) : (
        <Text size="sm" c="dimmed">Camera unavailable — enter the barcode number instead.</Text>
      )}
      <div className="health-barcode__manual">
        <TextInput size="sm" className="health-barcode__manual-input" inputMode="numeric" placeholder="UPC number"
          value={manualUpc} onChange={(e) => setManualUpc(e.target.value)}
          aria-label="Manual UPC entry" />
        <Button size="sm" loading={busy} disabled={!manualUpc.trim()}
          onClick={() => onDecode(manualUpc.trim(), bucket)}>Look up</Button>
      </div>
    </Sheet>
  );
}
export default BarcodeCapture;
