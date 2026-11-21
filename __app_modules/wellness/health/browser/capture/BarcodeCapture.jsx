import { useEffect, useRef, useState } from 'react';
import { Button, Group, NativeSelect, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useBarcodeScanner } from "../../../../../frontend/src/lib/camera/useBarcodeScanner.js";

const logger = createAppLogger('health').child('barcode-capture');

export function BarcodeCapture({ open, ...props }) {
  return open ? <BarcodeSession {...props} /> : null;
}

function BarcodeSession({ onClose, onDecode, onConfirm, onDone, onView, onUnknown, onUndo, onStatus, undoBusy, bucket, meals, quickScan = false }) {
  const videoRef = useRef(null);
  const audio = useRef(null);
  const live = useRef(false);
  const lookup = useRef(null);
  const armed = useRef(true);
  const saving = useRef(false);
  const scanGeneration = useRef(0);
  const commitRequest = useRef(null);
  const [manualUpc, setManualUpc] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [phase, setPhase] = useState('scanning');
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null);
  const [result, setResult] = useState(null);
  const [undoFeedback, setUndoFeedback] = useState(null);
  const currentUndo = undoFeedback?.token === result?.undoToken ? undoFeedback : null;
  const undone = currentUndo?.undone;
  const [target, setTarget] = useState(bucket);
  const [generation, setGeneration] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!quickScan || !['logged', 'unknown'].includes(phase)) return;
    const timeout = setTimeout(() => doneRef.current?.(), 1600);
    return () => clearTimeout(timeout);
  }, [quickScan, phase]);

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
    window.addEventListener('daylight:hidden', pause);
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
      window.removeEventListener('daylight:hidden', pause);
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
    const bridge = quickScan ? window.DaylightPhoneShortcut : null;
    if (typeof bridge?.postMessage === 'function') {
      bridge.postMessage('barcode-beep');
      return;
    }
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
      if (quickScan && fromCamera && found.product) await confirm(found);
      else setPhase(found.product ? 'review' : 'unknown');
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
    setUndoFeedback(null);
    setPhase('scanning');
  };

  const confirm = async (item = read) => {
    if (saving.current || !item?.product) return;
    saving.current = true;
    setError(null);
    setPhase('committing');
    commitRequest.current ??= { operationId: crypto.randomUUID(), upc: item.upc, product: item.product, bucket: target };
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

  const undoLogged = async () => {
    const token = result.undoToken;
    setUndoFeedback(null);
    const success = await onUndo(token, error => {
      if (live.current) setUndoFeedback({ token, error });
    }, `undo-${commitRequest.current.operationId}`);
    if (success && live.current) setUndoFeedback({ token, undone: true });
  };

  const camera = phase === 'scanning' && cameraState !== 'denied' && (
    <div onPointerDown={unlockSound} style={{
      position: quickScan ? 'absolute' : 'relative', inset: quickScan ? 0 : undefined,
      overflow: 'hidden', borderRadius: quickScan ? 0 : 14, background: '#12211b',
      aspectRatio: quickScan ? undefined : '4 / 3',
    }}>
      <video ref={videoRef} muted playsInline autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxHeight: 'none',
          display: 'block', objectFit: 'cover', objectPosition: 'center' }} />
      <div aria-hidden="true" style={{ position: 'absolute', left: '8%', right: '8%', top: '50%',
        transform: 'translateY(-50%)', height: quickScan ? 'min(22vw, 22dvh)' : '30%',
        border: '2px solid white', borderRadius: 10, boxShadow: '0 0 0 100vmax #0006',
        pointerEvents: 'none' }} />
      <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '8%',
        right: '8%', height: 2, background: '#6deab0', pointerEvents: 'none' }} />
    </div>
  );
  const manual = (
    <Group gap="xs" wrap="nowrap">
      <TextInput size="md" className="health-barcode__manual-input" inputMode="numeric" placeholder="UPC number"
        value={manualUpc} onChange={event => setManualUpc(event.target.value)} aria-label="Manual UPC entry" />
      <Button size="md" className="ds-touch-target" disabled={!manualUpc.trim()} onClick={() => decode(manualUpc.trim())}>Look up</Button>
    </Group>
  );

  if (quickScan) {
    const liveCamera = phase === 'scanning' && cameraState !== 'denied';
    const message = {
      scanning: liveCamera ? 'Center the barcode inside the guide.' : 'Camera unavailable.',
      'looking-up': 'Looking up barcode…',
      committing: read?.product?.name ? `Logging ${read.product.name}…` : 'Logging item…',
      logged: undone ? 'Log undone' : `Logged ${read?.product?.name || 'item'}`,
      unknown: 'No matching food found.',
      paused: 'Camera paused.',
      review: read?.product?.name,
    }[phase];
    return (
      <Sheet open onClose={close} title="Scan barcode" placement="fullscreen">
        {camera}
        <div style={{
          position: 'absolute', display: 'grid', gap: '0.75rem', justifyItems: 'center',
          padding: '1rem', color: 'white', textAlign: 'center',
          ...(liveCamera ? { bottom: 'max(1rem, env(safe-area-inset-bottom))', left: 0, right: 0,
            textShadow: '0 1px 6px black' } : { inset: '3.5rem 0 0', alignContent: 'center' }),
        }}>
          {error ? <Text role="alert">{error}</Text> : <Text role="status">{message}</Text>}
          {phase === 'scanning' && liveCamera && !showManual && (
            <Button variant="default" onClick={() => setShowManual(true)}>Enter UPC</Button>
          )}
          {((phase === 'scanning' && (showManual || !liveCamera)) || phase === 'lookup-error') && manual}
          {['paused', 'lookup-error'].includes(phase) && <Button onClick={scanAnother}>Scan again</Button>}
          {phase === 'review' && <Button onClick={() => confirm()}>Log item</Button>}
          {phase === 'uncertain' && <Button onClick={() => confirm()}>Retry log</Button>}
          {['logged', 'unknown'].includes(phase) && <Button variant="subtle" onClick={onDone}>Done</Button>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={close} title="Scan barcode">
      {error && <Text role="alert" c="red" size="sm">{error}</Text>}
      {camera}
      {phase === 'scanning' && cameraState === 'denied' && (
        <Text size="sm" c="dimmed">Camera unavailable — enter the barcode number instead.</Text>
      )}
      <Text size="sm" c="dimmed" role="status">
        {phase === 'looking-up' && 'Barcode read. Looking up food…'}
        {phase === 'review' && 'Barcode read. Review the food and meal.'}
        {phase === 'scanning' && cameraState !== 'denied' && 'Center the barcode inside the guide.'}
        {phase === 'committing' && 'Logging item…'}
        {phase === 'logged' && (undone ? 'Log undone' : quickScan && read?.product?.name ? `Logged ${read.product.name}` : 'Logged')}
        {phase === 'paused' && 'Camera paused.'}
      </Text>
      {['scanning', 'paused', 'lookup-error'].includes(phase) && (
        <div className="health-barcode__manual">
          <TextInput size="md" className="health-barcode__manual-input" inputMode="numeric" placeholder="UPC number"
            value={manualUpc} onChange={event => setManualUpc(event.target.value)} aria-label="Manual UPC entry" />
          <Button size="md" className="ds-touch-target" disabled={!manualUpc.trim()} onClick={() => decode(manualUpc.trim())}>Look up</Button>
        </div>
      )}
      {phase === 'review' && <>
        <Text fw={600}>{read.product.name}</Text>
        <Text>{read.product.amount} {read.product.unit} · {read.product.calories} kcal</Text>
        <NativeSelect label="Meal" data={meals} value={target} onChange={event => setTarget(event.target.value)} />
      </>}
      {phase === 'unknown' && <Text>No food with a usable portion was found for this barcode.</Text>}
      {phase === 'logged' && currentUndo?.error && <Text role="alert" c="red" size="sm">{currentUndo.error}</Text>}
      <Group mt="md">
        {(['scanning', 'review', 'unknown', 'lookup-error', 'paused'].includes(phase)) && <Button variant="subtle" onClick={close}>Cancel</Button>}
        {(['looking-up', 'committing', 'uncertain'].includes(phase)) && <Button variant="subtle" onClick={close}>Back</Button>}
        {phase === 'review' && <Button onClick={() => confirm()}>Log item</Button>}
        {phase === 'uncertain' && <Button onClick={() => confirm()}>Retry log</Button>}
        {!quickScan && phase === 'unknown' && <Button onClick={() => onUnknown(read.upc, target)}>Enter food details</Button>}
        {((!quickScan && ['logged', 'unknown'].includes(phase)) || ['lookup-error', 'paused'].includes(phase)) && <Button variant="default" onClick={scanAnother}>Scan another</Button>}
        {onStatus && ['scanning', 'committing', 'uncertain', 'logged'].includes(phase)
          && <Button variant="subtle" onClick={() => { close(); onStatus(); }}>Health status</Button>}
        {phase === 'logged' && <>
          {!quickScan && !undone && <Button variant="subtle" onClick={() => onView(result)}>View in Health</Button>}
          {!undone && result.undoToken && <Button variant="subtle" aria-label="Undo logged item" loading={undoBusy}
            onClick={undoLogged}>Undo</Button>}
          <Button onClick={onDone}>Done</Button>
        </>}
      </Group>
    </Sheet>
  );
}
export default BarcodeCapture;
