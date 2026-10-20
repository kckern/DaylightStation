import { useEffect, useRef, useState } from 'react';
import { Button, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useBarcodeScanner } from "../../../../../frontend/src/lib/camera/useBarcodeScanner.js";

const logger = createAppLogger('health').child('barcode-capture');

/**
 * Camera barcode scan with a manual-UPC field that is ALWAYS present —
 * it is the permission-denied fallback and the test seam: both paths call
 * the same onDecode(upc, bucket).
 *
 * The camera itself (native detector, zxing fallback, stream lifecycle) is
 * the shared `useBarcodeScanner`; this sheet owns the manual field, the
 * lookup and its error.
 *
 * `bucket` names which meal launched this scan (set by the caller before
 * opening the sheet); it is forwarded back unchanged on decode so the
 * caller can apply it without needing to track "which button opened this
 * modal" itself. Undefined for the footer's clock-based launch.
 */
export function BarcodeCapture({ open, onClose, onDecode, busy, bucket }) {
  const videoRef = useRef(null);
  const [manualUpc, setManualUpc] = useState('');
  const [error, setError] = useState(null);
  const callback = useRef(onDecode);
  callback.current = onDecode;
  const bucketRef = useRef(bucket);
  bucketRef.current = bucket;
  const submitted = useRef(false);
  const decodeRef = useRef(null);

  const { cameraState, stop } = useBarcodeScanner({
    active: Boolean(open), videoRef, logger,
    onDecode: (upc) => decodeRef.current?.(upc, bucketRef.current),
  });

  const decode = async (upc, targetBucket) => {
    if (submitted.current) return;
    submitted.current = true;
    stop();
    setError(null);
    try { await callback.current(upc, targetBucket); }
    catch (err) { setError(err?.message || 'Lookup failed. Try again.'); submitted.current = false; setManualUpc(upc); }
  };
  decodeRef.current = decode;

  useEffect(() => {
    if (!open) return;
    submitted.current = false;
    setError(null);
    setManualUpc('');
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      {error ? <Text role="alert" c="red" size="sm">{error}</Text> : null}
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
          onClick={() => decode(manualUpc.trim(), bucket)}>Look up</Button>
      </div>
    </Sheet>
  );
}
export default BarcodeCapture;
