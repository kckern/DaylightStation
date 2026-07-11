// ActionChipSelect.jsx — colored action chip with dropdown (Play/Queue/...).
// Extracted verbatim from ListsItemRow.jsx (Task 14); used by both
// ListsItemRow and EmptyItemRow.
import React, { useMemo } from 'react';
import { Badge, Combobox, useCombobox } from '@mantine/core';
import {
  IconPlayerPlayFilled, IconPlaylistAdd, IconLayoutList, IconAppWindow,
  IconDeviceDesktop, IconBookmark, IconRocket, IconArrowsShuffle,
} from '@tabler/icons-react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { ACTION_OPTIONS } from './listConstants.js';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

// Action colors and icons for chips
const ACTION_META = {
  Play:    { color: 'blue',   icon: IconPlayerPlayFilled },
  Queue:   { color: 'green',  icon: IconPlaylistAdd },
  List:    { color: 'violet', icon: IconLayoutList },
  Open:    { color: 'gray',   icon: IconAppWindow },
  Display: { color: 'cyan',   icon: IconDeviceDesktop },
  Read:    { color: 'orange', icon: IconBookmark },
  Launch:  { color: 'teal',   icon: IconRocket },
  Shuffle: { color: 'grape',  icon: IconArrowsShuffle },
};

// Action chip select
export function ActionChipSelect({ value, onChange }) {
  const log = useMemo(() => adminLog('ActionChipSelect'), []);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const currentValue = value || 'Play';
  const meta = ACTION_META[currentValue] || { color: 'gray', icon: IconPlayerPlayFilled };
  const Icon = meta.icon;

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        log.info('action.select', { oldAction: value, newAction: val });
        onChange(val);
        combobox.closeDropdown();
      }}
      withinPortal={true}
      classNames={{ dropdown: 'action-dropdown' }}
    >
      <Combobox.Target>
        <Badge
          size="sm"
          variant="light"
          color={meta.color}
          leftSection={<Icon size={12} />}
          style={{ cursor: 'pointer', width: 82, justifyContent: 'flex-start' }}
          onClick={() => combobox.toggleDropdown()}
        >
          {currentValue}
        </Badge>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {ACTION_OPTIONS.map((opt) => {
            const optMeta = ACTION_META[opt.value] || { color: 'gray', icon: IconPlayerPlayFilled };
            const OptIcon = optMeta.icon;
            return (
              <Combobox.Option key={opt.value} value={opt.value}>
                <Badge
                  size="sm"
                  variant="light"
                  color={optMeta.color}
                  leftSection={<OptIcon size={12} />}
                  style={{ width: 82, justifyContent: 'flex-start' }}
                >
                  {opt.label}
                </Badge>
              </Combobox.Option>
            );
          })}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default ActionChipSelect;
