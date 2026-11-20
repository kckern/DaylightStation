import { useState } from 'react';
import {
  IconAdjustmentsHorizontal, IconBrain, IconCalendarEvent, IconCar, IconChartLine, IconChevronLeft, IconDiamond,
  IconDeviceTv, IconDoor, IconFolder, IconGasStation, IconHeart, IconLayoutGrid,
  IconMapPin, IconMessageCircle, IconPlus, IconSearch, IconShield, IconTarget,
  IconTimeline, IconTool, IconVideo, IconX, IconDashboard,
} from '@tabler/icons-react';
import { DaylightImagePath } from '../api.mjs';

const icons = {
  back: IconChevronLeft,
  brain: IconBrain,
  calendar: IconCalendarEvent,
  car: IconCar,
  chart: IconChartLine,
  close: IconX,
  dashboard: IconDashboard,
  diamond: IconDiamond,
  folder: IconFolder,
  fuel: IconGasStation,
  heart: IconHeart,
  home: IconDoor,
  mosaic: IconLayoutGrid,
  pin: IconMapPin,
  plus: IconPlus,
  search: IconSearch,
  settings: IconAdjustmentsHorizontal,
  service: IconTool,
  shield: IconShield,
  target: IconTarget,
  timeline: IconTimeline,
  coach: IconMessageCircle,
  video: IconVideo,
  television: IconDeviceTv,
};

function ImageIcon({ src, size, className, fallback: FallbackIcon, ...props }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <FallbackIcon {...props} className={className} size={size} aria-hidden="true" focusable="false" />;
  }
  return (
    <img
      {...props}
      className={className}
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}

/** Decorative symbol. Give its surrounding control the accessible action name. */
export function UiIcon({ name, size = 16, assetName, ...props }) {
  const Icon = icons[name];
  if (assetName) {
    const filename = /\.svg$/i.test(assetName) ? assetName : `${assetName}.svg`;
    const imageSrc = DaylightImagePath(`icons/${filename}`);
    return <ImageIcon key={imageSrc} src={imageSrc} size={size} fallback={Icon} {...props} />;
  }
  return <Icon {...props} size={size} aria-hidden="true" focusable="false" />;
}
