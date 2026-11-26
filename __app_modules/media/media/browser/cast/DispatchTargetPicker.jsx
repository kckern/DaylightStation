// DispatchTargetPicker.jsx — the one "where does it play" list: Play on…,
// Add on…, Show briefly on…, the Cast popover, Now Playing's hand-off and the
// destination sheet.
//
// A plain list, calm by design (media-app.md "Visual system"):
//   - one row per screen: a monochrome icon for its kind, its name, and one
//     muted line "Room · status" in the same shape on every row; the screen
//     this browser usually uses for this kind of thing first, tagged "Usual";
//   - a tap IS the send. A screen that is playing something asks in its own
//     row ("Replace Arrival?" with one small confirm) instead of a CTA;
//   - this device is never one of the screens: it sits last, under a hairline,
//     as "Here (this Mac)", with the one "Stop it here" switch when something
//     plays here (on = Move, off = keep playing here too);
//   - "Choose several screens" is a quiet text button; only then does a
//     confirm button appear, naming the screens.
//
// `intent` controls what the chrome CLAIMS will happen, matching what
// useDispatchTargetPicker's submit() actually does:
//   - "dispatch" (default) — a pick really does dispatch.
//   - "destination" — DestinationLine's device sheet. It mounts with NO
//     source, so a pick only changes the preferred destination; the chrome
//     never says Cast or Play there (2026-08-21 review finding).
import React from 'react';
import { Button, Switch, UnstyledButton } from '@mantine/core';
import {
  IconBrowser, IconCheck, IconDeviceDesktop, IconDeviceLaptop, IconDeviceMobile,
  IconDeviceTablet, IconDeviceTv, IconSpeakerphone, IconAlertCircle,
} from '@tabler/icons-react';
import { useDispatchTargetPicker, HERE_ID } from "./useDispatchTargetPicker.js";
import { useDevice } from "../fleet/useDevice.js";
import { useFleetContext } from "../fleet/useFleetContext.js";
import { deviceName, deviceGlyph, deviceLocation, isMachineDeviceLabel } from "../fleet/deviceDisplay.js";
import { pickerStatus, describeBusy } from "./castCopy.js";
import { aimName } from "./AimLabel.jsx";
import { screenRoomsFromRegistry, sharedRoomGroups, neighbouringRoomGroups, driftWarningText } from "./screenRooms.js";
import mediaLog from "../logging/mediaLog.js";
import "./Cast.scss";

const GLYPHS = {
  tv: IconDeviceTv,
  desktop: IconDeviceDesktop,
  tablet: IconDeviceTablet,
  speaker: IconSpeakerphone,
  browser: IconBrowser,
  phone: IconDeviceMobile,
};

/** This browser's own icon: a phone on a touch-only screen, else a laptop. */
function hereGlyph() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches) return IconDeviceMobile;
  } catch { /* no matchMedia: assume a computer */ }
  return IconDeviceLaptop;
}

/** "Room · status", either half alone when the other is missing. */
function metaLine(room, status) {
  return [room, status].filter(Boolean).join(' · ');
}

/** "Play on" / "Cast to" — the words in front of a screen's name. */
function verbOn(verb) {
  return verb === 'Cast' || verb === 'Hand off' ? `${verb} to` : `${verb} on`;
}

function ReplacePrompt({ id, what, confirmLabel, onConfirm }) {
  return (
    <div className="cast-row-confirm" role="status" data-testid={`cast-busy-warning-${id}`}>
      <span className="cast-row-confirm__text">Replace {what}?</span>
      <Button
        size="compact-sm"
        color="amber"
        className="cast-row-confirm__go"
        data-testid={`picker-replace-${id}`}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

function PickerRow({
  testId, Icon, name, meta, metaTone, usual = false, pressed, showCheck, pending, replaceWhat, confirmLabel,
  onPress, onConfirm, autoFocus, statusTestId,
}) {
  return (
    <div className={`cast-row${pending ? ' cast-row--asking' : ''}${pressed && showCheck ? ' cast-row--selected' : ''}`}>
      <UnstyledButton
        data-testid={testId}
        className="cast-row__button"
        aria-pressed={showCheck ? pressed : undefined}
        aria-expanded={replaceWhat ? pending : undefined}
        data-autofocus={autoFocus || undefined}
        onClick={onPress}
      >
        <Icon className="cast-row__icon" size={20} stroke={1.6} aria-hidden />
        <span className="cast-row__text">
          <span className="cast-row__name-line">
            <span className="cast-row__name">{name}</span>
            {usual && <span className="cast-row__usual" data-testid={`${testId}-usual`}>Usual</span>}
          </span>
          {meta && (
            <span className={`cast-row__meta cast-row__meta--${metaTone}`} data-testid={statusTestId}>{meta}</span>
          )}
        </span>
        {showCheck && (
          <span className="cast-row__check" aria-hidden>{pressed ? <IconCheck size={18} stroke={2.2} /> : null}</span>
        )}
      </UnstyledButton>
      {pending && replaceWhat && (
        <ReplacePrompt id={testId.replace(/^picker-(device-)?/, '')} what={replaceWhat} confirmLabel={confirmLabel} onConfirm={onConfirm} />
      )}
    </div>
  );
}

function DeviceRow({ device, pressed, showCheck, usual, pending, verb, onSelect, onConfirm, autoFocus }) {
  const { entry } = useDevice(device.id);
  const status = pickerStatus(entry, device);
  const busy = describeBusy(entry);
  const Icon = GLYPHS[deviceGlyph(device)] ?? IconDeviceDesktop;
  return (
    <PickerRow
      testId={`picker-device-${device.id}`}
      statusTestId={`picker-device-status-${device.id}`}
      Icon={Icon}
      name={deviceName(device)}
      meta={metaLine(deviceLocation(device), status.text)}
      metaTone={status.tone}
      usual={usual}
      pressed={pressed}
      showCheck={showCheck}
      pending={pending}
      replaceWhat={busy ? entry?.snapshot?.currentItem?.title : null}
      confirmLabel={`${verb} here instead`}
      onPress={() => onSelect(device.id)}
      onConfirm={() => onConfirm(device.id)}
      autoFocus={autoFocus}
    />
  );
}

function HereRow({ device, intent, selected, pending, verb, localNow, onPress, onConfirm }) {
  const rawName = device?.name ?? null;
  const ownName = rawName && !isMachineDeviceLabel(rawName) ? deviceName(device) : null;
  // Only something actually on here is worth a line; an idle "Here" is plain.
  const status = localNow?.title
    ? { text: `${localNow.state === 'paused' ? 'Paused' : 'Playing'}: ${localNow.title}`, tone: 'active' }
    : null;
  const busyTitle = localNow?.title ?? null;
  return (
    <PickerRow
      testId="picker-this-device"
      statusTestId="picker-this-device-status"
      Icon={hereGlyph()}
      name={ownName ? `Here (this ${ownName})` : 'Here'}
      meta={status?.text ?? null}
      metaTone={status?.tone ?? 'idle'}
      pressed={selected}
      showCheck={intent === 'destination'}
      pending={pending}
      replaceWhat={busyTitle}
      confirmLabel={`${verb} here instead`}
      onPress={onPress}
      onConfirm={onConfirm}
    />
  );
}

// PLACE.4a/AC6 (RQ-PLACE-10): several screens in the same or a neighbouring
// room drift apart audibly; say so while they are being chosen.
function DriftWarning({ targetIds, devices }) {
  const { registry } = useFleetContext();
  const rooms = React.useMemo(() => screenRoomsFromRegistry(registry), [registry]);
  const groups = sharedRoomGroups(targetIds, devices, rooms);
  const neighbours = neighbouringRoomGroups(targetIds, devices, rooms);
  const text = driftWarningText(groups, neighbours);
  const key = [...groups.map((group) => `${group.room}:${group.names.join('|')}`), ...neighbours.map((n) => `${n.rooms.join('+')}:${n.names.join('|')}`)].join(';');
  React.useEffect(() => {
    if (key) {
      mediaLog.aimDriftWarned({
        state: 'shown', targetIds, rooms: groups.map((group) => group.room), neighbouringRooms: neighbours.map((n) => n.rooms),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per distinct warning
  }, [key]);
  if (!text) return null;
  return <div role="status" data-testid="picker-drift-warning" className="cast-picker-note">{text}</div>;
}

function Note({ testId, children, tone = 'plain' }) {
  return (
    <div role="status" data-testid={testId} className={`cast-picker-note cast-picker-note--${tone}`}>
      {tone === 'error' && <IconAlertCircle size={16} stroke={1.8} aria-hidden className="cast-picker-note__icon" />}
      <span>{children}</span>
    </div>
  );
}

export function DispatchTargetPicker({ source, onComplete, autoFocus = true, verb = 'Cast', intent = 'dispatch', heading = null }) {
  const {
    devices, selected, multi, mode, asksKeepOrStop, canSubmit, localPlaying, moveUnavailable, dispatchError,
    usualIds, here, pendingId, localNow,
    select, toggleMulti, setMode, submit, playHere, confirmReplace,
  } = useDispatchTargetPicker({ source, onComplete, intent });

  const isDestination = intent === 'destination';
  const hasMoveSnapshot = !!(source?.getSnapshot || source?.snapshot);
  const selectedDevices = devices.filter((d) => selected.has(d.id));
  const targetLabel = selectedDevices.length === 1
    ? deviceName(selectedDevices[0])
    : selectedDevices.length > 1
      ? aimName(selectedDevices.map((d) => d.id), devices)
      : null;
  const usual = new Set(usualIds);
  const showsChecks = multi || isDestination;
  const showsStopSwitch = (hasMoveSnapshot || asksKeepOrStop) && devices.length > 0 && !isDestination && !source?.brief;
  const moveNeedsOne = hasMoveSnapshot && multi && mode === 'transfer' && selectedDevices.length > 1;
  const ctaLabel = isDestination ? `Set destination: ${targetLabel}` : `${verbOn(verb)} ${targetLabel}`;
  const hasFooter = devices.length > 1 || multi;

  return (
    <div data-testid="dispatch-target-picker" className="cast-picker" data-intent={intent}>
      {heading && <div className="cast-picker__heading">{heading}</div>}
      {devices.length === 0 && (
        <div data-testid="picker-no-devices" className="cast-picker__empty">
          {isDestination ? 'No other screens are available.' : 'No screens are available.'}
        </div>
      )}
      <div className="cast-picker__list" role="group" aria-label="Screens">
        {devices.map((d, index) => (
          <DeviceRow
            key={d.id}
            device={d}
            pressed={selected.has(d.id)}
            showCheck={showsChecks}
            usual={usual.has(d.id)}
            pending={pendingId === d.id}
            verb={verb}
            onSelect={select}
            onConfirm={confirmReplace}
            autoFocus={autoFocus && index === 0}
          />
        ))}
      </div>
      {(here || showsStopSwitch) && (
        <div className="cast-picker__here">
          {here && !multi && (
            <HereRow
              device={here.device}
              intent={intent}
              selected={isDestination && selected.size === 0}
              pending={pendingId === HERE_ID}
              verb={verb}
              localNow={localNow}
              onPress={() => playHere()}
              onConfirm={() => confirmReplace(HERE_ID)}
            />
          )}
          {showsStopSwitch && (
            <Switch
              className="cast-picker__stop"
              data-testid="picker-stop-here"
              size="sm"
              color="amber"
              labelPosition="left"
              label="Stop it here"
              checked={mode === 'transfer'}
              onChange={(event) => setMode(event.currentTarget.checked ? 'transfer' : 'fork')}
            />
          )}
        </div>
      )}
      {multi && selectedDevices.length > 1 && <DriftWarning targetIds={selectedDevices.map((d) => d.id)} devices={devices} />}
      {moveNeedsOne && (
        <Note testId="picker-move-unavailable">Moving goes to one screen. Turn off Stop it here to play on several.</Note>
      )}
      {dispatchError && <Note testId="picker-dispatch-failed" tone="error">{dispatchError}</Note>}
      {hasFooter && (
        <div className="cast-picker__footer">
          {devices.length > 1 && (
            <UnstyledButton
              data-testid="picker-multi-toggle"
              className="cast-picker__multi"
              aria-pressed={multi}
              onClick={toggleMulti}
            >
              {multi ? 'Choose one screen' : 'Choose several screens'}
            </UnstyledButton>
          )}
          {multi && (
            <Button
              data-testid="picker-submit"
              className="cast-picker__cta"
              color="amber"
              disabled={!canSubmit || moveUnavailable}
              onClick={() => submit()}
            >
              {canSubmit ? ctaLabel : 'Choose screens'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default DispatchTargetPicker;
