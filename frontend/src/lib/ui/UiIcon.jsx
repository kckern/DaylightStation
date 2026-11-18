import { IconSearch, IconX } from '@tabler/icons-react';

const icons = { close: IconX, search: IconSearch };

/** Decorative symbol. Give its surrounding control the accessible action name. */
export function UiIcon({ name, size = 16, ...props }) {
  const Icon = icons[name];
  return <Icon {...props} size={size} aria-hidden="true" focusable="false" />;
}
