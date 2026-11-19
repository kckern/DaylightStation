import { useState } from 'react';
import { IconDeviceTv, IconSearch, IconX } from '@tabler/icons-react';
import { DaylightImagePath } from '../api.mjs';

const icons = { close: IconX, search: IconSearch, television: IconDeviceTv };

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
export function UiIcon({ name, size = 16, assetName, src, ...props }) {
  const Icon = icons[name];
  let imageSrc = src;
  if (imageSrc == null && assetName) {
    const filename = /\.svg$/i.test(assetName) ? assetName : `${assetName}.svg`;
    imageSrc = DaylightImagePath(`icons/${filename}`);
  }
  if (imageSrc) return <ImageIcon key={imageSrc} src={imageSrc} size={size} fallback={Icon} {...props} />;
  return <Icon {...props} size={size} aria-hidden="true" focusable="false" />;
}
