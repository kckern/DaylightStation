// frontend/src/modules/Media/cast/CastTargetChip.jsx
// The header's destination control: "Playing on <name> ⌄". It says where the
// next film's Play goes in the search chip's own words (useDestinationLabel:
// the aimed screen(s), "This device", the learned screen, or "Choose a screen"
// when ▶ would ask) — and opens the cast
// preferences: the preferred target device(s) and the default Transfer/Fork
// mode, persisted per browser. Inline cast pickers seed from these so a
// configured household is one tap per cast. It absorbs the old cast icon; the
// first-use naming popover anchors to it (identity/FirstUseCard.jsx).
import React, { useState, useCallback, useContext, useEffect, useId, useRef } from 'react';
import { Checkbox, Popover, Text, UnstyledButton } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import { IconChevronDown } from '@tabler/icons-react';
import { useDismissLayer } from "@/lib/ui/dismiss/useDismissLayer.js";
import { useCastTarget } from "./useCastTarget.js";
import { useFleetContext } from "../fleet/useFleetContext.js";
import { deviceName } from "../fleet/deviceDisplay.js";
import { ClientIdentityContext } from "../identity/ClientIdentityProvider.jsx";
import { useDestinationLabel } from "../search/DestinationChip.jsx";
import { useDestinationInteraction } from "./destinationInteraction.js";
import { TopMoreList } from '@/lib/ui/TopMore.jsx';
import { rankScreens, screenCanTop } from "../fleet/screenRanking.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import mediaLog from "../logging/mediaLog.js";
import "./Cast.scss";

// The aim list shows a few more than Play on… (it is where several are chosen).
const AIM_TOP_N = 4;

export function CastTargetChip({ controlRef }) {
  const modeLabelId = `cast-mode-label-${useId()}`;
  const targetLabelId = `cast-target-label-${useId()}`;
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const setTriggerRef = useMergedRef(trigger, controlRef);
  const dismissFromKeyboard = useCallback(() => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  useDismissLayer(open, dismissFromKeyboard);
  const { mode, targetIds, here, setMode, setTargets, toggleTarget } = useCastTarget();
  const { devices } = useFleetContext();
  const identity = useContext(ClientIdentityContext);
  const { setActive } = useDestinationInteraction();
  // An open search stays open while this control is in use: raised at the press
  // (before the field blurs) and held while the popover is open.
  useEffect(() => { setActive(open); }, [open, setActive]);
  useEffect(() => () => setActive(false), [setActive]);
  // The same words as the search box's destination chip (one resolution:
  // aim, This device chosen, the learned film screen, or ask), so the phone
  // header and the search never name two different places.
  const { label: name, asks } = useDestinationLabel();
  // The screens this browser uses most first; what is aimed is always shown.
  const { screenWeightsFor } = usePlayDestination();
  const weights = screenWeightsFor(null);
  // Not ranked by the aim itself: a row must not jump when it is ticked.
  const ranked = rankScreens(devices, { weights });

  const control = (
    <UnstyledButton
      ref={setTriggerRef}
      data-testid="cast-target-chip"
      className="media-destination"
      aria-label={asks ? 'No screen chosen yet. Change where things play' : `Playing on ${name}. Change where things play`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerDown={() => setActive(true)}
      onPointerCancel={() => { if (!open) setActive(false); }}
      onPointerLeave={() => { if (!open) setActive(false); }}
      onClick={() => {
        // Reaching for the destination answers the naming prompt anchored here
        // ("Not now"): two popovers on one control would hide the one asked for.
        if (identity?.firstUse) identity.completeFirstUse?.('skipped');
        setOpen((v) => !v);
      }}
    >
      <span className="media-destination-text">
        {!asks && <span className="media-destination-prefix">Playing on</span>}
        <span className="media-destination-name" data-testid="destination-control-name">{name}</span>
      </span>
      <IconChevronDown size={16} aria-hidden />
    </UnstyledButton>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withinPortal closeOnEscape={false}>
      <Popover.Target>{control}</Popover.Target>
      <Popover.Dropdown data-testid="cast-popover" className="cast-popover">
        <div className="cast-popover-section">
          <Text size="sm" c="dimmed" fw={600} mb={4} id={modeLabelId}>When playing elsewhere</Text>
          <div role="radiogroup" aria-labelledby={modeLabelId}>
            <label className="cast-popover-row">
              <input
                type="radio"
                name="cast-mode"
                checked={mode === 'transfer'}
                onChange={() => setMode('transfer')}
                data-testid="cast-mode-transfer"
              />
              <span>Move playback to the device</span>
            </label>
            <label className="cast-popover-row">
              <input
                type="radio"
                name="cast-mode"
                checked={mode === 'fork'}
                onChange={() => setMode('fork')}
                data-testid="cast-mode-fork"
              />
              <span>Keep playing here too</span>
            </label>
          </div>
        </div>
        <div className="cast-popover-section">
          <Text size="sm" c="dimmed" fw={600} mb={4} id={targetLabelId}>Play on</Text>
          <div role="group" aria-labelledby={targetLabelId}>
            <Checkbox
              className="cast-popover-row"
              size="sm"
              label="This device"
              checked={here === true && targetIds.length === 0}
              onChange={(e) => (e.currentTarget.checked ? setTargets([], { here: true }) : setTargets([]))}
              data-testid="cast-target-here"
            />
            {devices.length === 0 && <Text size="sm" c="dimmed">No devices</Text>}
            <TopMoreList
              items={ranked}
              n={AIM_TOP_N}
              keepIds={targetIds}
              canTop={screenCanTop({ weights })}
              testId="cast-target"
              onExpand={(counts) => mediaLog.listMoreExpanded({ surface: 'aim', ...counts })}
              renderItem={(d) => (
                <label key={d.id} className="cast-popover-row">
                  <input
                    type="checkbox"
                    checked={targetIds.includes(d.id)}
                    onChange={() => toggleTarget(d.id)}
                    data-testid={`cast-target-checkbox-${d.id}`}
                  />
                  <span>{deviceName(d)}</span>
                </label>
              )}
            />
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

export default CastTargetChip;
