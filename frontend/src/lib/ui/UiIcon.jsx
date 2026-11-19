import { useState } from 'react';
import { IconDeviceTv, IconSearch, IconX } from '@tabler/icons-react';

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
export function UiIcon({ name, size = 16, src, ...props }) {
  const Icon = icons[name];
  if (src) return <ImageIcon key={src} src={src} size={size} fallback={Icon} {...props} />;
  return <Icon {...props} size={size} aria-hidden="true" focusable="false" />;
}
