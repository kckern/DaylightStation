import { useEffect, useRef, useState } from 'react';
import { Button, Group, NativeSelect, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useBarcodeScanner } from "../../../../../frontend/src/lib/camera/useBarcodeScanner.js";

const logger = createAppLogger('health').child('quick-scan');

const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const TOAST_MS = { logged: 6000, unknown: 9000, failed: 9000, undone: 2500 };
const MAX_TOASTS = 3;

/**
 * Scan after scan, from the home-screen shortcut.
 *
 * The camera never stops and nothing asks for a tap between items. Each beep
 * becomes a toast: the code is looked up and logged at once ("Logged Granola",
 * with Undo while the toast shows). A code that is unknown but a few digits from
 * a food the owner has scanned before (a camera misread) logs that food, saying
 * so. A code nobody knows says so and the camera keeps going; entering its
 * details is offered, never required. The only way out is Done, or Back.
 */
export function QuickScanSession({ onClose, onDecode, onConfirm, onDone, onUnknown, onUndo, bucket, meals }) {
  const videoRef = useRef(null);
  const live = useRef(true);
  const controllers = useRef(new Set());
  const timers = useRef(new Map());
  const targetRef = useRef(bucket);
  const [target, setTarget] = useState(bucket);
  const [toasts, setToasts] = useState([]);
  const [paused, setPaused] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [manualUpc, setManualUpc] = useState('');
  targetRef.current = target;
  const mealLabel = id => meals?.find(meal => meal.value === id)?.label;

  const { cameraState } = useBarcodeScanner({
    active: !paused, continuous: true, restartKey: generation, videoRef, logger,
    onDecode: upc => { if (live.current) void handle(upc); },
  });
  const deniedRef = useRef(false);
  deniedRef.current = cameraState === 'denied';

  useEffect(() => {
    live.current = true;
    const pause = () => setPaused(true);
    const onVisibility = () => {
      if (document.hidden) { pause(); return; }
      // Back from the shade or another app: the camera comes back by itself, and a refused
      // camera is asked again (the owner may just have allowed it in Settings).
      setPaused(false);
      if (deniedRef.current) setGeneration(value => value + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', pause);
    window.addEventListener('pagehide', pause);
    window.addEventListener('daylight:hidden', pause);
    logger.info('opened', { bucket });
    return () => {
      live.current = false;
      controllers.current.forEach(controller => controller.abort());
      timers.current.forEach(timer => clearTimeout(timer));
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', pause);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('daylight:hidden', pause);
    };
  }, []);

  const update = (id, patch) => {
    if (!live.current) return;
    setToasts(list => list.map(toast => (toast.id === id ? { ...toast, ...patch } : toast)));
    const ms = TOAST_MS[patch.state];
    if (!ms) return;
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      if (live.current) setToasts(list => list.filter(toast => toast.id !== id || toast.busy));
    }, ms));
  };

  const beep = () => {
    const bridge = window.DaylightPhoneShortcut;
    if (typeof bridge?.postMessage === 'function') bridge.postMessage('barcode-beep');
  };

  async function handle(upc) {
    beep();
    const id = crypto.randomUUID();
    const meal = targetRef.current;
    setToasts(list => [{ id, upc, state: 'reading' }, ...list].slice(0, MAX_TOASTS));
    logger.info('scan.read', { upc });
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const found = await onDecode(upc, meal, controller.signal);
      if (!live.current || controller.signal.aborted) return;
      const item = found?.product ? found : found?.suggestions?.[0];
      if (!item?.product) {
        logger.info('scan.unknown', { upc });
        update(id, { state: 'unknown' });
        return;
      }
      const guessed = !found.product;
      update(id, { state: 'logging', name: item.product.name });
      const operationId = crypto.randomUUID();
      const confirmed = await onConfirm({ operationId, upc: item.upc, product: item.product, bucket: meal });
      logger.info('scan.logged', { upc, loggedUpc: item.upc, guessed, meal });
      update(id, { state: 'logged', name: item.product.name, kcal: item.product.calories, meal,
        guessed, undoToken: confirmed?.undoToken, operationId });
    } catch (err) {
      if (!live.current || controller.signal.aborted) return;
      logger.warn('scan.failed', { upc, error: err?.message, status: err?.status });
      update(id, { state: 'failed', message: err?.body?.error });
    } finally {
      controllers.current.delete(controller);
    }
  }

  const undo = async toast => {
    if (!toast.undoToken || toast.busy) return;
    update(toast.id, { busy: true });
    const success = await onUndo(toast.undoToken, message => update(toast.id, { busy: false, message }), `undo-${toast.operationId}`);
    logger.info('scan.undo', { upc: toast.upc, success });
    if (success) update(toast.id, { busy: false, state: 'undone' });
    else update(toast.id, { busy: false });
  };

  const submitManual = event => {
    event.preventDefault();
    const upc = manualUpc.trim();
    if (!upc) return;
    setManualUpc('');
    void handle(upc);
  };

  const denied = cameraState === 'denied';
  const line = toast => ({
    reading: 'Got it…',
    logging: `Logging ${toast.name}…`,
    logged: [toast.guessed ? `Logged ${toast.name} (closest match)` : `Logged ${toast.name}`,
      toast.kcal != null ? `${toast.kcal} kcal` : null, mealLabel(toast.meal)].filter(Boolean).join(' · '),
    unknown: `Not found: ${toast.upc}`,
    failed: toast.message || 'Could not log that one. Scan it again.',
    undone: `Removed ${toast.name}`,
  }[toast.state]);

  return (
    <Sheet open onClose={onClose} title="Scan barcode" placement="fullscreen">
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden',
        background: '#12211b' /* data-color: camera stage */ }}>
        {/* The WebView paints a stretched play glyph on a <video> until its first frame: the poster
            is blank and the element stays hidden until the stream is live. */}
        <video ref={videoRef} muted playsInline autoPlay poster={BLANK_POSTER}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxHeight: 'none',
            display: 'block', objectFit: 'cover', objectPosition: 'center',
            opacity: cameraState === 'live' ? 1 : 0, transition: 'opacity 120ms' }} />
        {!denied && <>
          <div aria-hidden="true" style={{ position: 'absolute', left: '8%', right: '8%', top: '50%',
            transform: 'translateY(-50%)', height: 'min(22vw, 22dvh)', border: '2px solid white',
            borderRadius: 10, boxShadow: '0 0 0 100vmax #0006', // data-color: scan guide
            pointerEvents: 'none' }} />
          <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '8%', right: '8%',
            height: 2, background: '#6deab0', // data-color: scan line
            pointerEvents: 'none' }} />
        </>}
      </div>
      {meals?.length > 0 && (
        <div style={{ position: 'absolute', top: '3.5rem', left: '1rem', zIndex: 1 }}>
          <NativeSelect size="xs" aria-label="Meal" data={meals} value={target} onChange={event => setTarget(event.target.value)} />
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'max(1rem, env(safe-area-inset-bottom))',
        display: 'grid', gap: '0.5rem', justifyItems: 'center', padding: '0 1rem', color: 'white' }}>
        {toasts.map(toast => (
          <div key={toast.id} role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: toast.state === 'logged' ? '#1d6b4bee' : '#000c', // data-color: scrim card
            borderRadius: 999,
            padding: '0.5rem 0.5rem 0.5rem 1rem', maxWidth: '100%', minHeight: 44 }}>
            <Text size="sm" fw={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{line(toast)}</Text>
            {toast.state === 'logged' && toast.undoToken && (
              <Button size="compact-sm" variant="white" color="dark" loading={toast.busy}
                aria-label="Undo logged item" onClick={() => undo(toast)}>Undo</Button>
            )}
            {toast.state === 'unknown' && onUnknown && (
              <Button size="compact-sm" variant="white" color="dark"
                onClick={() => onUnknown(toast.upc, target)}>Add details</Button>
            )}
          </div>
        ))}
        {!toasts.length && (
          <Text size="sm" style={{ textShadow: '0 1px 6px black' }}>
            {denied ? 'Camera is off. Allow it in Settings, or type the number.' : 'Point at a barcode. Keep scanning; each one logs itself.'}
          </Text>
        )}
        {denied && (
          <Group component="form" gap="xs" wrap="nowrap" onSubmit={submitManual}>
            <TextInput size="md" inputMode="numeric" placeholder="UPC number" value={manualUpc}
              onChange={event => setManualUpc(event.target.value)} aria-label="Manual UPC entry" />
            <Button type="submit" size="md" disabled={!manualUpc.trim()}>Look up</Button>
          </Group>
        )}
        <Button size="md" onClick={onDone}>Done</Button>
      </div>
    </Sheet>
  );
}

export default QuickScanSession;
