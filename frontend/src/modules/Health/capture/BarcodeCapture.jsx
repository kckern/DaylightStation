import { useEffect, useRef, useState } from 'react';
import { Button, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('barcode-capture');

/**
 * Camera barcode scan with a manual-UPC field that is ALWAYS present —
 * it is the permission-denied fallback and the test seam: both paths call
 * the same onDecode(upc).
 */
export function BarcodeCapture({ open, onClose, onDecode, busy }) {
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
              if (codes.length) { logger.info('decode.native', {}); return onDecode(codes[0].rawValue); }
            } catch { /* frame not ready */ }
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result && !stopped) { logger.info('decode.zxing', {}); onDecode(result.getText()); }
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
          onClick={() => onDecode(manualUpc.trim())}>Look up</Button>
      </div>
    </Sheet>
  );
}
export default BarcodeCapture;
