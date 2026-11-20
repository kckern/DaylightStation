import { useEffect, useRef, useState } from 'react';
import { Button, Group, NativeSelect, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useBarcodeScanner } from "../../../../../frontend/src/lib/camera/useBarcodeScanner.js";

const logger = createAppLogger('health').child('barcode-capture');

export function BarcodeCapture({ open, ...props }) {
  return open ? <BarcodeSession {...props} /> : null;
}

function BarcodeSession({ onClose, onDecode, onConfirm, onDone, onView, onUnknown, onUndo, undoBusy, undoError, bucket, meals }) {
  const videoRef = useRef(null);
  const audio = useRef(null);
  const live = useRef(false);
  const lookup = useRef(null);
  const armed = useRef(true);
  const saving = useRef(false);
  const scanGeneration = useRef(0);
  const commitRequest = useRef(null);
  const [manualUpc, setManualUpc] = useState('');
  const [phase, setPhase] = useState('scanning');
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null);
  const [result, setResult] = useState(null);
  const [undone, setUndone] = useState(false);
  const [target, setTarget] = useState(bucket);
  const [generation, setGeneration] = useState(0);

  const { cameraState, stop } = useBarcodeScanner({
    active: phase === 'scanning', restartKey: generation, videoRef, logger,
    onDecode: upc => { if (live.current && scanGeneration.current === generation && armed.current) void decode(upc, true); },
  });

  useEffect(() => {
    live.current = true;
    const pause = () => {
      if (!armed.current) return;
      armed.current = false;
      stop();
      setPhase('paused');
    };
    const onVisibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', pause);
    window.addEventListener('pagehide', pause);
    onVisibility();
    return () => {
      live.current = false;
      lookup.current?.abort();
      const context = audio.current;
      audio.current = null;
      if (context) void context.close().catch(() => {});
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', pause);
      window.removeEventListener('pagehide', pause);
    };
  }, [stop]);

  const unlockSound = () => {
    try {
      if (!window.AudioContext) return;
      audio.current ??= new window.AudioContext();
      if (audio.current.state === 'suspended') void audio.current.resume().catch(() => {});
    } catch { /* The scan confirmation still appears on screen. */ }
  };

  const beep = () => {
    const context = audio.current;
    if (context?.state !== 'running') return;
    try {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const now = context.currentTime;
      oscillator.frequency.value = 960;
      volume.gain.setValueAtTime(0.07, now);
      volume.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      oscillator.connect(volume);
      volume.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.12);
    } catch { /* Audio feedback is optional. */ }
  };

  const close = () => {
    live.current = false;
    lookup.current?.abort();
    stop();
    onClose();
  };

  async function decode(upc, fromCamera = false) {
    if (lookup.current || !live.current) return;
    armed.current = false;
    stop();
    setError(null);
    setManualUpc(upc);
    setPhase('looking-up');
    if (fromCamera) beep();
    const controller = new AbortController();
    lookup.current = controller;
    try {
      const found = await onDecode(upc, target, controller.signal);
      if (!live.current || controller.signal.aborted || !found) return;
      setRead(found);
      setPhase(found.product ? 'review' : 'unknown');
    } catch (err) {
      if (!live.current || controller.signal.aborted) return;
      setError(err?.body?.error || 'Could not look up the barcode. Try again.');
      setPhase('lookup-error');
    } finally {
      if (lookup.current === controller) lookup.current = null;
    }
  }

  const scanAnother = () => {
    armed.current = true;
    scanGeneration.current += 1;
    setGeneration(scanGeneration.current);
    commitRequest.current = null;
    setManualUpc('');
    setError(null);
    setRead(null);
    setResult(null);
    setUndone(false);
    setPhase('scanning');
  };

  const confirm = async () => {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    setPhase('committing');
    commitRequest.current ??= { operationId: crypto.randomUUID(), upc: read.upc, product: read.product, bucket: target };
    try {
      const confirmed = await onConfirm(commitRequest.current);
      if (!live.current) return;
      setResult(confirmed);
      setPhase('logged');
    } catch (err) {
      if (!live.current) return;
      const refusal = err?.status >= 400 && err.status < 500 && ![408, 425, 429].includes(err.status);
      if (refusal) commitRequest.current = null;
      setError(refusal ? err?.body?.error || "Couldn't log this food." : 'Could not confirm this barcode log. Try again to check its result.');
      setPhase(refusal ? 'review' : 'uncertain');
    } finally {
      saving.current = false;
    }
  };

  return (
    <Sheet open onClose={close} title="Scan barcode">
      {error && <Text role="alert" c="red" size="sm">{error}</Text>}
      {phase === 'scanning' && (cameraState !== 'denied' ? (
        <div onPointerDown={unlockSound} style={{ position: 'relative', overflow: 'hidden', borderRadius: 14,
          background: '#12211b', aspectRatio: '4 / 3' }}>
          <video ref={videoRef} muted playsInline
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
          <div aria-hidden="true" style={{ position: 'absolute', inset: '35% 10%',
            border: '2px solid white', borderRadius: 10, boxShadow: '0 0 0 100vmax #0006',
            pointerEvents: 'none' }} />
          <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '10%',
            right: '10%', height: 2, background: '#6deab0', pointerEvents: 'none' }} />
        </div>
      ) : (
        <Text size="sm" c="dimmed">Camera unavailable — enter the barcode number instead.</Text>
      ))}
      <Text size="sm" c="dimmed" role="status">
        {phase === 'looking-up' && 'Barcode read. Looking up food…'}
        {phase === 'review' && 'Barcode read. Review the food and meal.'}
        {phase === 'scanning' && cameraState !== 'denied' && 'Center the barcode inside the guide.'}
        {phase === 'committing' && 'Logging item…'}
        {phase === 'logged' && (undone ? 'Log undone' : 'Logged')}
        {phase === 'paused' && 'Camera paused.'}
      </Text>
      {['scanning', 'paused', 'lookup-error'].includes(phase) && (
        <div className="health-barcode__manual">
          <TextInput size="sm" className="health-barcode__manual-input" inputMode="numeric" placeholder="UPC number"
            value={manualUpc} onChange={event => setManualUpc(event.target.value)} aria-label="Manual UPC entry" />
          <Button size="sm" disabled={!manualUpc.trim()} onClick={() => decode(manualUpc.trim())}>Look up</Button>
        </div>
      )}
      {phase === 'review' && <>
        <Text fw={600}>{read.product.name}</Text>
        <Text>{read.product.amount} {read.product.unit} · {read.product.calories} kcal</Text>
        <NativeSelect label="Meal" data={meals} value={target} onChange={event => setTarget(event.target.value)} />
      </>}
      {phase === 'unknown' && <Text>No food with a usable portion was found for this barcode.</Text>}
      {phase === 'logged' && undoError && <Text role="alert" c="red" size="sm">{undoError}</Text>}
      <Group mt="md">
        {(['scanning', 'review', 'unknown', 'lookup-error', 'paused'].includes(phase)) && <Button variant="subtle" onClick={close}>Cancel</Button>}
        {(['looking-up', 'committing', 'uncertain'].includes(phase)) && <Button variant="subtle" onClick={close}>Back</Button>}
        {phase === 'review' && <Button onClick={confirm}>Log item</Button>}
        {phase === 'uncertain' && <Button onClick={confirm}>Retry log</Button>}
        {phase === 'unknown' && <Button onClick={() => onUnknown(read.upc, target)}>Enter food details</Button>}
        {(['logged', 'unknown', 'lookup-error', 'paused'].includes(phase)) && <Button variant="default" onClick={scanAnother}>Scan another</Button>}
        {phase === 'logged' && <>
          {!undone && <Button variant="subtle" onClick={() => onView(result)}>View in Health</Button>}
          {!undone && result.undoToken && <Button variant="subtle" aria-label="Undo logged item" loading={undoBusy}
            onClick={async () => { if (await onUndo(result.undoToken) && live.current) setUndone(true); }}>Undo</Button>}
          <Button onClick={onDone}>Done</Button>
        </>}
      </Group>
    </Sheet>
  );
}
export default BarcodeCapture;
