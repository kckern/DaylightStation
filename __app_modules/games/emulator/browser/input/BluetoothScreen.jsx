/**
 * BluetoothScreen — one screen for every Bluetooth input device on the garage
 * box, all rows keyed by address:
 *   list     paired devices (one status each, Test, Forget pressed twice),
 *            "How to pair <label>" for configured controllers not paired,
 *            and Search for devices;
 *   guide    a configured controller's steps from input.yml, then its search;
 *   search   a live nearby list that never pairs on its own;
 *   pairing  the picked address only (big passkey when the device needs one);
 *   test     what the device sends, and whether games can use it.
 *
 * Host-agnostic: the host passes `bluetooth` (state + actions, see
 * useFitnessBluetooth) and input.yml's `controllers` and `keyboard`. The
 * screen owns its navigation (useScreenNav), so every host gets the same keys.
 * Every device word comes from input.yml or the device; nothing names one.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { defaultFocus, useScreenNav } from './useScreenNav.js';
import { PairedList } from './PairedList.jsx';
import { NearbyList } from './NearbyList.jsx';
import { KeyTest } from './KeyTest.jsx';
import {
  forgetText, hiddenNearbyCount, nearbyRows, pairHints, pairView, pairedRows, scanView,
} from './bluetoothScreenModel.js';
import './BluetoothScreen.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'bluetooth-screen' }));

const TITLE = { list: 'Bluetooth', guide: 'How to pair', search: 'Search for devices', pairing: 'Pairing', test: 'Test' };
const EMPTY = [];

export function BluetoothScreen({
  controllers = EMPTY, keyboardMap = null, bluetooth = null, getGamepads, onClose, titleId, host = 'unknown', notice = null,
}) {
  const ownTitleId = useId();
  const headingId = titleId || ownTitleId;
  const rootRef = useRef(null);
  const [view, setView] = useState({ name: 'list' });
  const [showAll, setShowAll] = useState(false);
  const [forgetAsked, setForgetAsked] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const bt = bluetooth || {};
  const scan = bt.scan;
  const scanning = !!scan && scan.phase !== 'done';

  // The satellite's `done` empties the nearby list. Keep the last rows this
  // search heard so a device can still be picked after the countdown ends
  // (pairing by address runs its own discovery).
  const lastHeard = useRef({ requestId: null, devices: EMPTY });
  if (scan?.requestId !== lastHeard.current.requestId) lastHeard.current = { requestId: scan?.requestId ?? null, devices: EMPTY };
  if (Array.isArray(scan?.devices) && scan.devices.length) lastHeard.current.devices = scan.devices;
  const heardDevices = lastHeard.current.devices;

  const rows = useMemo(() => pairedRows(bt.inventory, controllers), [bt.inventory, controllers]);
  const hints = useMemo(() => pairHints(controllers, bt.inventory), [controllers, bt.inventory]);
  const nearby = useMemo(
    () => nearbyRows(heardDevices, { showAll, inventory: bt.inventory, controllers, highlightId: view.highlightId || null }),
    [heardDevices, showAll, bt.inventory, controllers, view.highlightId],
  );
  const hidden = showAll ? 0 : hiddenNearbyCount(heardDevices);
  const guide = view.name === 'guide' ? hints.find((h) => h.id === view.id) || null : null;
  const pairingNow = view.name === 'pairing' && bt.pairing?.requestId === view.requestId ? bt.pairing : null;
  const pv = pairView(pairingNow || (view.name === 'pairing' ? { phase: 'scanning', optimistic: true } : null), view.label);
  const pairBusy = !!bt.pairing && pairView(bt.pairing, '').busy;
  const sv = scanView(scan, now);
  const forgetMsg = forgetAsked && bt.forgetResult?.address === forgetAsked ? forgetText(bt.forgetResult) : null;

  // Mount: log, and ask for the inventory (it is otherwise sent only on change).
  useEffect(() => {
    logger().info('bluetooth-screen.mount', {
      host, controllers: controllers.length, available: !!bluetooth,
      inventory: Array.isArray(bluetooth?.inventory) ? bluetooth.inventory.length : null,
    });
    bluetooth?.requestInventory?.();
    return () => logger().info('bluetooth-screen.unmount', { host });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing the screen ends a running search.
  const stopOnClose = useRef(null);
  stopOnClose.current = scanning ? bt.stopScan : null;
  useEffect(() => () => {
    if (stopOnClose.current) {
      logger().info('bluetooth-screen.scan-stop', { reason: 'close' });
      stopOnClose.current('close');
    }
  }, []);

  useEffect(() => {
    if (!scanning) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [scanning]);

  const heard = heardDevices.length;
  useEffect(() => {
    if (scanning) logger().sampled('bluetooth-screen.nearby', { heard, shown: nearby.length, showAll }, { maxPerMinute: 6, aggregate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, showAll]);

  // A pairing that ends: connected → straight into the key test; failed → logged.
  useEffect(() => {
    if (view.name !== 'pairing' || !pairingNow || pv.busy) return;
    if (pv.tone === 'ok') {
      logger().info('bluetooth-screen.pair-result', { address: view.address, outcome: 'connected' });
      setView({ name: 'test', address: view.address, label: view.label, kind: view.kind, from: 'pair' });
    } else if (pv.tone === 'error') {
      logger().info('bluetooth-screen.pair-result', {
        address: view.address, outcome: 'failed', code: pairingNow.code || null, reason: pairingNow.reason || null,
      });
    }
  }, [view, pairingNow, pv.busy, pv.tone]);

  // Each view opens on its default control ([data-autofocus]), and so does a
  // pairing that just ended (focus moves to Search again). The key test lands
  // its own focus.
  useEffect(() => {
    logger().info('bluetooth-screen.view', { view: view.name, address: view.address || null, highlightId: view.highlightId || null });
  }, [view.name, view.address, view.highlightId]);
  useEffect(() => {
    if (view.name === 'test') return;
    defaultFocus(rootRef.current)?.focus();
  }, [view.name, pv.busy]);

  const startSearch = (highlightId = null) => {
    setShowAll(false);
    setView({ name: 'search', highlightId });
    logger().info('bluetooth-screen.scan-start', { highlightId });
    bt.startScan?.();
  };
  const stopSearch = (reason) => {
    if (!scanning) return;
    logger().info('bluetooth-screen.scan-stop', { reason });
    bt.stopScan?.(reason);
  };
  const pick = (row) => {
    logger().info('bluetooth-screen.pick', { address: row.address, controllerId: row.controllerId, paired: !!row.paired, kind: row.kind || null });
    const requestId = bt.pairAddress?.({ address: row.address, controllerId: row.controllerId, label: row.name, pin: row.pin });
    setView({ name: 'pairing', requestId, address: row.address, label: row.name, kind: row.kind });
  };
  const back = () => {
    if (view.name === 'list') { onClose?.(); return; }
    if (view.name === 'search') stopSearch('back');
    setView({ name: 'list' });
  };
  const finishTest = ({ keys, padInputs, verdict }) => {
    logger().info('bluetooth-screen.test-result', {
      address: view.address, from: view.from, keys: keys.length, distinctKeys: new Set(keys).size, padInputs, verdict,
    });
    setView({ name: 'list' });
  };

  useScreenNav({
    rootRef, active: view.name !== 'test', onBack: back, getGamepads,
    onRecover: (why) => logger().debug('bluetooth-screen.focus-recovered', { why, view: view.name }),
  });

  return (
    <div className="bluetooth-screen" ref={rootRef} data-view={view.name}>
      <header className="bts-header">
        <h3 id={headingId} className="bts-title">{guide ? `How to pair ${guide.label}` : TITLE[view.name]}</h3>
        {view.name === 'list' && onClose ? <button type="button" className="bts-button" onClick={onClose}>Close</button> : null}
        {view.name !== 'list' && view.name !== 'test' ? <button type="button" className="bts-button" onClick={back}>Back</button> : null}
      </header>
      {notice ? <p className="bts-notice" role="note">{notice}</p> : null}
      {!bluetooth ? <p className="bts-empty">Bluetooth is not available on this screen.</p> : null}

      {bluetooth && view.name === 'list' && (
        <>
          <section className="bts-section" aria-label="Paired devices">
            <h4 className="bts-heading">Paired devices</h4>
            {Array.isArray(bt.inventory) ? (
              <PairedList
                rows={rows}
                busy={pairBusy}
                onArm={(r) => logger().info('bluetooth-screen.forget-arm', { address: r.address })}
                onForget={(r) => {
                  logger().info('bluetooth-screen.forget-confirm', { address: r.address, controllerId: r.controllerId });
                  setForgetAsked(r.address);
                  bt.forget?.(r.address);
                }}
                onTest={(r) => {
                  logger().info('bluetooth-screen.test-start', { address: r.address, from: 'row' });
                  setView({ name: 'test', address: r.address, label: r.name, kind: r.kind, from: 'row' });
                }}
                onPairAgain={(r) => pick(r)}
              />
            ) : <p className="bts-empty">Checking Bluetooth…</p>}
            {forgetMsg ? <p className="bts-result">{forgetMsg}</p> : null}
          </section>
          {hints.length > 0 && (
            <section className="bts-section" aria-label="How to pair">
              <ul className="bts-list">
                {hints.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="bts-button bts-hint-button" onClick={() => setView({ name: 'guide', id: h.id })}>
                      How to pair {h.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(null)}>
            Search for devices
          </button>
        </>
      )}

      {view.name === 'guide' && guide && (
        <section className="bts-section bts-guide">
          {guide.mode ? <p className="bts-hint">{guide.mode}</p> : null}
          <ol className="bts-steps">{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(guide.id)}>Search for it</button>
        </section>
      )}

      {view.name === 'search' && (
        <section className="bts-section bts-search">
          <p className={`bts-status-line bts-tone-${sv.tone}`} role="status">{sv.text}</p>
          {!scanning && view.highlightId ? (
            <p className="bts-hint">{hints.find((h) => h.id === view.highlightId)?.troubleshoot}</p>
          ) : null}
          <NearbyList rows={nearby} hidden={hidden} showAll={showAll} onToggleShowAll={() => setShowAll((v) => !v)} onPick={pick} busy={pairBusy} />
          {scanning
            ? <button type="button" className="bts-button" data-autofocus onClick={() => stopSearch('user')}>Stop</button>
            : <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(view.highlightId || null)}>Search again</button>}
        </section>
      )}

      {view.name === 'pairing' && (
        <section className="bts-section bts-pairing">
          <p className={`bts-status-line bts-tone-${pv.tone}`} role="status">{pv.text}</p>
          {pv.passkey ? <p className="bts-passkey" aria-label={`Code ${pv.passkey}`}>{pv.passkey}</p> : null}
          {pv.next ? <p className="bts-hint">{pv.next}</p> : null}
          {!pv.busy && pv.tone === 'error' ? (
            <div className="bts-actions">
              <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(null)}>Search again</button>
              <button type="button" className="bts-button" onClick={() => setView({ name: 'list' })}>Done</button>
            </div>
          ) : null}
        </section>
      )}

      {view.name === 'test' && (
        <KeyTest
          name={view.label}
          kind={view.kind}
          keyboardMap={keyboardMap}
          getGamepads={getGamepads}
          note={view.from === 'pair' ? 'Connected.' : null}
          onDone={finishTest}
        />
      )}
    </div>
  );
}

export default BluetoothScreen;
