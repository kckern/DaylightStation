// "Add to home screen" on Now Playing, inside the household's phone app only.
// The phone app's page bridge offers canPinMedia()/pinMedia(); anywhere else
// (kiosks, ordinary browsers, a frame) canPinMedia() is false and nothing is
// drawn. A tap asks the phone to show Android's own pin dialog; the answer is
// reported through the one outcome tray. The phone never says whether the
// owner confirmed, so the words never claim it was added.
// Contract: __docs/reference/android/phone.md, "Page bridge on the phone:
// pinning media". Nothing here logs the content id or the label.
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { IconHomePlus } from '@tabler/icons-react';
import { canPinMedia, pinMedia } from "../../../../../frontend/src/lib/fkb.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { mediaLog } from "../logging/mediaLog.js";
import { pinLabel, pinOutcomeMessage } from "./homeScreenPin.js";

/** The phone refuses a second request within five seconds; the button waits that long. */
export const PIN_COOLDOWN_MS = 5000;

/**
 * @param {{target: {contentId: string, label: string, kind: string}|null}} props
 */
export function AddToHomeScreenButton({ target }) {
  const outcomes = useContext(DispatchContext);
  const contentId = target?.contentId ?? null;
  const kind = target?.kind ?? null;
  const [available, setAvailable] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const can = contentId ? canPinMedia() : false;
    setAvailable(can);
    if (can) mediaLog.homeScreenPinShown({ kind });
  }, [contentId, kind]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!available || !target) return null;

  const onPin = () => {
    if (coolingDown) return;
    setCoolingDown(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCoolingDown(false), PIN_COOLDOWN_MS);
    const label = pinLabel(target.label);
    const result = label
      ? pinMedia({ contentId: target.contentId, label })
      : { accepted: false, reason: 'invalid_label' };
    mediaLog.homeScreenPinRequested({ kind, accepted: result.accepted, reason: result.reason ?? null });
    outcomes?.recordLocal?.({
      kind: 'homeScreen',
      phase: result.accepted ? 'confirmed' : 'failed',
      item: { contentId: null, title: null },
      command: { copy: { primary: pinOutcomeMessage(result), secondary: null } },
    });
  };

  return (
    <Button
      variant="default"
      size="sm"
      data-testid="np-add-to-home-screen"
      leftSection={<IconHomePlus size={16} aria-hidden />}
      disabled={coolingDown}
      onClick={onPin}
    >
      Add to home screen
    </Button>
  );
}

export default AddToHomeScreenButton;
