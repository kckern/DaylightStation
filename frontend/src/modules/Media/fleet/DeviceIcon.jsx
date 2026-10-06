// frontend/src/modules/Media/fleet/DeviceIcon.jsx
// A device's icon from the app's own SVG set (Tabler) — never an emoji, which
// renders differently on every platform. A configured emoji (`device.icon`) or
// the device `type` only picks WHICH icon.
import React from 'react';
import {
  IconDeviceTv, IconHeadphones, IconBarbell, IconPiano, IconVolume,
  IconDeviceDesktop, IconDeviceMobile, IconDeviceTablet, IconBrowser,
} from '@tabler/icons-react';

const BY_EMOJI = [
  [/📺/, IconDeviceTv], [/🎧/, IconHeadphones], [/🏋|💪/, IconBarbell], [/🎹/, IconPiano],
  [/🔊|🔈|🔉/, IconVolume], [/🖥|💻/, IconDeviceDesktop], [/📱/, IconDeviceMobile],
];
const BY_TYPE = {
  'shield-tv': IconDeviceTv, 'linux-pc': IconDeviceDesktop, 'android-tablet': IconDeviceTablet,
  'midi-keyboard': IconPiano, speaker: IconVolume, 'speaker-lane': IconVolume, browser: IconBrowser,
};

/** The Tabler icon component for a device. */
export function deviceIconComponent(device) {
  const configured = typeof device?.icon === 'string' ? device.icon : '';
  for (const [pattern, Icon] of BY_EMOJI) if (pattern.test(configured)) return Icon;
  return BY_TYPE[device?.type] ?? IconDeviceTv;
}

export function DeviceIcon({ device, size = 20, ...rest }) {
  const Icon = deviceIconComponent(device);
  return <Icon size={size} aria-hidden="true" {...rest} />;
}

export default DeviceIcon;
