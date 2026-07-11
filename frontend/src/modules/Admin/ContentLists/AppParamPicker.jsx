// AppParamPicker.jsx — parameter picker rendered in place of the combobox
// after selecting an app that requires a parameter (e.g. `app:hymn` needs a
// number). Extracted verbatim from ListsItemRow.jsx (Task 14).
import React, { useState, useRef, useMemo } from 'react';
import { Text, TextInput, Combobox, useCombobox, InputBase, ScrollArea } from '@mantine/core';
import { getChildLogger } from '../../../lib/logging/singleton.js';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

/**
 * App parameter picker — rendered in place of the combobox after selecting an
 * app that requires a parameter (e.g. `app:hymn` needs a number). Ported from
 * the inline twin; stays row-level per the unified-combobox design (Task 13).
 *
 * @param {string} appId
 * @param {object} param - the app registry param spec ({name, options})
 * @param {Array|null} options - resolved [{value, label}] options, or null for free text
 * @param {(fullId: string) => void} onCommit
 * @param {() => void} onCancel
 */
export function AppParamPicker({ appId, param, options, onCommit, onCancel }) {
  const log = useMemo(() => adminLog('AppParamPicker'), []);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [paramInput, setParamInput] = useState('');
  const inputRef = useRef(null);

  const finishWithParam = (paramVal) => {
    const fullId = paramVal ? `app:${appId}/${paramVal}` : `app:${appId}`;
    log.info('app_param.commit', { appId, paramVal, fullId });
    onCommit(fullId);
  };

  const cancelParam = () => {
    log.info('app_param.cancel', { appId });
    onCancel();
  };

  // Dropdown options
  if (options) {
    return (
      <Combobox
        store={combobox}
        onOptionSubmit={(val) => finishWithParam(val)}
      >
        <Combobox.Target>
          <InputBase
            ref={inputRef}
            size="xs"
            pointer
            rightSection={<Combobox.Chevron />}
            rightSectionPointerEvents="none"
            value={paramInput}
            onChange={(e) => {
              log.debug('param_input.change', { value: e.currentTarget.value, appId });
              setParamInput(e.currentTarget.value);
              combobox.openDropdown();
            }}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelParam();
              if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
            }}
            placeholder={`Choose or type ${param.name}...`}
            autoFocus
            styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>
            <ScrollArea.Autosize mah={200}>
              {options
                .filter(o => !paramInput || o.label.toLowerCase().includes(paramInput.toLowerCase()))
                .map(o => (
                  <Combobox.Option key={o.value} value={o.value}>
                    <Text size="xs">{o.label}</Text>
                  </Combobox.Option>
                ))}
            </ScrollArea.Autosize>
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    );
  }

  // Free text input (no options defined)
  return (
    <TextInput
      ref={inputRef}
      size="xs"
      value={paramInput}
      onChange={(e) => setParamInput(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
        if (e.key === 'Escape') cancelParam();
      }}
      onBlur={() => {
        if (paramInput) finishWithParam(paramInput);
        else cancelParam();
      }}
      placeholder={`Type ${param.name}...`}
      autoFocus
      styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
    />
  );
}

export default AppParamPicker;
