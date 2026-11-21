/**
 * BluetoothScreen — one screen for every Bluetooth input device on the garage
 * box, all rows keyed by address:
 *   list     paired devices on the left; the picked device's page on the
 *            right: its face (press a button and that keycap lights), one
 *            sentence on what games can do with it, Edit buttons, Forget;
 *   edit     set what each button on a remote does (behind the admin
 *            fingerprint unlock the host provides);
 *   guide    a configured controller's steps from input.yml, then its search;
 *   search   a live nearby list in first-seen order that never pairs on its own;
 *   pairing  the picked address only (big passkey when the device needs one).
 *
 * Host-agnostic: the host passes `bluetooth` (state + actions, see
 * useFitnessBluetooth; `remoteButtons` for the button editor) and input.yml's
 * `controllers` and `keyboard`. The screen owns its navigation (useScreenNav),
 * so every host gets the same keys. Every device word comes from input.yml or
 * the device; nothing names one.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { defaultFocus, useScreenNav } from './useScreenNav.js';
import { DeviceList } from './DeviceList.jsx';
import { DevicePage } from './DevicePage.jsx';
import { ButtonEditor } from './ButtonEditor.jsx';
import { NearbyList } from './NearbyList.jsx';
import { NAV_KEYS, usePressFeed } from './usePressFeed.js';
import { gameKeySet, normalizeKey, testVerdict } from './keyTestModel.js';
import { faceKind, padFace, remoteFace, savedFor } from './deviceFaceModel.js';
import {
  displayName, extendNearbyOrder, forgetText, hiddenNearbyCount, matchController, mergeHeard, nearbyRows, pairHints, pairView, pairedRows, scanView,
} from './bluetoothScreenModel.js';
import './BluetoothScreen.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'bluetooth-screen' }));

const TITLE = { list: 'Bluetooth', guide: 'How to pair', search: 'Search for devices', pairing: 'Pairing', edit: 'Edit buttons' };
const EMPTY = [];
const FORGET_MSG_MS = 6000;
const SAVE_FAILED = 'Could not save the buttons. Try Done again.';
// A device being paired: its input.yml label when it matches a controller.
const pairingName = (device, controllers) => (device?.address
  ? matchController(device, controllers)?.label || displayName(device)
  : 'a device');

export function BluetoothScreen({
  controllers = EMPTY, keyboardMap = null, bluetooth = null, getGamepads, onClose, titleId, host = 'unknown', notice = null,
}) {
  const ownTitleId = useId();
  const headingId = titleId || ownTitleId;
  const rootRef = useRef(null);
  const [view, setView] = useState({ name: 'list' });
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [forgetAsked, setForgetAsked] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [editPending, setEditPending] = useState(false);
  const [edit, setEdit] = useState(null); // { address, draft, keyedBy, picked, by, saving, error }
  const bt = bluetooth || {};
  const rb = bt.remoteButtons || null;
  const scan = bt.scan;
  const scanning = !!scan && scan.phase !== 'done';
  const gameKeys = useMemo(() => gameKeySet(keyboardMap), [keyboardMap]);

  // Every device this search has heard keeps its row, in first-seen order:
  // late names and new devices never move a row under the finger.
  const heardRef = useRef({ requestId: null, snapshot: null, map: new Map(), order: EMPTY });
  if (scan?.requestId !== heardRef.current.requestId) heardRef.current = { requestId: scan?.requestId ?? null, snapshot: null, map: new Map(), order: EMPTY };
  if (Array.isArray(scan?.devices) && scan.devices.length && scan.devices !== heardRef.current.snapshot) {
    const map = mergeHeard(heardRef.current.map, scan.devices);
    heardRef.current = { ...heardRef.current, snapshot: scan.devices, map, order: extendNearbyOrder(heardRef.current.order, [...map.values()]) };
  }
  const heardDevices = useMemo(() => [...heardRef.current.map.values()], [heardRef.current.map]);

  const rows = useMemo(() => pairedRows(bt.inventory, controllers), [bt.inventory, controllers]);
  const hints = useMemo(() => pairHints(controllers, bt.inventory), [controllers, bt.inventory]);
  const nearby = useMemo(
    () => nearbyRows(heardDevices, { showAll, inventory: bt.inventory, controllers, highlightId: view.highlightId || null, order: heardRef.current.order }),
    [heardDevices, showAll, bt.inventory, controllers, view.highlightId],
  );
  const hidden = showAll ? 0 : hiddenNearbyCount(heardDevices);
  const guide = view.name === 'guide' ? hints.find((h) => h.id === view.id) || null : null;
  const pairingNow = view.name === 'pairing' && bt.pairing?.requestId === view.requestId ? bt.pairing : null;
  const pv = pairView(pairingNow || (view.name === 'pairing' ? { phase: 'scanning', optimistic: true } : null), view.label);
  const pairBusy = !!bt.pairing && pairView(bt.pairing, '').busy;
  const sv = scanView(scan, Math.max(now, Date.now()));
  const forgetMsg = forgetAsked && bt.forgetResult?.address === forgetAsked ? forgetText(bt.forgetResult) : null;

  // The picked device: the one asked for, else the first connected, else the first.
  const row = rows.find((r) => r.address === selected)
    || (selected ? null : rows.find((r) => r.status === 'connected') || rows[0] || null);
  const address = row?.address || null;
  const kind = row ? faceKind(row, row.controller) : null;
  const pageOpen = !!row && (view.name === 'list' || view.name === 'edit');

  const faceRef = useRef(null);
  const onPress = (key) => {
    if (view.name !== 'edit') return;
    const cap = faceRef.current?.caps?.find((c) => c.key === key) || null;
    setEdit((e) => (e ? { ...e, picked: cap ? cap.id : key } : e));
  };
  const feed = usePressFeed({
    address, kind: kind === 'pad' ? 'pad' : 'remote', subscribeRemoteKeys: bt.subscribeRemoteKeys || null,
    getGamepads, active: pageOpen, onPress,
  });
  const face = useMemo(() => {
    if (!row) return null;
    return kind === 'pad' ? padFace() : remoteFace(row.controller, feed.keys);
  }, [row?.address, row?.controller, kind, feed.keys]); // eslint-disable-line react-hooks/exhaustive-deps
  faceRef.current = face;
  // A remote drawn as mounted keeps its actions by position; any other by key.
  const saved = (address && savedFor(rb?.remotes?.[address], face)) || null;
  const faceKeys = useMemo(() => new Set((face?.caps || []).map((c) => c.key)), [face]);
  const verdict = testVerdict({ keys: feed.keys, padInputs: feed.padInputs, gameKeys });
  const canEdit = !!rb && kind === 'remote' && typeof rb.requestEditUnlock === 'function' && typeof rb.save === 'function';

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

  // The device page is for trying the device: while it is open, the host
  // performs none of that remote's button actions.
  useEffect(() => {
    if (!pageOpen || !address || typeof rb?.claim !== 'function') return undefined;
    return rb.claim(address);
  }, [pageOpen, address, rb?.claim]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a visit to a device page proved, logged when it ends.
  const visit = useRef(null);
  visit.current = { address, keys: feed.keys, padInputs: feed.padInputs, verdict: verdict.id };
  useEffect(() => {
    if (!pageOpen || !address) return undefined;
    logger().info('bluetooth-screen.test-start', { address, kind });
    return () => {
      const v = visit.current;
      if (!v || v.address !== address || (!v.keys.length && !v.padInputs)) return;
      logger().info('bluetooth-screen.test-result', {
        address, kind, keys: v.keys.length, distinctKeys: new Set(v.keys).size, padInputs: v.padInputs, verdict: v.verdict,
        // Which keys, in order (capped): counts alone cannot say which buttons worked.
        keyNames: v.keys.slice(0, 40).join(','),
      });
    };
  }, [pageOpen, address]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pairing that ends: connected → that device's page; failed → logged.
  useEffect(() => {
    if (view.name !== 'pairing' || !pairingNow || pv.busy) return;
    if (pv.tone === 'ok') {
      logger().info('bluetooth-screen.pair-result', { address: view.address, outcome: 'connected' });
      setSelected(view.address);
      setView({ name: 'list' });
    } else if (pv.tone === 'error') {
      logger().info('bluetooth-screen.pair-result', {
        address: view.address, outcome: 'failed', code: pairingNow.code || null, reason: pairingNow.reason || null,
      });
    }
  }, [view, pairingNow, pv.busy, pv.tone]);

  useEffect(() => {
    logger().info('bluetooth-screen.view', { view: view.name, address: view.address || null, highlightId: view.highlightId || null });
  }, [view.name, view.address, view.highlightId]);
  // Each view opens on its default control ([data-autofocus]), and so does a
  // pairing that just ended.
  useEffect(() => {
    defaultFocus(rootRef.current)?.focus();
  }, [view.name, pv.busy]);

  // "Forgotten…" is a moment's news: it goes after FORGET_MSG_MS or with the view.
  useEffect(() => {
    if (!forgetMsg) return undefined;
    const t = setTimeout(() => setForgetAsked(null), FORGET_MSG_MS);
    return () => clearTimeout(t);
  }, [forgetMsg]);
  useEffect(() => { setForgetAsked(null); }, [view.name]);

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
  const pick = (r) => {
    // The satellite also stops a search before it pairs; stopping it here
    // first keeps the screen's own search state honest.
    stopSearch('pick');
    logger().info('bluetooth-screen.pick', { address: r.address, controllerId: r.controllerId, paired: !!r.paired, kind: r.kind || null });
    const requestId = bt.pairAddress?.({ address: r.address, controllerId: r.controllerId, label: r.name, pin: r.pin });
    setView({ name: 'pairing', requestId, address: r.address, label: r.name, kind: r.kind });
  };

  const openEditor = async (r) => {
    if (!canEdit || editPending) return;
    setEditPending(true);
    logger().info('bluetooth-screen.edit-unlock-request', { address: r.address });
    let result = null;
    try { result = await rb.requestEditUnlock({ address: r.address, label: r.name }); }
    catch (err) { logger().warn('bluetooth-screen.edit-unlock-failed', { address: r.address, error: err?.message }); }
    setEditPending(false);
    if (!result?.granted) {
      logger().info('bluetooth-screen.edit-unlock-denied', { address: r.address, reason: result?.reason || null });
      return;
    }
    const first = faceRef.current?.caps?.[0]?.id || null;
    const f = faceRef.current;
    setEdit({ address: r.address, draft: { ...(savedFor(rb.remotes?.[r.address], f) || {}) }, keyedBy: f?.by || 'key', picked: first, by: result.userId || null, saving: false, error: null });
    setView({ name: 'edit' });
    logger().info('bluetooth-screen.edit-open', { address: r.address, by: result.userId || null, buttons: faceRef.current?.caps?.length || 0 });
  };
  const cancelEdit = (reason = 'cancel') => {
    logger().info('bluetooth-screen.edit-cancel', { address: edit?.address || null, reason });
    setEdit(null);
    setView({ name: 'list' });
  };
  const saveEdit = async () => {
    if (!edit || edit.saving) return;
    setEdit((e) => ({ ...e, saving: true, error: null }));
    try {
      const field = edit.keyedBy === 'position' ? 'positions' : 'buttons';
      await rb.save(edit.address, { [field]: edit.draft }, { label: row?.name || null, updatedBy: edit.by });
      logger().info('bluetooth-screen.edit-save', { address: edit.address, keyedBy: edit.keyedBy, buttons: Object.keys(edit.draft).length, by: edit.by });
      setEdit(null);
      setView({ name: 'list' });
    } catch (err) {
      logger().warn('bluetooth-screen.edit-save-failed', { address: edit.address, error: err?.message });
      setEdit((e) => (e ? { ...e, saving: false, error: SAVE_FAILED } : e));
    }
  };

  const back = () => {
    if (view.name === 'list') { onClose?.(); return; }
    if (view.name === 'edit') { cancelEdit('back'); return; }
    if (view.name === 'search') stopSearch('back');
    setView({ name: 'list' });
  };

  // On a remote's page and in its editor, the keys that remote sends are for
  // trying it: they light its keycaps and never move the focus.
  const ignoreKey = (e) => {
    if (!pageOpen || kind !== 'remote' || NAV_KEYS.has(e.key)) return false;
    if (!faceKeys.has(normalizeKey(e.key))) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  };

  useScreenNav({
    rootRef, onBack: back, getGamepads, ignoreKey,
    onRecover: (why) => logger().debug('bluetooth-screen.focus-recovered', { why, view: view.name }),
  });

  const title = guide ? `How to pair ${guide.label}` : view.name === 'edit' && row ? `Edit buttons on ${row.name}` : TITLE[view.name];

  return (
    <div className="bluetooth-screen" ref={rootRef} data-view={view.name}>
      <header className="bts-header">
        <h3 id={headingId} className="bts-title">{title}</h3>
        <div className="bts-header-actions">
          {view.name === 'search' && scanning ? <button type="button" className="bts-button" data-autofocus onClick={() => stopSearch('user')}>Stop</button> : null}
          {view.name === 'search' && !scanning ? <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(view.highlightId || null)}>Search again</button> : null}
          {view.name === 'edit' ? (
            <>
              <button type="button" className="bts-button" disabled={edit?.saving} onClick={() => cancelEdit('cancel')}>Cancel</button>
              <button type="button" className="bts-button bts-primary" disabled={edit?.saving} onClick={saveEdit}>{edit?.saving ? 'Saving…' : 'Done'}</button>
            </>
          ) : null}
          {view.name === 'list' && onClose ? <button type="button" className="bts-button" onClick={onClose}>Close</button> : null}
          {view.name !== 'list' && view.name !== 'edit' ? <button type="button" className="bts-button" onClick={back}>Back</button> : null}
        </div>
      </header>
      {notice ? <p className="bts-notice" role="note">{notice}</p> : null}

      <div className="bts-body">
        {!bluetooth ? <p className="bts-empty">Bluetooth is not available on this screen.</p> : null}

        {bluetooth && view.name === 'list' && (
          <div className="bts-split">
            <div className="bts-split-list">
              <DeviceList
                rows={rows}
                selected={address}
                checking={!Array.isArray(bt.inventory)}
                onSelect={(r) => { setSelected(r.address); logger().info('bluetooth-screen.select', { address: r.address }); }}
                hints={hints}
                onGuide={(h) => setView({ name: 'guide', id: h.id })}
                onSearch={() => startSearch(null)}
              />
              {forgetMsg ? <p className="bts-result" role="status">{forgetMsg}</p> : null}
              {/* A pairing started elsewhere (another screen, the backend route)
                  disables Forget and Pair again: say why. */}
              {pairBusy ? (
                <p className="bts-status-line bts-tone-info">{pairView(bt.pairing, pairingName(bt.pairing.device, controllers)).text}</p>
              ) : null}
            </div>
            {row ? (
              <div className="bts-split-page">
                <DevicePage
                  row={row}
                  face={face}
                  feed={feed}
                  verdict={verdict}
                  savedButtons={saved}
                  groups={rb?.groups || null}
                  canEdit={canEdit}
                  editPending={editPending}
                  onEdit={openEditor}
                  busy={pairBusy}
                  onArm={(r) => logger().info('bluetooth-screen.forget-arm', { address: r.address })}
                  onForget={(r) => {
                    logger().info('bluetooth-screen.forget-confirm', { address: r.address, controllerId: r.controllerId });
                    setForgetAsked(r.address);
                    setSelected(null);
                    bt.forget?.(r.address);
                  }}
                  onPairAgain={(r) => pick(r)}
                />
              </div>
            ) : null}
          </div>
        )}

        {view.name === 'edit' && row && edit && (
          <ButtonEditor
            row={row}
            face={face}
            held={feed.held}
            picked={edit.picked}
            onPick={(cap) => setEdit((e) => ({ ...e, picked: cap.id }))}
            draft={edit.draft}
            groups={rb?.groups || EMPTY}
            onSet={(slot, action) => {
              logger().debug('bluetooth-screen.edit-set', { address: edit.address, slot, action });
              setEdit((e) => ({ ...e, draft: { ...e.draft, [slot]: action } }));
            }}
            saving={edit.saving}
            error={edit.error}
          />
        )}

        {view.name === 'guide' && guide && (
          <section className="bts-guide">
            {guide.mode ? <p className="bts-hint">{guide.mode}</p> : null}
            <ol className="bts-steps">{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(guide.id)}>Search for it</button>
          </section>
        )}

        {view.name === 'search' && (
          <section className="bts-search">
            <p className={`bts-status-line bts-tone-${sv.tone}`} role="status">{sv.text}</p>
            {!scanning && view.highlightId ? (
              <p className="bts-hint">{hints.find((h) => h.id === view.highlightId)?.troubleshoot}</p>
            ) : null}
            {sv.tone === 'error' && nearby.length === 0 && !showAll ? null : (
              <NearbyList rows={nearby} hidden={hidden} showAll={showAll} onToggleShowAll={() => setShowAll((v) => !v)} onPick={pick} busy={pairBusy} ended={!scanning} />
            )}
          </section>
        )}

        {view.name === 'pairing' && (
          <section className="bts-pairing">
            <p className={`bts-status-line bts-tone-${pv.tone}`} role="status">{pv.text}</p>
            {pv.passkey ? <p className="bts-passkey" aria-label={`Code ${pv.passkey}`}>{pv.passkey}</p> : null}
            {pv.next ? <p className="bts-hint">{pv.next}</p> : null}
            {!pv.busy && pv.tone === 'error' ? (
              <div className="bts-page-actions">
                <button type="button" className="bts-button bts-primary" data-autofocus onClick={() => startSearch(null)}>Search again</button>
                <button type="button" className="bts-button" onClick={() => setView({ name: 'list' })}>Done</button>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}

export default BluetoothScreen;
