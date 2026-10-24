import React from 'react';
import { Button } from '@mantine/core';
import { IconAdjustments } from '@tabler/icons-react';
import { usePlaybackQuality } from './PlaybackQualityProvider.jsx';
import { useSessionController } from '../controller/useSessionController.js';

export { supportsPlaybackQuality as supportsQualityOverrides } from '@shared-contracts/media/playbackQuality.mjs';
import { supportsPlaybackQuality as supportsQualityOverrides } from '@shared-contracts/media/playbackQuality.mjs';

export function ItemQualityButton({ item }) {
  const quality = usePlaybackQuality();
  if (!quality || !supportsQualityOverrides(item)) return null;
  const overrides = quality.getOverrides(item.contentId ?? item.id);
  return <Button variant="default" leftSection={<IconAdjustments size={16} />}
    onClick={() => quality.openForItem(item)}>
    Quality{overrides.maxResolution ? ` · ${overrides.maxResolution}p` : '…'}
  </Button>;
}

export function ActiveQualityButton({ target, targetLabel }) {
  const quality = usePlaybackQuality();
  const { controller, snapshot } = useSessionController(target);
  if (!quality || !controller?.quality?.setOverrides || !supportsQualityOverrides(snapshot?.currentItem)) return null;
  return <Button variant="default" size="sm" leftSection={<IconAdjustments size={16} />}
    onClick={() => quality.openForPlayback({ controller, snapshot, targetLabel })}>Quality…</Button>;
}
