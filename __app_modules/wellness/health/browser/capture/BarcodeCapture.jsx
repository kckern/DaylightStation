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

  // Quick scan never closes itself: a timed exit lost unknown products and the chance to undo.
  // The owner leaves with Done or Close; after each logged item the camera is ready for the next.
  const [last, setLast] = useState(null);
  const pausedByVisibility = useRef(false);
  const deniedRef = useRef(false);
  const mealLabel = id => meals?.find(meal => meal.value === id)?.label;

  const { cameraState, stop } = useBarcodeScanner({
    active: phase === 'scanning', restartKey: generation, videoRef, logger,
    onDecode: upc => { if (live.current && scanGeneration.current === generation && armed.current) void decode(upc, true); },
  });

  deniedRef.current = cameraState === 'denied';

  useEffect(() => {
    live.current = true;
    const pause = () => {
      if (!armed.current) return;
      armed.current = false;
      pausedByVisibility.current = true;
      stop();
      setPhase('paused');
    };
    const onVisibility = () => {
      if (document.hidden) { pause(); return; }
      if (!quickScan) return;
      // Back from the notification shade or another app: the camera comes back by itself, and a
      // camera that was refused is asked again (the owner may just have switched it on in Settings).
      if (pausedByVisibility.current) { pausedByVisibility.current = false; rearm(); }
      else if (deniedRef.current) { scanGeneration.current += 1; setGeneration(scanGeneration.current); }
    };
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

  const rearm = () => {
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

  const scanAnother = () => {
    setLast(null);
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
      const operationId = commitRequest.current.operationId;
      const confirmed = await onConfirm(commitRequest.current);
      if (!live.current) return;
      if (quickScan) {
        // Eager: the item is logged, so the camera is ready for the next one straight away, and the
        // card below holds what was logged with an Undo. Revising is a step after, never a gate.
        setLast({ name: item.product.name, kcal: item.product.calories, meal: mealLabel(target),
          undoToken: confirmed?.undoToken, operationId, busy: false, undone: false, error: null });
        rearm();
        return;
      }
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

  const undoLast = async () => {
    const item = last;
    if (!item?.undoToken || item.busy || item.undone) return;
    setLast({ ...item, busy: true, error: null });
    const success = await onUndo(item.undoToken, message => {
      if (live.current) setLast(current => current && { ...current, busy: false, error: message });
    }, `undo-${item.operationId}`);
    if (live.current) setLast(current => current && (success ? { ...current, busy: false, undone: true } : { ...current, busy: false }));
  };

  // The in-app scanner is a full-screen stage while it waits for a barcode (reference/health/README.md,
  // 8af94c15de): the camera fills the screen and the controls ride along the bottom, inside the safe
  // area. da70dff5e3 rebuilt this sheet and dropped the stage, leaving the camera in a 4:3 box.
  const stage = ['scanning', 'paused', 'lookup-error'].includes(phase);
  const edgeToEdge = quickScan || stage;
  const camera = phase === 'scanning' && cameraState !== 'denied' && (
    <div onPointerDown={unlockSound} style={{
      position: edgeToEdge ? 'absolute' : 'relative', inset: edgeToEdge ? 0 : undefined,
      overflow: 'hidden', borderRadius: edgeToEdge ? 0 : 14, background: '#12211b', // data-color: camera stage
      aspectRatio: edgeToEdge ? undefined : '4 / 3',
    }}>
      <video ref={videoRef} muted playsInline autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxHeight: 'none',
          display: 'block', objectFit: 'cover', objectPosition: 'center' }} />
      <div aria-hidden="true" style={{ position: 'absolute', left: '8%', right: '8%', top: '50%',
        transform: 'translateY(-50%)', height: edgeToEdge ? 'min(22vw, 22dvh)' : '30%',
        border: '2px solid white', borderRadius: 10, boxShadow: '0 0 0 100vmax #0006', // data-color: scan guide
        pointerEvents: 'none' }} />
      <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '8%',
        right: '8%', height: 2, background: '#6deab0', pointerEvents: 'none' }} /> // data-color: scan line
    </div>
  );
  const submitManual = event => {
    event.preventDefault();
    const upc = manualUpc.trim();
    if (upc) void decode(upc);
  };
  const manualControls = (
    <>
      <TextInput size="md" className="health-barcode__manual-input" inputMode="numeric" placeholder="UPC number"
        value={manualUpc} onChange={event => setManualUpc(event.target.value)} aria-label="Manual UPC entry" />
      <Button type="submit" size="md" className="ds-touch-target" disabled={!manualUpc.trim()}>Look up</Button>
    </>
  );
  const manual = quickScan ? (
    <Group component="form" gap="xs" wrap="nowrap" onSubmit={submitManual}>{manualControls}</Group>
  ) : (
    <form className="health-barcode__manual" onSubmit={submitManual}>{manualControls}</form>
  );

  if (quickScan) {
    const liveCamera = phase === 'scanning' && cameraState !== 'denied';
    const message = {
      scanning: liveCamera ? 'Center the barcode inside the guide.'
        : 'Camera is off. Allow it in Settings, then come back, or enter the number.',
      'looking-up': 'Looking up barcode…',
      committing: read?.product?.name ? `Logging ${read.product.name}…` : 'Logging item…',
      logged: `Logged ${read?.product?.name || 'item'}`,
      unknown: `No food found for ${read?.upc || 'this barcode'}.`,
      paused: 'Camera paused.',
      review: read?.product?.name,
    }[phase];
    const lastCard = last && (
      <div role="status" style={{ display: 'grid', gap: '0.5rem', justifyItems: 'center', background: '#000a', // data-color: scrim card
        borderRadius: 16, padding: '0.75rem 1rem', maxWidth: '92%' }}>
        <Text fw={700}>{last.undone ? 'Removed' : `Logged ${last.name}`}</Text>
        {!last.undone && <Text size="sm">{[last.kcal ? `${last.kcal} kcal` : null, last.meal].filter(Boolean).join(' · ')}</Text>}
        {last.error && <Text role="alert" size="sm">{last.error}</Text>}
        <Group gap="xs">
          {!last.undone && last.undoToken && <Button variant="default" aria-label="Undo logged item" loading={last.busy} onClick={undoLast}>Undo</Button>}
          <Button onClick={onDone}>Done</Button>
        </Group>
      </div>
    );
    return (
      <Sheet open onClose={close} title="Scan barcode" placement="fullscreen">
        {camera}
        {phase === 'scanning' && meals?.length > 0 && (
          <div style={{ position: 'absolute', top: '3.5rem', left: '1rem', zIndex: 1 }}>
            <NativeSelect size="xs" aria-label="Meal" data={meals} value={target} onChange={event => setTarget(event.target.value)} />
          </div>
        )}
        <div style={{
          position: 'absolute', display: 'grid', gap: '0.75rem', justifyItems: 'center',
          padding: '1rem', color: 'white', textAlign: 'center',
          ...(liveCamera ? { bottom: 'max(1rem, env(safe-area-inset-bottom))', left: 0, right: 0,
            textShadow: '0 1px 6px black' } : { inset: '3.5rem 0 0', alignContent: 'center' }),
        }}>
          {lastCard}
          {error ? <Text role="alert">{error}</Text> : <Text role="status">{message}</Text>}
          {phase === 'scanning' && liveCamera && !showManual && (
            <Button variant="default" onClick={() => setShowManual(true)}>Enter UPC</Button>
          )}
          {((phase === 'scanning' && (showManual || !liveCamera)) || phase === 'lookup-error') && manual}
          {['paused', 'lookup-error'].includes(phase) && <Button onClick={scanAnother}>Scan again</Button>}
          {phase === 'review' && <Button onClick={() => confirm()}>Log item</Button>}
          {phase === 'uncertain' && <Button onClick={() => confirm()}>Retry log</Button>}
          {phase === 'unknown' && <Group gap="xs">
            {onUnknown && <Button onClick={() => onUnknown(read.upc, target)}>Enter food details</Button>}
            <Button variant="default" onClick={rearm}>Scan next</Button>
          </Group>}
        </div>
      </Sheet>
    );
  }

  const body = (
    <>
      {error && <Text role="alert" c="red" size="sm">{error}</Text>}
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
        manual
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
    </>
  );
  return (
    <Sheet open onClose={close} title="Scan barcode" placement={stage ? 'fullscreen' : undefined}>
      {stage ? (
        <div className="health-barcode">
          {camera}
          <div className="health-barcode__bottom">{body}</div>
        </div>
      ) : <>{camera}{body}</>}
    </Sheet>
  );
}
export default BarcodeCapture;
