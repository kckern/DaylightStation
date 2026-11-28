// The careful choice of destination (owner ruling 2026-11-27, "Destination
// chip: cycle or pick from a list"). Click / Tab on the chip still cycles;
// the ▾ joined to the chip's right edge opens every destination as a list:
// the screens that can take a film (the same set the cycle walks), ranked by
// fleet/screenRanking.js — the usual film screen, then habit weight, then
// what is on now, then by name — top three then More, and This device.
//
// Each row reads its live state (castCopy.pickerRowState: Asleep, Ready,
// Playing: <title>) and the current destination carries a ✓. Opening the
// list only reads the fleet store: nothing is woken, powered or contacted.
// A pick writes the same sticky aim a cycle step writes (useDestinationCycle
// `pick`). Keyboard: Alt+↓ in the box (or ↓ on the chip / ▾) opens it, ↑ ↓
// move, Enter picks, Esc or Tab closes and keeps the choice; either way focus
// goes back to the search box.
import React, { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Menu, UnstyledButton } from '@mantine/core';
import {
  IconCheck, IconChevronDown, IconDeviceDesktop, IconDeviceLaptop, IconDeviceMobile,
  IconDeviceTablet, IconDeviceTv, IconSpeakerphone, IconBrowser,
} from '@tabler/icons-react';
import { TopMoreMenu } from '@/lib/ui/TopMore.jsx';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { deviceName, deviceGlyph } from "../fleet/deviceDisplay.js";
import { rankScreens, SCREEN_TOP_N } from "../fleet/screenRanking.js";
import { pickerRowState } from "../cast/castCopy.js";
import { aimKey } from "../habits/destinationCycle.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import mediaLog from "../logging/mediaLog.js";

const NO_IDS = Object.freeze([]);
const FILM = Object.freeze({ type: 'movie' });
export const HERE_ROW_ID = 'local';
// Above the search results (Mantine popover layer, 300).
const LIST_Z_INDEX = 600;

const GLYPHS = {
  tv: IconDeviceTv,
  desktop: IconDeviceDesktop,
  tablet: IconDeviceTablet,
  speaker: IconSpeakerphone,
  browser: IconBrowser,
  phone: IconDeviceMobile,
};

/**
 * The list's screens: the cycle's own screens (kind-filtered the same way),
 * as devices, in the shared ranking. Pure.
 * @returns {Object[]} devices
 */
export function destinationListScreens({ order = [], devices = [], usualIds = [], weights = null } = {}) {
  const ids = new Set(order.filter((step) => step.targetIds.length === 1).map((step) => step.targetIds[0]));
  const screens = devices.filter((device) => ids.has(device?.id));
  return rankScreens(screens, { preferredIds: usualIds, weights });
}

/** The row the chip currently names (✓), or null when ▶ would ask. */
export function currentRowId(current) {
  if (!current) return null;
  const ids = current.unaimed ? current.shownIds : current.targetIds;
  if (ids == null) return null;
  return aimKey(ids);
}

const noSubscribe = () => () => {};
const noEntry = () => null;

/** This screen's live fleet entry, without ever asking the screen anything. */
function useLiveEntry(deviceId) {
  const store = useContext(FleetContext)?.store ?? null;
  const subscribe = useCallback(
    (cb) => (store?.subscribeDevice ? store.subscribeDevice(deviceId, cb) : noSubscribe()),
    [store, deviceId],
  );
  const get = useCallback(() => (store?.getEntry ? store.getEntry(deviceId) : noEntry()), [store, deviceId]);
  return useSyncExternalStore(subscribe, get, get);
}

function RowBody({ name, status, tone, testId }) {
  return (
    <span className="media-dest-list-row-text">
      <span className="media-dest-list-row-name">{name}</span>
      {status && <span className="media-dest-list-row-status" data-tone={tone} data-testid={testId}>{status}</span>}
    </span>
  );
}

function ScreenRow({ device, checked, rank, onPick }) {
  const entry = useLiveEntry(device.id);
  // Choosing a destination never sends, so no row is disabled here.
  const state = pickerRowState({ entry, device });
  const Icon = GLYPHS[deviceGlyph(device)] ?? IconDeviceDesktop;
  return (
    <Menu.Item
      data-testid={`dest-list-row-${device.id}`}
      className="media-dest-list-row"
      data-current={checked || undefined}
      aria-current={checked ? 'true' : undefined}
      leftSection={<Icon size={18} stroke={1.6} aria-hidden />}
      rightSection={checked ? <IconCheck size={16} stroke={2.2} aria-label="Current" /> : null}
      onClick={() => onPick([device.id], rank)}
    >
      <RowBody name={deviceName(device)} status={state.text} tone={state.tone} testId={`dest-list-status-${device.id}`} />
    </Menu.Item>
  );
}

function HereRow({ checked, rank, onPick }) {
  return (
    <Menu.Item
      data-testid={`dest-list-row-${HERE_ROW_ID}`}
      className="media-dest-list-row"
      data-current={checked || undefined}
      aria-current={checked ? 'true' : undefined}
      leftSection={<IconDeviceLaptop size={18} stroke={1.6} aria-hidden />}
      rightSection={checked ? <IconCheck size={16} stroke={2.2} aria-label="Current" /> : null}
      onClick={() => onPick(NO_IDS, rank)}
    >
      <RowBody name="This device" status="Plays here" tone="idle" />
    </Menu.Item>
  );
}

/** On open: the current row, else the first. Module-level so it runs once per mount. */
function focusCurrentRow(dropdown) {
  if (!dropdown) return;
  const row = dropdown.querySelector('[role="menuitem"][aria-current="true"]')
    ?? dropdown.querySelector('[role="menuitem"]');
  (row ?? dropdown).focus({ preventScroll: true });
}

/**
 * The ▾ and its list.
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, compact?: boolean,
 *   returnFocusRef?: React.RefObject, cycle: ReturnType<typeof import('./DestinationChip.jsx').useDestinationCycle> }} props
 */
export function DestinationList({ open, onOpenChange, compact = false, returnFocusRef = null, cycle }) {
  const fleet = useContext(FleetContext);
  const { screenWeightsFor } = usePlayDestination({ aimIds: NO_IDS, here: false });
  const weights = screenWeightsFor(FILM);
  const { current, pick, order, usualIds } = cycle;
  const devices = fleet?.devices ?? NO_IDS;
  const screens = useMemo(
    () => destinationListScreens({ order, devices, usualIds, weights }),
    [order, devices, usualIds, weights],
  );
  const checkedId = currentRowId(current);

  const returnFocus = useCallback(() => {
    returnFocusRef?.current?.focus?.({ preventScroll: true });
  }, [returnFocusRef]);
  const close = useCallback((refocus = true) => {
    onOpenChange(false);
    if (refocus) returnFocus();
  }, [onOpenChange, returnFocus]);
  useDismissLayer(open, close);

  useEffect(() => {
    if (!open) return;
    mediaLog.destListOpened({ current: checkedId, screens: screens.length });
    // Logged once per opening; the list's contents moving while open is not a new open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPick = useCallback((ids, rank) => {
    pick(ids, { rank });
    close(true);
  }, [pick, close]);

  const onDropdownKeys = (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      // Esc keeps the choice; Tab in the search grammar belongs to the cycle,
      // never to traversal out of the list.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const onToggleKeys = (event) => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(true);
    }
  };

  return (
    <Menu
      opened={open}
      onChange={(next) => (next ? onOpenChange(true) : close(false))}
      position="bottom-end"
      offset={4}
      withinPortal
      zIndex={LIST_Z_INDEX}
      closeOnEscape={false}
      trapFocus={false}
      returnFocus={false}
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target>
        <UnstyledButton
          data-testid="search-destination-list-toggle"
          className="media-destination-list-toggle"
          aria-label="Choose where things play from a list"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Choose from a list (Alt+↓)"
          // The search box keeps its focus, words and open list.
          onMouseDown={(e) => e.preventDefault()}
          onKeyDown={onToggleKeys}
        >
          <IconChevronDown size={16} stroke={2} aria-hidden />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown
        data-testid="dest-list"
        className={`media-dest-list${compact ? ' media-dest-list--compact' : ''}`}
        ref={focusCurrentRow}
        onKeyDownCapture={onDropdownKeys}
        // A press in the list is inside the search (see the input accessory).
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <Menu.Label>Plays on</Menu.Label>
        <TopMoreMenu
          items={screens}
          n={SCREEN_TOP_N}
          keepIds={checkedId && checkedId !== HERE_ROW_ID ? [checkedId] : []}
          testId="dest-list"
          onExpand={(counts) => mediaLog.listMoreExpanded({ surface: 'dest-list', ...counts })}
          renderItem={(device) => (
            <ScreenRow
              key={device.id}
              device={device}
              checked={checkedId === device.id}
              rank={screens.indexOf(device) + 1}
              onPick={onPick}
            />
          )}
        />
        <Menu.Divider />
        <HereRow checked={checkedId === HERE_ROW_ID} rank={screens.length + 1} onPick={onPick} />
      </Menu.Dropdown>
    </Menu>
  );
}

export default DestinationList;
