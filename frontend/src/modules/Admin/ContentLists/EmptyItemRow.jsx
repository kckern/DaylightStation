// EmptyItemRow.jsx — the always-present bottom row for adding new items,
// plus the between-rows InsertRowButton. Extracted verbatim from
// ListsItemRow.jsx (Task 14).
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Text, Checkbox, ActionIcon, TextInput, Avatar } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { useListsContext } from './ListsContext.js';
import { isContentIdLike, shouldAutoAdd } from './contentSearchLogic.js';
import ContentCombobox from './combobox/ContentCombobox.jsx';
import { useAutoResolve } from './combobox/useAutoResolve.js';
import { ContentValueCard, contentInfoFromPick, fetchContentMetadata } from './ContentDisplays.jsx';
import { AppParamPicker } from './AppParamPicker.jsx';
import { ActionChipSelect } from './ActionChipSelect.jsx';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

// Empty row for adding new items at the bottom
export function EmptyItemRow({ onAdd, nextIndex, isWatchlist }) {
  const log = useMemo(() => adminLog('EmptyItemRow'), []);
  const { contentInfoMap, setContentInfo } = useListsContext();
  const [label, setLabel] = useState('');
  const [action, setAction] = useState('Play');
  const [input, setInput] = useState('');
  const [pendingApp, setPendingApp] = useState(null); // {appId, param, options}
  const addedRef = useRef(false); // prevent double-add from rapid state changes
  const labelInputRef = useRef(null);

  // Freeform staged text auto-resolves in the background; the resolved id
  // lands via setInput, where the gated effect below auto-adds it (intended
  // chain: freeform stays staged, a real content id persists).
  const { maybeResolve, cancel: cancelAutoResolve } = useAutoResolve({
    value: input,
    onChange: (id) => setInput(id),
    setContentInfo,
    fetchMetadata: fetchContentMetadata,
  });

  // Combobox change handler — receives (id, item?) from ContentCombobox.
  const handleComboboxChange = (value, selectedItem) => {
    // App that needs a parameter → show the param picker instead of staging.
    if (selectedItem?.isApp && selectedItem.hasParam) {
      log.info('app_param.prompt', { nextIndex, appId: selectedItem.appId, paramName: selectedItem.param?.name });
      import('../../../lib/appRegistry.js')
        .then(({ resolveParamOptions }) => resolveParamOptions(selectedItem.param))
        .then((options) => {
          setPendingApp({
            appId: selectedItem.appId,
            param: selectedItem.param,
            options: options ? [{ value: 'random', label: 'Random' }, ...options] : null,
          });
        });
      return;
    }
    // Seed the cache from picks so the staged card (and derived label on add)
    // uses the resolved title immediately.
    if (value && selectedItem?.title) {
      setContentInfo(value, contentInfoFromPick(value, selectedItem));
    }
    if (value && !selectedItem && !isContentIdLike(value)) {
      maybeResolve(value, 'empty-row-commit');
    }
    setInput(value);
  };

  const doAdd = useCallback((currentInput, currentLabel, currentAction) => {
    if (addedRef.current) return;
    if (!currentInput) return;
    addedRef.current = true;
    // Derive label: explicit label > resolved content title > freeform input
    const resolvedInfo = contentInfoMap.get(currentInput);
    const derivedLabel = currentLabel.trim()
      || resolvedInfo?.title
      || currentInput.replace(/^[^:]+:\s*/, '');
    log.info('item.add', { nextIndex, label: derivedLabel, action: currentAction, input: currentInput });
    onAdd({
      label: derivedLabel,
      action: currentAction,
      input: currentInput,
      active: true
    });
    // Reset fields
    setLabel('');
    setAction('Play');
    setInput('');
    // Allow next add after reset settles
    setTimeout(() => { addedRef.current = false; }, 100);
  }, [onAdd, nextIndex, contentInfoMap, log]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (label.trim() || input)) {
      doAdd(input, label, action);
    }
  };

  // Auto-save only when the input is a real content id (dropdown pick or
  // pasted id). Freeform text stays staged; Enter adds it explicitly.
  useEffect(() => {
    if (input && shouldAutoAdd(input)) {
      doAdd(input, label, action);
    }
  }, [input]);

  return (
    <div className="item-row empty-row">
      <div className="col-active">
        <Checkbox checked={true} disabled size="xs" />
      </div>
      <div className="col-drag"></div>
      <div className="col-index">
        <Text size="xs" c="dimmed">{nextIndex + 1}</Text>
      </div>
      <div className="col-icon">
        <Avatar size={28} radius="sm" color="dark">
          <IconPlus size={14} />
        </Avatar>
      </div>
      <div className="col-label">
        <TextInput
          ref={labelInputRef}
          size="xs"
          placeholder="New item label..."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          styles={{ input: { minHeight: 22, height: 22, background: 'transparent', border: 'none' } }}
        />
      </div>
      <div className="col-divider" />
      <div className="col-content-drag"></div>
      <div className="col-action">
        <ActionChipSelect value={action} onChange={setAction} />
      </div>
      <div className="col-preview"></div>
      <div className="col-input">
        {pendingApp ? (
          <AppParamPicker
            appId={pendingApp.appId}
            param={pendingApp.param}
            options={pendingApp.options}
            onCommit={(fullId) => { setPendingApp(null); setInput(fullId); }}
            onCancel={() => setPendingApp(null)}
          />
        ) : (
          <ContentCombobox
            value={input}
            onChange={handleComboboxChange}
            appResults
            renderValue={({ onStartEdit }) => (
              <ContentValueCard
                value={input}
                contentInfoMap={contentInfoMap}
                onStartEdit={() => { cancelAutoResolve(); onStartEdit(); }}
              />
            )}
          />
        )}
      </div>
      {isWatchlist && (
        <div className="col-progress"></div>
      )}
      <div className="col-config"></div>
      <div className="col-menu"></div>
    </div>
  );
}

// Insert button that appears between rows on hover
export function InsertRowButton({ onInsert }) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="insert-row-zone"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <div className={`insert-row-button ${visible ? 'visible' : ''}`}>
        <ActionIcon
          size="xs"
          variant="filled"
          color="blue"
          radius="xl"
          onClick={onInsert}
        >
          <IconPlus size={10} />
        </ActionIcon>
      </div>
    </div>
  );
}
